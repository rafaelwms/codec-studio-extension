/**
 * Formato Go: `type X struct` com tags de serialização.
 */

import { msg } from '../messages.js';
import { addType, addWarning, createIR, list, map, orderedTypes, ref, scalar } from '../ir.js';
import { splitWords, toFieldName, toPascalCase } from '../naming.js';
import { matchPair, stripComments } from '../parse-utils.js';
import { CodecError } from '../base64.js';

export const id = 'go';
export const label = 'Go';
export const kind = 'lang';
export const highlight = 'go';
export const extension = 'go';

export const defaults = {
  jsonTags: true,
  omitempty: true,      // campos opcionais ganham ,omitempty
  pointerOptionals: true, // e viram ponteiro, distinguindo ausente de zero
  packageName: 'main',
  useTime: true,        // time.Time para datas
  indent: '\t',         // Go é tabulado por convenção (gofmt)
};

const TO_IR = {
  string: 'string', rune: 'string', byte: 'int',
  int: 'int', int8: 'int', int16: 'int', int32: 'int', uint: 'int', uint8: 'int', uint16: 'int', uint32: 'int',
  int64: 'long', uint64: 'long',
  float32: 'double', float64: 'double',
  bool: 'bool', any: 'any', interface: 'any',
  'time.Time': 'datetimetz', 'time.Duration': 'duration', 'uuid.UUID': 'uuid', 'url.URL': 'uri',
  'json.RawMessage': 'any', 'decimal.Decimal': 'decimal',
};

const FROM_IR = {
  string: 'string', int: 'int', long: 'int64', double: 'float64', decimal: 'float64',
  bool: 'bool', date: 'time.Time', datetime: 'time.Time', datetimetz: 'time.Time',
  time: 'string', duration: 'time.Duration', uuid: 'string', uri: 'string', any: 'any',
};

const TIME_KINDS = new Set(['date', 'datetime', 'datetimetz', 'duration']);

/**
 * Siglas que o padrão de estilo do Go exige em caixa alta (`ID`, não `Id`).
 * É o tipo de detalhe que um revisor Go aponta em code review.
 */
const INITIALISMS = new Set([
  'acl', 'api', 'ascii', 'cpu', 'css', 'dns', 'eof', 'guid', 'html', 'http', 'https', 'id',
  'ip', 'json', 'lhs', 'qps', 'ram', 'rhs', 'rpc', 'sla', 'smtp', 'sql', 'ssh', 'tcp', 'tls',
  'ttl', 'udp', 'ui', 'uid', 'uuid', 'uri', 'url', 'utf8', 'vm', 'xml', 'xmpp', 'xsrf', 'xss',
]);

