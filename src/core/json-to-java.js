/**
 * JSON → Java.
 *
 * Estratégia: um passe de inferência que unifica todos os valores observados em cada
 * "slot" (caminho no documento) e um passe de emissão de código. Objetos que aparecem
 * no mesmo caminho — inclusive elementos de um mesmo array — são fundidos numa única
 * classe, com campos ausentes marcados como nullable (tipo wrapper).
 */

import { CodecError } from './base64.js';
import { parseJson } from './json.js';
import { quote, singularize, toClassName, toFieldName } from './naming.js';

/** @typedef {{kind:string, of?:any, ref?:string, java?:string}} JavaType */

const DEFAULTS = {
  rootClassName: 'Root',
  packageName: '',
  style: 'record', // 'record' | 'pojo' | 'lombok'
  jackson: true,
  primitives: true,
  detectDateTime: true,
  nested: 'inner', // 'inner' | 'separate'
  indent: 4,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?$/;
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAP_KEY = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * @param {string} jsonText
 * @param {Partial<typeof DEFAULTS>} [userOptions]
 * @returns {{output: string, warnings: string[], classCount: number}}
 */
export function jsonToJava(jsonText, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const value = parseJson(jsonText);
  const context = {
    options,
    classes: new Map(), // className → { name, fields: Map }
    usedNames: new Set(),
    warnings: new Set(),
    imports: new Set(),
  };

  const rootName = toClassName(options.rootClassName || 'Root');
  let rootType;

  if (Array.isArray(value)) {
    // O array inteiro é *uma* amostra do slot raiz — daí o [value].
    rootType = describe(context, [value], rootName);
    if (rootType.kind !== 'list' || rootType.of.kind !== 'object') {
      context.warnings.add(
        `A raiz é um array de valores simples: use ${renderType(context, rootType, options)} diretamente.`,
      );
    }
  } else if (isPlainObject(value)) {
    rootType = describeObject(context, [value], rootName);
  } else {
    throw new CodecError('O JSON precisa ser um objeto ou um array para virar classes Java.', {
      hint: `Valor recebido: ${typeof value}. Envolva o conteúdo em { } para gerar uma classe.`,
    });
  }

  const output = emit(context, rootType);
  return {
    output,
    warnings: [...context.warnings],
    classCount: context.classes.size,
  };
}

/* ------------------------------------------------------------------ inferência */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueClassName(context, base) {
  let name = base;
  let counter = 2;
  while (context.usedNames.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  context.usedNames.add(name);
  return name;
}

/**
 * Unifica uma lista de valores observados no mesmo caminho em um tipo Java.
 * @param {any[]} values
 * @param {string} hintName nome sugerido caso seja necessário criar uma classe
 */
function describe(context, values, hintName) {
  const present = values.filter((value) => value !== undefined);
  const nonNull = present.filter((value) => value !== null);

  if (nonNull.length === 0) return { kind: 'any', java: 'Object' };

  const kinds = new Set(nonNull.map(kindOf));

  if (kinds.size > 1) {
    // number + string, object + array, etc.
    if (kinds.size === 2 && kinds.has('int') && kinds.has('double')) {
      return numberType(nonNull);
    }
    context.warnings.add(
      `O campo "${hintName}" mistura tipos (${[...kinds].join(', ')}); foi gerado como Object.`,
    );
    return { kind: 'any', java: 'Object' };
  }

  const kind = [...kinds][0];

  switch (kind) {
    case 'boolean':
      return { kind: 'boolean', java: 'Boolean' };
    case 'int':
    case 'double':
      return numberType(nonNull);
    case 'string':
      return stringType(context, nonNull);
    case 'array': {
      const items = nonNull.flat();
      if (items.length === 0) {
        context.warnings.add(`O array "${hintName}" está vazio; o tipo do elemento virou Object.`);
        return { kind: 'list', of: { kind: 'any', java: 'Object' } };
      }
      return { kind: 'list', of: describe(context, items, singularize(hintName)) };
    }
    case 'object': {
      const mapType = detectMap(context, nonNull, hintName);
      if (mapType) return mapType;
      return describeObject(context, nonNull, hintName);
    }
    default:
      return { kind: 'any', java: 'Object' };
  }
}

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
  return 'string';
}

function numberType(values) {
  const allIntegers = values.every((value) => Number.isInteger(value));
  if (!allIntegers) return { kind: 'double', java: 'Double' };
  const max = values.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0);
  if (max > Number.MAX_SAFE_INTEGER) return { kind: 'bigdecimal', java: 'BigDecimal' };
  if (max > 2147483647) return { kind: 'long', java: 'Long' };
  return { kind: 'int', java: 'Integer' };
}

