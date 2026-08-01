/**
 * Formato Java: `record`, POJO ou classe Lombok.
 */

import { msg } from '../messages.js';
import { addType, addWarning, createIR, list, map, orderedTypes, ref, scalar, uniqueTypeName } from '../ir.js';
import { flattenTypes, parseJava } from '../java-parser.js';
import { quote, toClassName, toFieldName, toScreamingSnakeCase } from '../naming.js';
import { splitGeneric } from '../parse-utils.js';
import { CodecError } from '../base64.js';

export const id = 'java';
export const label = 'Java';
export const kind = 'lang';
export const highlight = 'java';
export const extension = 'java';

export const defaults = {
  style: 'record', // 'record' | 'pojo' | 'lombok'
  jackson: true,
  jacksonAll: false,
  primitives: true,
  nested: 'inner', // 'inner' | 'separate'
  packageName: '',
  indent: 4,
};

/* -------------------------------------------------------------- tipos IR ↔ Java */

const TO_IR = {
  String: 'string', CharSequence: 'string', char: 'string', Character: 'string',
  int: 'int', Integer: 'int', short: 'int', Short: 'int', byte: 'int', Byte: 'int',
  AtomicInteger: 'int', long: 'long', Long: 'long', AtomicLong: 'long', BigInteger: 'long',
  double: 'double', Double: 'double', float: 'double', Float: 'double',
  BigDecimal: 'decimal', boolean: 'bool', Boolean: 'bool',
  LocalDate: 'date', LocalDateTime: 'datetime', LocalTime: 'time',
  OffsetDateTime: 'datetimetz', ZonedDateTime: 'datetimetz', Instant: 'datetimetz',
  Date: 'datetimetz', Timestamp: 'datetimetz', Duration: 'duration', Period: 'duration',
  UUID: 'uuid', URI: 'uri', URL: 'uri', Object: 'any', JsonNode: 'any',
};

const COLLECTIONS = new Set([
  'List', 'ArrayList', 'LinkedList', 'Collection', 'Iterable', 'Set', 'HashSet',
  'LinkedHashSet', 'TreeSet', 'Queue', 'Deque', 'Stream',
]);
const MAPS = new Set(['Map', 'HashMap', 'LinkedHashMap', 'TreeMap', 'SortedMap', 'Properties']);
const WRAPPERS = new Set(['Optional', 'OptionalInt', 'OptionalLong', 'OptionalDouble', 'AtomicReference']);

/** Tipo IR (boxed) para cada escalar. */
const FROM_IR = {
  string: 'String', int: 'Integer', long: 'Long', double: 'Double', decimal: 'BigDecimal',
  bool: 'Boolean', date: 'LocalDate', datetime: 'LocalDateTime', datetimetz: 'OffsetDateTime',
  time: 'LocalTime', duration: 'Duration', uuid: 'UUID', uri: 'URI', any: 'Object',
};
const PRIMITIVES = { int: 'int', long: 'long', double: 'double', bool: 'boolean' };

const IMPORTS = {
  BigDecimal: 'java.math.BigDecimal',
  LocalDate: 'java.time.LocalDate', LocalDateTime: 'java.time.LocalDateTime',
  LocalTime: 'java.time.LocalTime', OffsetDateTime: 'java.time.OffsetDateTime',
  Duration: 'java.time.Duration', UUID: 'java.util.UUID', URI: 'java.net.URI',
  List: 'java.util.List', Map: 'java.util.Map',
};

/* ------------------------------------------------------------------ leitura */

export function parse(source, options = {}) {
  if (!source.trim()) {
    throw new CodecError('core.javaToJson.empty', { hintCode: 'core.javaToJson.empty.hint' });
  }

  const { types, warnings } = parseJava(source);
  if (types.length === 0) {
    throw new CodecError('core.javaToJson.noTypes', { hintCode: 'core.javaToJson.noTypes.hint' });
  }

  const registry = flattenTypes(types);
  const ir = createIR();
  ir.warnings.push(...warnings);

  for (const declaration of registry.values()) {
    if (declaration.kind === 'enum') {
      addType(ir, { kind: 'enum', name: declaration.name, constants: declaration.constants });
      continue;
    }
    addType(ir, {
      kind: 'object',
      name: declaration.name,
      fields: declaration.fields.map((field) => ({
        name: toFieldName(field.name),
        wireName: field.jsonName || field.name,
        type: typeToIR(field.type, registry, ir),
        optional: /^(Optional|AtomicReference)\b/.test(field.type),
      })),
    });
  }

  const candidates = types.filter((type) => type.kind === 'class' || type.kind === 'record');
  const requested = options.rootType && registry.has(options.rootType) ? options.rootType : null;
  ir.rootName = requested || (candidates[0] || types[0]).name;
  return ir;
}