/** PascalCase com as siglas do Go em caixa alta. */
function toGoName(name) {
  return splitWords(name)
    .map((word) => (INITIALISMS.has(word.toLowerCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('') || 'Field';
}

/* ------------------------------------------------------------------ leitura */

const STRUCT_HEADER = /type\s+([A-Za-z_]\w*)\s+struct\s*\{/g;

export function parse(source, options = {}) {
  if (!source.trim()) {
    throw new CodecError('core.lang.empty', { hintCode: 'core.lang.empty.hint', params: { lang: label } });
  }

  const code = stripComments(source);
  const ir = createIR();
  const declared = [];

  STRUCT_HEADER.lastIndex = 0;
  let match = STRUCT_HEADER.exec(code);
  while (match) {
    const braceIndex = code.indexOf('{', match.index);
    const close = matchPair(code, braceIndex, '{', '}');
    addType(ir, { kind: 'object', name: match[1], fields: [] });
    declared.push({ name: match[1], rawFields: parseFields(code.slice(braceIndex + 1, close)) });
    STRUCT_HEADER.lastIndex = close;
    match = STRUCT_HEADER.exec(code);
  }

  if (declared.length === 0) {
    throw new CodecError('core.lang.noTypes', { hintCode: 'core.lang.noTypes.hint', params: { lang: label } });
  }

  for (const entry of declared) {
    const declaration = ir.types.find((type) => type.name === entry.name);
    declaration.fields = entry.rawFields.map((field) => ({
      name: toFieldName(field.name),
      wireName: field.wireName,
      type: typeToIR(field.type, ir),
      optional: field.optional,
    }));
  }

  ir.rootName = options.rootType && ir.types.some((type) => type.name === options.rootType)
    ? options.rootType
    : declared[0].name;
  return ir;
}

/** Em Go, cada campo ocupa uma linha: `Nome Tipo \`json:"nome"\``. */
function parseFields(body) {
  const fields = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    // A tag fica entre crases e pode conter espaços.
    const tagMatch = /`([^`]*)`\s*$/.exec(line);
    const tag = tagMatch ? tagMatch[1] : '';
    const declaration = (tagMatch ? line.slice(0, tagMatch.index) : line).trim();

    const match = /^([A-Za-z_]\w*)\s+(.+?)\s*$/.exec(declaration);
    if (!match) continue;

    const [, name, rawType] = match;
    const json = /json:"([^"]*)"/.exec(tag);
    const parts = json ? json[1].split(',') : [];
    if (parts[0] === '-') continue; // campo explicitamente ignorado

    fields.push({
      name,
      wireName: parts[0] || name,
      type: rawType.trim(),
      optional: rawType.trim().startsWith('*') || parts.includes('omitempty'),
    });
  }

  return fields;
}

function typeToIR(raw, ir) {
  let text = String(raw).trim();
  while (text.startsWith('*')) text = text.slice(1).trim();

  if (text.startsWith('[]')) return list(typeToIR(text.slice(2), ir));
  if (text.startsWith('map[')) {
    const close = text.indexOf(']');
    return map(typeToIR(text.slice(close + 1), ir));
  }
  if (text.startsWith('interface{') || text === 'any') return scalar('any');

  if (TO_IR[text]) return scalar(TO_IR[text]);
  if (ir.types.some((type) => type.name === text)) return ref(text);

  const simple = text.split('.').pop();
  if (TO_IR[simple]) return scalar(TO_IR[simple]);
  if (ir.types.some((type) => type.name === simple)) return ref(simple);

  addWarning(ir, msg('core.lang.unknownType', { name: text, lang: label }));
  return scalar('any');
}

/* ------------------------------------------------------------------ escrita */

export function emit(ir, userOptions = {}) {
  const options = { ...defaults, ...userOptions };
  const context = { ir, options, imports: new Set(), warnings: [...ir.warnings] };

  const types = orderedTypes(ir).filter((type) => type.name && type.kind === 'object');
  if (types.length === 0) {
    throw new CodecError('core.lang.rootMustBeObject', {
      hintCode: 'core.lang.rootMustBeObject.hint',
      params: { lang: label },
      hintParams: { lang: label, type: ir.rootLabel || 'empty' },
    });
  }

  const bodies = types.map((type) => renderStruct(context, type));
  const enums = orderedTypes(ir).filter((type) => type.kind === 'enum').map((type) => renderEnum(context, type));

  const parts = [msg('core.lang.header', { lang: label })];
  parts.push(`package ${options.packageName.trim() || 'main'}`);

  if (context.imports.size > 0) {
    const list = [...context.imports].sort();
    parts.push(list.length === 1 ? `import "${list[0]}"` : `import (\n${list.map((entry) => `\t"${entry}"`).join('\n')}\n)`);
  }
  if (ir.rootIsList) parts.push(msg('core.lang.rootArrayNote', { type: `[]${types[0].name}` }));

  parts.push([...bodies, ...enums].join('\n\n'));
  return { output: `${parts.join('\n\n').trimEnd()}\n`, warnings: context.warnings };
}

function renderTypeName(context, type, optional) {
  const pointer = optional && context.options.pointerOptionals ? '*' : '';

  switch (type.kind) {
    case 'ref':
      return `${pointer}${type.name}`;
    case 'list':
      // Slices já são nulos por natureza: ponteiro seria ruído.
      return `[]${renderTypeName(context, type.of, false)}`;
    case 'map':
      return `map[string]${renderTypeName(context, type.of, false)}`;
    default: {
      let name = FROM_IR[type.kind] || 'any';
      if (!context.options.useTime && TIME_KINDS.has(type.kind)) name = 'string';
      if (name.startsWith('time.')) context.imports.add('time');
      return `${pointer}${name}`;
    }
  }
}

function renderStruct(context, type) {
  const { options } = context;
  const indent = options.indent;
  const lines = [`type ${type.name} struct {`];

  // gofmt alinha nome, tipo e tag em colunas — reproduzimos isso.
  const rows = type.fields.map((field) => ({
    name: toGoName(field.name),
    type: renderTypeName(context, field.type, field.optional),
    tag: renderTag(context, field),
  }));

  const nameWidth = Math.max(0, ...rows.map((row) => row.name.length));
  const typeWidth = Math.max(0, ...rows.map((row) => row.type.length));

  for (const row of rows) {
    const name = row.name.padEnd(nameWidth);
    const declared = row.tag ? row.type.padEnd(typeWidth) : row.type;
    lines.push(`${indent}${name} ${declared}${row.tag ? ` ${row.tag}` : ''}`.trimEnd());
  }

  lines.push('}');
  return lines.join('\n');
}

function renderTag(context, field) {
  const { options } = context;
  if (!options.jsonTags) return '';
  const omit = options.omitempty && field.optional ? ',omitempty' : '';
  return `\`json:"${field.wireName}${omit}"\``;
}

/** Go não tem enum: a convenção é um tipo string com constantes. */
function renderEnum(context, type) {
  const constants = type.constants.length ? type.constants : ['Value'];
  const lines = [`type ${type.name} string`, '', 'const ('];
  for (const constant of constants) {
    lines.push(`${context.options.indent}${type.name}${toGoName(constant)} ${type.name} = "${constant}"`);
  }
  lines.push(')');
  return lines.join('\n');
}
