/**
 * Formato Dart: classes com null-safety e, opcionalmente, `fromJson`/`toJson`.
 */

import { msg } from '../messages.js';
import { addType, addWarning, createIR, list, map, orderedTypes, ref, scalar } from '../ir.js';
import { toFieldName, toPascalCase } from '../naming.js';
import { matchPair, splitGeneric, stripComments } from '../parse-utils.js';
import { CodecError } from '../base64.js';

export const id = 'dart';
export const label = 'Dart';
export const kind = 'lang';
export const highlight = 'dart';
export const extension = 'dart';

export const defaults = {
  finalFields: true,
  jsonMethods: true,   // fromJson/toJson escritos à mão, sem build_runner
  namedParameters: true,
  indent: 2,
};

const TO_IR = {
  String: 'string', int: 'int', double: 'double', num: 'double', bool: 'bool',
  DateTime: 'datetimetz', Duration: 'duration', Uri: 'uri', Object: 'any', dynamic: 'any',
  BigInt: 'long', Decimal: 'decimal',
};

const FROM_IR = {
  string: 'String', int: 'int', long: 'int', double: 'double', decimal: 'double',
  bool: 'bool', date: 'DateTime', datetime: 'DateTime', datetimetz: 'DateTime',
  time: 'String', duration: 'Duration', uuid: 'String', uri: 'Uri', any: 'dynamic',
};

const DATE_KINDS = new Set(['date', 'datetime', 'datetimetz']);

/* ------------------------------------------------------------------ leitura */

const TYPE_HEADER = /(?:^|[\s;}])(?:abstract\s+|final\s+|base\s+|sealed\s+)*(class|enum)\s+([A-Za-z_]\w*)/g;

export function parse(source, options = {}) {
  if (!source.trim()) {
    throw new CodecError('core.lang.empty', { hintCode: 'core.lang.empty.hint', params: { lang: label } });
  }

  const code = stripComments(source);
  const ir = createIR();
  const declared = [];

  TYPE_HEADER.lastIndex = 0;
  let match = TYPE_HEADER.exec(code);
  while (match) {
    const [, keyword, name] = match;
    const braceIndex = code.indexOf('{', match.index + match[0].length);
    if (braceIndex === -1) break;

    const close = matchPair(code, braceIndex, '{', '}');
    const body = code.slice(braceIndex + 1, close);

    if (keyword === 'enum') {
      // Corpo do enum: constantes até o primeiro ";" (ou até o fim).
      const head = body.split(';')[0];
      const constants = head.split(',')
        .map((entry) => (/^\s*([A-Za-z_]\w*)/.exec(entry) || [])[1])
        .filter(Boolean);
      addType(ir, { kind: 'enum', name, constants });
      declared.push({ name, kind: 'enum', rawFields: [] });
    } else {
      addType(ir, { kind: 'object', name, fields: [] });
      declared.push({ name, kind: 'class', rawFields: parseFields(body, name) });
    }

    TYPE_HEADER.lastIndex = close;
    match = TYPE_HEADER.exec(code);
  }

  if (declared.length === 0) {
    throw new CodecError('core.lang.noTypes', { hintCode: 'core.lang.noTypes.hint', params: { lang: label } });
  }

  for (const entry of declared) {
    const declaration = ir.types.find((type) => type.name === entry.name);
    if (!declaration || declaration.kind === 'enum') continue;
    declaration.fields = entry.rawFields.map((field) => ({
      name: toFieldName(field.name),
      wireName: field.wireName,
      type: typeToIR(field.type, ir),
      optional: field.optional,
    }));
  }

  const first = declared.find((entry) => entry.kind !== 'enum') || declared[0];
  ir.rootName = options.rootType && ir.types.some((type) => type.name === options.rootType)
    ? options.rootType
    : first.name;
  return ir;
}

function parseFields(body, className) {
  const fields = [];
  // Remove construtores e corpos de método antes de procurar campos.
  const withoutMembers = body.replace(new RegExp(`${className}\\s*\\([^)]*\\)[^;{]*[;{]`, 'g'), ' ');

  for (const rawStatement of withoutMembers.split(';')) {
    const statement = rawStatement.trim();
    if (!statement || statement.startsWith('@')) continue;

    const annotations = [...statement.matchAll(/@JsonKey\s*\(\s*name:\s*['"]([^'"]*)['"]/g)];
    const clean = statement.replace(/@\w+\s*(\([^)]*\))?/g, ' ').trim();

    const match = /^(?:static\s+)?(?:final\s+|const\s+|late\s+)*([A-Za-z_][\w<>,\s?]*[\w>?])\s+([A-Za-z_]\w*)\s*$/.exec(clean);
    if (!match) continue;

    const [, rawType, name] = match;
    const type = rawType.trim();
    if (type === 'get' || type === 'set' || /\breturn\b/.test(clean)) continue;

    fields.push({
      name,
      wireName: annotations.length ? annotations[0][1] : name,
      type: type.replace(/\?$/, ''),
      optional: type.endsWith('?'),
    });
  }

  return fields;
}

function typeToIR(raw, ir) {
  const text = String(raw).trim().replace(/\?$/, '');
  const { base, args } = splitGeneric(text);
  const simple = base.split('.').pop();

  if (simple === 'List' || simple === 'Set' || simple === 'Iterable') {
    return list(args.length ? typeToIR(args[0], ir) : scalar('any'));
  }
  if (simple === 'Map') return map(args.length > 1 ? typeToIR(args[1], ir) : scalar('any'));
  if (ir.types.some((type) => type.name === simple)) return ref(simple);
  if (TO_IR[simple]) return scalar(TO_IR[simple]);

  addWarning(ir, msg('core.lang.unknownType', { name: simple, lang: label }));
  return scalar('any');
}