function typeToIR(raw, registry, ir) {
  const text = String(raw).trim();
  if (text.endsWith('[]')) return list(typeToIR(text.slice(0, -2), registry, ir));

  const { base, args } = splitGeneric(text);
  const simple = base.split('.').pop();

  if (COLLECTIONS.has(simple)) return list(args.length ? typeToIR(args[0], registry, ir) : scalar('any'));
  if (MAPS.has(simple)) return map(args.length > 1 ? typeToIR(args[1], registry, ir) : scalar('any'));
  if (WRAPPERS.has(simple)) return args.length ? typeToIR(args[0], registry, ir) : scalar('any');
  if (registry.has(simple)) return ref(simple);
  if (TO_IR[simple]) return scalar(TO_IR[simple]);

  // Tipo de terceiros: não sabemos a forma, então vira valor livre — mas avisamos.
  if (ir) addWarning(ir, msg('core.javaToJson.unknownType', { name: simple }));
  return scalar('any');
}

/* ------------------------------------------------------------------ escrita */

export function emit(ir, userOptions = {}) {
  const options = { ...defaults, ...userOptions };
  const indent = ' '.repeat(options.indent);
  const context = { ir, options, imports: new Set(), usedJackson: false, warnings: [...ir.warnings] };

  const types = orderedTypes(ir).filter((type) => type.name);
  requireDeclarableTypes(ir, types);

  const [root, ...rest] = types;
  const bodies = [];

  if (options.nested === 'inner') {
    bodies.push(renderType(context, root, indent, rest, true));
  } else {
    for (const type of types) {
      bodies.push(`// ==== ${type.name}.java ====\n${renderType(context, type, indent, [], true)}`);
    }
  }

  const header = [msg('core.jsonToJava.header')];
  if (options.packageName.trim()) header.push(`package ${options.packageName.trim()};`);

  const rootNote = ir.rootIsList
    ? msg('core.jsonToJava.rootArrayNote', { type: `List<${root.name}>` })
    : '';
  if (ir.rootIsList) context.imports.add('java.util.List');

  if (options.jackson && context.usedJackson) {
    context.imports.add('com.fasterxml.jackson.annotation.JsonProperty');
  }
  if (options.style === 'lombok') {
    context.imports.add('lombok.Data');
    context.imports.add('lombok.NoArgsConstructor');
    context.imports.add('lombok.AllArgsConstructor');
  }

  const imports = [...context.imports].sort(sortImports).map((entry) => `import ${entry};`);
  const parts = [header.join('\n')];
  if (imports.length) parts.push(imports.join('\n'));
  if (rootNote) parts.push(rootNote);
  parts.push(bodies.join('\n\n'));

  return { output: `${parts.filter(Boolean).join('\n\n').trimEnd()}\n`, warnings: context.warnings };
}

