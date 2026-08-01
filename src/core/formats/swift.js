/**
 * Formato Swift: `struct` (ou `class`) em conformidade com `Codable`.
 */

import { msg } from '../messages.js';
import { addType, addWarning, createIR, list, map, orderedTypes, ref, scalar } from '../ir.js';
import { toFieldName, toPascalCase } from '../naming.js';
import { matchPair, splitGeneric, splitTopLevel, stripComments } from '../parse-utils.js';
import { CodecError } from '../base64.js';

export const id = 'swift';
export const label = 'Swift';
export const kind = 'lang';
export const highlight = 'swift';
export const extension = 'swift';

export const defaults = {
  style: 'struct', // 'struct' | 'class'
  codable: true,
  letConstants: true, // let em vez de var
  codingKeys: true,   // enum CodingKeys quando algum nome difere
  useFoundation: true,
  indent: 4,
};

const TO_IR = {
  String: 'string', Character: 'string', Substring: 'string',
  Int: 'int', Int8: 'int', Int16: 'int', Int32: 'int', UInt: 'int', UInt8: 'int', UInt16: 'int', UInt32: 'int',
  Int64: 'long', UInt64: 'long',
  Double: 'double', Float: 'double', CGFloat: 'double', Decimal: 'decimal', NSDecimalNumber: 'decimal',
  Bool: 'bool', Date: 'datetimetz', UUID: 'uuid', URL: 'uri', Data: 'string',
  TimeInterval: 'double', Any: 'any', AnyCodable: 'any',
};

const FROM_IR = {
  string: 'String', int: 'Int', long: 'Int64', double: 'Double', decimal: 'Decimal',
  bool: 'Bool', date: 'Date', datetime: 'Date', datetimetz: 'Date',
  time: 'String', duration: 'String', uuid: 'UUID', uri: 'URL', any: 'String',
};

const FOUNDATION = new Set(['Date', 'UUID', 'URL', 'Decimal', 'Data']);

/* ------------------------------------------------------------------ leitura */