function stringType(context, values) {
  if (!context.options.detectDateTime) return { kind: 'string', java: 'String' };
  const every = (regex) => values.every((value) => regex.test(value));
  if (every(UUID_RE)) return { kind: 'ref', java: 'UUID' };
  if (every(ISO_OFFSET)) return { kind: 'ref', java: 'OffsetDateTime' };
  if (every(ISO_DATE_TIME)) return { kind: 'ref', java: 'LocalDateTime' };
  if (every(ISO_DATE)) return { kind: 'ref', java: 'LocalDate' };
  return { kind: 'string', java: 'String' };
}

/** Objeto com chaves dinâmicas (ids/uuids) vira Map<String, V> em vez de uma classe. */
function detectMap(context, objects, hintName) {
  const keys = objects.flatMap((object) => Object.keys(object));
  if (keys.length < 2) return null;
  if (!keys.every((key) => MAP_KEY.test(key))) return null;
  const valueType = describe(
    context,
    objects.flatMap((object) => Object.values(object)),
    singularize(hintName),
  );
  context.warnings.add(`"${hintName}" tem chaves dinâmicas; foi gerado como Map<String, …>.`);
  return { kind: 'map', of: valueType };
}

function describeObject(context, objects, hintName) {
  const className = context.classes.has(hintName) ? hintName : uniqueClassName(context, toClassName(hintName));
  const fields = new Map();

  // União das chaves preservando a ordem de primeira aparição.
  const keys = [];
  for (const object of objects) {
    for (const key of Object.keys(object)) if (!keys.includes(key)) keys.push(key);
  }

  const model = { name: className, fields };
  context.classes.set(className, model);

  const usedFieldNames = new Set();
  for (const key of keys) {
    const values = objects.map((object) => (key in object ? object[key] : undefined));
    const optional = values.some((value) => value === undefined) || values.some((value) => value === null);
    const type = describe(context, values, key);

    let javaName = toFieldName(key);
    let candidate = javaName;
    let counter = 2;
    while (usedFieldNames.has(candidate)) {
      candidate = `${javaName}${counter}`;
      counter += 1;
    }
    javaName = candidate;
    usedFieldNames.add(javaName);

    fields.set(key, { key, javaName, type, optional });
  }

  if (fields.size === 0) {
    context.warnings.add(`O objeto "${hintName}" está vazio; a classe ${className} foi gerada sem campos.`);
  }

  return { kind: 'object', ref: className };
}

/* -------------------------------------------------------------------- emissão */

function renderType(context, type, options, { boxed = false } = {}) {
  switch (type.kind) {
    case 'object':
      return type.ref;
    case 'list':
      context.imports.add('java.util.List');
      return `List<${renderType(context, type.of, options, { boxed: true })}>`;
    case 'map':
      context.imports.add('java.util.Map');
      return `Map<String, ${renderType(context, type.of, options, { boxed: true })}>`;
    case 'bigdecimal':
      context.imports.add('java.math.BigDecimal');
      return 'BigDecimal';
    case 'ref':
      if (type.java === 'UUID') context.imports.add('java.util.UUID');
      else context.imports.add(`java.time.${type.java}`);
      return type.java;
    case 'boolean':
      return boxed || !options.primitives ? 'Boolean' : 'boolean';
    case 'int':
      return boxed || !options.primitives ? 'Integer' : 'int';
    case 'long':
      return boxed || !options.primitives ? 'Long' : 'long';
    case 'double':
      return boxed || !options.primitives ? 'Double' : 'double';
    case 'string':
      return 'String';
    default:
      return 'Object';
  }
}

function fieldType(context, field, options) {
  // Campos ausentes/nulos em alguma amostra precisam de tipo que aceite null.
  return renderType(context, field.type, options, { boxed: field.optional });
}