function sortImports(a, b) {
  const rank = (name) => (name.startsWith('java.') ? 0 : name.startsWith('javax.') ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

function renderTypeName(context, type, { boxed = false } = {}) {
  const { options } = context;
  switch (type.kind) {
    case 'ref':
      return type.name;
    case 'list':
      context.imports.add('java.util.List');
      return `List<${renderTypeName(context, type.of, { boxed: true })}>`;
    case 'map':
      context.imports.add('java.util.Map');
      return `Map<String, ${renderTypeName(context, type.of, { boxed: true })}>`;
    default: {
      const primitive = !boxed && options.primitives && PRIMITIVES[type.kind];
      const name = primitive || FROM_IR[type.kind] || 'Object';
      if (IMPORTS[name]) context.imports.add(IMPORTS[name]);
      return name;
    }
  }
}

function annotationFor(context, field) {
  const { options } = context;
  if (!options.jackson) return '';
  if (!options.jacksonAll && field.name === field.wireName) return '';
  context.usedJackson = true;
  return `@JsonProperty(${quote(field.wireName)})`;
}

function renderType(context, type, indent, nested, isTop) {
  if (type.kind === 'enum') return renderEnum(type, indent, isTop);

  const { options } = context;
  const modifier = isTop || options.style === 'record' ? 'public' : 'public static';
  const lines = options.style === 'record'
    ? renderRecord(context, type, indent, modifier)
    : renderClass(context, type, indent, modifier);

  const rendered = lines.join('\n');
  if (nested.length === 0) return rendered;

  const inner = nested.map((child) => indentBlock(renderType(context, child, indent, [], false), indent));
  const closing = rendered.lastIndexOf('}');
  return `${rendered.slice(0, closing).replace(/\s+$/, '')}\n\n${inner.join('\n\n')}\n}`;
}

function renderEnum(type, indent, isTop) {
  // Enums aninhados já são implicitamente static, e constantes Java são MAIÚSCULAS.
  const constants = type.constants.length
    ? type.constants.map(toScreamingSnakeCase).join(', ')
    : 'VALUE';
  return `public enum ${type.name} { ${constants} }`;
}

function renderRecord(context, type, indent, modifier) {
  const fields = type.fields;
  if (fields.length === 0) return [`${modifier} record ${type.name}() {`, '}'];

  const lines = [`${modifier} record ${type.name}(`];
  fields.forEach((field, index) => {
    const annotation = annotationFor(context, field);
    // Records não usam primitivos opcionais: todo componente é boxed.
    const declaration = `${renderTypeName(context, field.type, { boxed: true })} ${field.name}`;
    if (annotation) lines.push(`${indent}${indent}${annotation}`);
    lines.push(`${indent}${indent}${declaration}${index === fields.length - 1 ? ') {' : ','}`);
  });
  lines.push('}');
  return lines;
}

function renderClass(context, type, indent, modifier) {
  const { options } = context;
  const lines = [];

  if (options.style === 'lombok') lines.push('@Data', '@NoArgsConstructor', '@AllArgsConstructor');
  lines.push(`${modifier} class ${type.name} {`);

  type.fields.forEach((field, index) => {
    const annotation = annotationFor(context, field);
    const declared = renderTypeName(context, field.type, { boxed: field.optional });
    if (annotation) {
      if (index > 0) lines.push('');
      lines.push(`${indent}${annotation}`);
    }
    lines.push(`${indent}private ${declared} ${field.name};`);
  });

  if (options.style !== 'lombok') {
    for (const field of type.fields) {
      const declared = renderTypeName(context, field.type, { boxed: field.optional });
      const suffix = field.name.charAt(0).toUpperCase() + field.name.slice(1);
      const getter = declared === 'boolean' ? `is${suffix}` : `get${suffix}`;
      lines.push('');
      lines.push(`${indent}public ${declared} ${getter}() {`);
      lines.push(`${indent}${indent}return ${field.name};`);
      lines.push(`${indent}}`);
      lines.push('');
      lines.push(`${indent}public void set${suffix}(${declared} ${field.name}) {`);
      lines.push(`${indent}${indent}this.${field.name} = ${field.name};`);
      lines.push(`${indent}}`);
    }
  }

  lines.push('}');
  return lines;
}

function indentBlock(text, indent) {
  return text.split('\n').map((line) => (line.trim() ? indent + line : line)).join('\n');
}

/**
 * Linguagens declaram tipos: um documento que é só um escalar ou uma lista de
 * escalares não tem o que virar classe. Formatos de dados (JSON/YAML) aceitam.
 */
function requireDeclarableTypes(ir, types) {
  if (types.length > 0) return;
  throw new CodecError('core.jsonToJava.rootMustBeObject', {
    hintCode: 'core.jsonToJava.rootMustBeObject.hint',
    hintParams: { type: ir.rootLabel || (ir.rootScalar ? ir.rootScalar.kind : 'empty') },
  });
}

/** Nome de classe válido a partir de um texto livre (usado pela interface). */
export const normalizeRootName = (name) => uniqueTypeName(createIR(), toClassName(name || 'Root'));