/* ------------------------------------------------------------------ escrita */

export function emit(ir, userOptions = {}) {
  const options = { ...defaults, ...userOptions };
  const indent = ' '.repeat(options.indent);
  const context = { ir, options, warnings: [...ir.warnings] };

  const types = orderedTypes(ir).filter((type) => type.name);
  if (types.length === 0) {
    throw new CodecError('core.lang.rootMustBeObject', {
      hintCode: 'core.lang.rootMustBeObject.hint',
      params: { lang: label },
      hintParams: { lang: label, type: ir.rootLabel || 'empty' },
    });
  }

  const parts = [msg('core.lang.header', { lang: label })];
  if (ir.rootIsList) parts.push(msg('core.lang.rootArrayNote', { type: `List<${types[0].name}>` }));
  parts.push(types.map((type) => renderType(context, type, indent)).join('\n\n'));

  return { output: `${parts.join('\n\n').trimEnd()}\n`, warnings: context.warnings };
}

function renderTypeName(context, type) {
  switch (type.kind) {
    case 'ref':
      return type.name;
    case 'list':
      return `List<${renderTypeName(context, type.of)}>`;
    case 'map':
      return `Map<String, ${renderTypeName(context, type.of)}>`;
    default:
      return FROM_IR[type.kind] || 'dynamic';
  }
}

const declared = (context, field) =>
  `${renderTypeName(context, field.type)}${field.optional ? '?' : ''}`;

function renderType(context, type, indent) {
  const { options } = context;

  if (type.kind === 'enum') {
    const constants = type.constants.length ? type.constants : ['value'];
    return `enum ${type.name} {\n${constants.map((name) => `${indent}${toCamel(name)},`).join('\n')}\n}`;
  }

  const lines = [`class ${type.name} {`];
  const modifier = options.finalFields ? 'final ' : '';

  for (const field of type.fields) {
    lines.push(`${indent}${modifier}${declared(context, field)} ${field.name};`);
  }

  if (type.fields.length > 0) {
    lines.push('');
    lines.push(...renderConstructor(context, type, indent));
    if (options.jsonMethods) {
      lines.push('');
      lines.push(...renderFromJson(context, type, indent));
      lines.push('');
      lines.push(...renderToJson(context, type, indent));
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function renderConstructor(context, type, indent) {
  const { options } = context;
  if (!options.namedParameters) {
    const positional = type.fields.map((field) => `this.${field.name}`).join(', ');
    return [`${indent}${type.name}(${positional});`];
  }

  const lines = [`${indent}${type.name}({`];
  for (const field of type.fields) {
    // Campos não-opcionais são `required` — o compilador cobra na construção.
    lines.push(`${indent}${indent}${field.optional ? '' : 'required '}this.${field.name},`);
  }
  lines.push(`${indent}});`);
  return lines;
}

function renderFromJson(context, type, indent) {
  const lines = [`${indent}factory ${type.name}.fromJson(Map<String, dynamic> json) => ${type.name}(`];
  for (const field of type.fields) {
    lines.push(`${indent}${indent}${field.name}: ${readExpression(context, field)},`);
  }
  lines.push(`${indent});`);
  return lines;
}

/** Expressão que lê um campo do mapa decodificado, com o cast certo. */
function readExpression(context, field) {
  const access = `json['${field.wireName}']`;
  const type = field.type;
  const optional = field.optional;

  if (type.kind === 'list') {
    const inner = renderTypeName(context, type.of);
    const element = type.of.kind === 'ref'
      ? `${inner}.fromJson(e as Map<String, dynamic>)`
      : DATE_KINDS.has(type.of.kind) ? 'DateTime.parse(e as String)' : `e as ${inner}`;
    const expression = `(${access} as List<dynamic>).map((e) => ${element}).toList()`;
    return optional ? `${access} == null ? null : ${expression}` : expression;
  }

  if (type.kind === 'map') {
    const inner = renderTypeName(context, type.of);
    const expression = `(${access} as Map<String, dynamic>).map((k, v) => MapEntry(k, v as ${inner}))`;
    return optional ? `${access} == null ? null : ${expression}` : expression;
  }

  if (type.kind === 'ref') {
    const expression = `${type.name}.fromJson(${access} as Map<String, dynamic>)`;
    return optional ? `${access} == null ? null : ${expression}` : expression;
  }

  if (DATE_KINDS.has(type.kind)) {
    return optional
      ? `${access} == null ? null : DateTime.parse(${access} as String)`
      : `DateTime.parse(${access} as String)`;
  }

  const name = renderTypeName(context, type);
  return name === 'dynamic' ? access : `${access} as ${name}${optional ? '?' : ''}`;
}

function renderToJson(context, type, indent) {
  const lines = [`${indent}Map<String, dynamic> toJson() => {`];
  for (const field of type.fields) {
    lines.push(`${indent}${indent}'${field.wireName}': ${writeExpression(context, field)},`);
  }
  lines.push(`${indent}};`);
  return lines;
}

function writeExpression(context, field) {
  const name = field.name;
  const type = field.type;
  const optional = field.optional;

  if (type.kind === 'ref') return optional ? `${name}?.toJson()` : `${name}.toJson()`;
  if (type.kind === 'list' && type.of.kind === 'ref') {
    return optional ? `${name}?.map((e) => e.toJson()).toList()` : `${name}.map((e) => e.toJson()).toList()`;
  }
  if (DATE_KINDS.has(type.kind)) {
    return optional ? `${name}?.toIso8601String()` : `${name}.toIso8601String()`;
  }
  return name;
}

const toCamel = (name) => {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};