const TYPE_HEADER = /(?:^|[\s;}])(?:public\s+|internal\s+|private\s+|fileprivate\s+|final\s+|open\s+)*(struct|class|enum)\s+([A-Za-z_]\w*)/g;

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

    // Enum com casos é enumeração; enum usado como namespace tem propriedades.
    const cases = [...body.matchAll(/\bcase\s+([A-Za-z_]\w*)/g)].map((entry) => entry[1]);
    if (keyword === 'enum' && cases.length > 0) {
      addType(ir, { kind: 'enum', name, constants: cases });
      declared.push({ name, kind: 'enum', rawFields: [] });
    } else {
      addType(ir, { kind: 'object', name, fields: [] });
      declared.push({ name, kind: keyword, rawFields: parseProperties(body), rawBody: body });
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
    const keys = parseCodingKeys(entry.rawBody);
    declaration.fields = entry.rawFields.map((field) => ({
      name: toFieldName(field.name),
      wireName: keys[field.name] || field.name,
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

/** `let nome: String` / `var idade: Int?` — só propriedades armazenadas. */
function parseProperties(body) {
  const fields = [];

  // `struct X { let a: Int; let b: String }` põe vários membros numa linha só.
  for (const rawLine of body.split(/[\n;]/)) {
    const line = rawLine.trim();
    const match = /^(?:@\w+\s+)*(?:public|private|internal|fileprivate|open)?\s*(?:static\s+)?(let|var)\s+([A-Za-z_]\w*)\s*:\s*([^={]+?)\s*(?:=|$)/.exec(line);
    if (!match) continue;
    // Propriedade computada tem corpo: `var total: Int { … }`.
    if (/\{\s*$/.test(line) && !/=/.test(line)) continue;

    const [, , name, rawType] = match;
    const type = rawType.trim();
    fields.push({ name, type: type.replace(/[?!]$/, ''), optional: /[?!]$/.test(type) });
  }

  return fields;
}

/** `case criadoEm = "criado_em"` dentro de CodingKeys. */
function parseCodingKeys(body) {
  const keys = {};
  if (!body) return keys;
  for (const match of body.matchAll(/case\s+([A-Za-z_]\w*)\s*=\s*"([^"]*)"/g)) {
    keys[match[1]] = match[2];
  }
  return keys;
}

function typeToIR(raw, ir) {
  let text = String(raw).trim().replace(/[?!]$/, '');

  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1);
    const colon = splitTopLevel(inner, ':');
    // [Chave: Valor] é dicionário; [Elemento] é array.
    if (colon.length === 2) return map(typeToIR(colon[1], ir));
    return list(typeToIR(inner, ir));
  }

  const { base, args } = splitGeneric(text);
  const simple = base.split('.').pop();

  if (simple === 'Array') return list(args.length ? typeToIR(args[0], ir) : scalar('any'));
  if (simple === 'Dictionary') return map(args.length > 1 ? typeToIR(args[1], ir) : scalar('any'));
  if (simple === 'Optional') return args.length ? typeToIR(args[0], ir) : scalar('any');
  if (ir.types.some((type) => type.name === simple)) return ref(simple);
  if (TO_IR[simple]) return scalar(TO_IR[simple]);

  addWarning(ir, msg('core.lang.unknownType', { name: simple, lang: label }));
  return scalar('any');
}

/* ------------------------------------------------------------------ escrita */

export function emit(ir, userOptions = {}) {
  const options = { ...defaults, ...userOptions };
  const indent = ' '.repeat(options.indent);
  const context = { ir, options, needsFoundation: false, warnings: [...ir.warnings] };

  const types = orderedTypes(ir).filter((type) => type.name);
  if (types.length === 0) {
    throw new CodecError('core.lang.rootMustBeObject', {
      hintCode: 'core.lang.rootMustBeObject.hint',
      params: { lang: label },
      hintParams: { lang: label, type: ir.rootLabel || 'empty' },
    });
  }

  const bodies = types.map((type) => renderType(context, type, indent));

  const parts = [msg('core.lang.header', { lang: label })];
  if (options.useFoundation && context.needsFoundation) parts.push('import Foundation');
  if (ir.rootIsList) parts.push(msg('core.lang.rootArrayNote', { type: `[${types[0].name}]` }));
  parts.push(bodies.join('\n\n'));

  return { output: `${parts.join('\n\n').trimEnd()}\n`, warnings: context.warnings };
}

function renderTypeName(context, type) {
  switch (type.kind) {
    case 'ref':
      return type.name;
    case 'list':
      return `[${renderTypeName(context, type.of)}]`;
    case 'map':
      return `[String: ${renderTypeName(context, type.of)}]`;
    default: {
      const name = FROM_IR[type.kind] || 'String';
      if (FOUNDATION.has(name)) context.needsFoundation = true;
      return name;
    }
  }
}

function renderType(context, type, indent) {
  const { options } = context;

  if (type.kind === 'enum') {
    const constants = type.constants.length ? type.constants : ['value'];
    const conformance = options.codable ? ': String, Codable' : '';
    const cases = constants.map((name) => `${indent}case ${toCamel(name)} = "${name}"`).join('\n');
    return `enum ${type.name}${conformance} {\n${cases}\n}`;
  }

  const keyword = options.style === 'class' ? 'class' : 'struct';
  const conformance = options.codable ? ': Codable' : '';
  const binding = options.letConstants ? 'let' : 'var';
  const lines = [`${keyword} ${type.name}${conformance} {`];

  for (const field of type.fields) {
    const declared = renderTypeName(context, field.type);
    lines.push(`${indent}${binding} ${field.name}: ${declared}${field.optional ? '?' : ''}`);
  }

  // CodingKeys só é necessário quando algum nome no documento difere do campo.
  const needsKeys = options.codingKeys && type.fields.some((field) => field.name !== field.wireName);
  if (needsKeys) {
    lines.push('');
    lines.push(`${indent}enum CodingKeys: String, CodingKey {`);
    for (const field of type.fields) {
      lines.push(field.name === field.wireName
        ? `${indent}${indent}case ${field.name}`
        : `${indent}${indent}case ${field.name} = "${field.wireName}"`);
    }
    lines.push(`${indent}}`);
  }

  lines.push('}');
  return lines.join('\n');
}

const toCamel = (name) => {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};