function emit(context, rootType) {
  const { options } = context;
  const indent = ' '.repeat(options.indent);
  const bodies = [];

  // Renderiza primeiro (popula os imports), monta o cabeçalho depois.
  // Numa raiz em array, a classe do elemento assume o papel de classe principal.
  const rootRef =
    rootType.kind === 'object'
      ? rootType.ref
      : rootType.kind === 'list' && rootType.of.kind === 'object'
        ? rootType.of.ref
        : null;
  const rootModel = rootRef ? context.classes.get(rootRef) : null;
  const nestedModels = [...context.classes.values()].filter((model) => model !== rootModel);

  if (options.nested === 'inner' && rootModel) {
    bodies.push(renderClass(context, rootModel, options, indent, nestedModels, true));
  } else {
    const ordered = rootModel ? [rootModel, ...nestedModels] : nestedModels;
    for (const model of ordered) {
      bodies.push(
        `// ==== ${model.name}.java ====\n${renderClass(context, model, options, indent, [], true)}`,
      );
    }
  }

  const header = [];
  header.push('// Gerado pelo Codec Studio — revise antes de usar em produção.');
  if (options.packageName.trim()) header.push(`package ${options.packageName.trim()};`);

  // Calculado antes dos imports: renderType registra java.util.List.
  const rootNote =
    rootType.kind === 'list'
      ? `// A raiz do JSON é um array — desserialize como ${renderType(context, rootType, options)}.`
      : '';

  if (options.jackson) context.imports.add('com.fasterxml.jackson.annotation.JsonProperty');
  if (options.style === 'lombok') {
    context.imports.add('lombok.Data');
    context.imports.add('lombok.NoArgsConstructor');
    context.imports.add('lombok.AllArgsConstructor');
  }

  const imports = [...context.imports].sort(sortImports);
  const parts = [header.join('\n')];
  if (imports.length) parts.push(imports.map((entry) => `import ${entry};`).join('\n'));

  if (rootNote) parts.push(rootNote);

  parts.push(bodies.join('\n\n'));
  return `${parts.filter(Boolean).join('\n\n').trimEnd()}\n`;
}

function sortImports(a, b) {
  const rank = (name) => (name.startsWith('java.') ? 0 : name.startsWith('javax.') ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

function renderClass(context, model, options, indent, nestedModels, isTop) {
  const lines = [];
  // Records aninhados já são implicitamente static; classes aninhadas precisam do modificador.
  const modifier = isTop || options.style === 'record' ? 'public' : 'public static';

  if (options.style === 'record') {
    lines.push(...renderRecord(context, model, options, indent, modifier));
  } else {
    lines.push(...renderPojo(context, model, options, indent, modifier));
  }

  if (nestedModels.length === 0) return dedentJoin(lines);

  // Classes aninhadas entram no corpo da raiz.
  const body = nestedModels.map((nested) =>
    indentBlock(renderClass(context, nested, options, indent, [], false), indent),
  );

  const rendered = dedentJoin(lines);
  const closingIndex = rendered.lastIndexOf('}');
  const head = rendered.slice(0, closingIndex).replace(/\s+$/, '');
  return `${head}\n\n${body.join('\n\n')}\n}`;
}

function dedentJoin(lines) {
  return lines.join('\n');
}

function indentBlock(text, indent) {
  return text
    .split('\n')
    .map((line) => (line.trim() ? indent + line : line))
    .join('\n');
}

function annotationFor(field, options) {
  return options.jackson && field.javaName !== field.key ? `@JsonProperty(${quote(field.key)})` : '';
}

function renderRecord(context, model, options, indent, modifier) {
  const fields = [...model.fields.values()];
  if (fields.length === 0) return [`${modifier} record ${model.name}() {`, '}'];

  const components = fields.map((field) => {
    const annotation = annotationFor(field, options);
    const type = renderType(context, field.type, options, { boxed: true }); // records não usam primitivos opcionais
    return `${annotation ? `${annotation} ` : ''}${type} ${field.javaName}`;
  });

  const lines = [`${modifier} record ${model.name}(`];
  components.forEach((component, index) => {
    const last = index === components.length - 1;
    lines.push(`${indent}${indent}${component}${last ? ') {' : ','}`);
  });
  lines.push('}');
  return lines;
}

function renderPojo(context, model, options, indent, modifier) {
  const fields = [...model.fields.values()];
  const lines = [];

  if (options.style === 'lombok') {
    lines.push('@Data', '@NoArgsConstructor', '@AllArgsConstructor');
  }
  lines.push(`${modifier} class ${model.name} {`);

  fields.forEach((field, index) => {
    const annotation = annotationFor(field, options);
    if (annotation) {
      if (index > 0) lines.push('');
      lines.push(`${indent}${annotation}`);
    }
    lines.push(`${indent}private ${fieldType(context, field, options)} ${field.javaName};`);
  });

  if (options.style !== 'lombok' && fields.length > 0) {
    for (const field of fields) {
      const type = fieldType(context, field, options);
      const suffix = field.javaName.charAt(0).toUpperCase() + field.javaName.slice(1);
      const getter = type === 'boolean' ? `is${suffix}` : `get${suffix}`;
      lines.push('');
      lines.push(`${indent}public ${type} ${getter}() {`);
      lines.push(`${indent}${indent}return ${field.javaName};`);
      lines.push(`${indent}}`);
      lines.push('');
      lines.push(`${indent}public void set${suffix}(${type} ${field.javaName}) {`);
      lines.push(`${indent}${indent}this.${field.javaName} = ${field.javaName};`);
      lines.push(`${indent}}`);
    }
  }

  lines.push('}');
  return lines;
}
