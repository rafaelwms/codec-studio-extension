/**
 * Formato TypeScript: `interface`, `type` ou classe.
 *
 * O estilo "angular" também vive aqui: Angular não é uma linguagem, é um
 * framework sobre TypeScript. Na prática, um modelo Angular idiomático é uma
 * classe com construtor tipado — então tratamos como um estilo de emissão, e não
 * como um formato à parte.
 */

import { msg } from '../messages.js';
import { addType, addWarning, createIR, list, map, orderedTypes, ref, scalar, uniqueTypeName } from '../ir.js';
import { toClassName, toFieldName } from '../naming.js';
import { matchPair, scanMembers, splitGeneric, splitTopLevel, stripComments } from '../parse-utils.js';
import { CodecError } from '../base64.js';

export const id = 'typescript';
export const label = 'TypeScript';
export const kind = 'lang';
export const highlight = 'typescript';
export const extension = 'ts';

export const defaults = {
  style: 'interface', // 'interface' | 'type' | 'class' | 'angular'
  exportTypes: true,
  optionalMarker: true, // campo? em vez de | null
  readonlyFields: false,
  useDate: false,       // Date em vez de string para datas
  indent: 2,
};

const TO_IR = {
  string: 'string', number: 'double', boolean: 'bool', bigint: 'long',
  Date: 'datetime', any: 'any', unknown: 'any', object: 'any', never: 'any', void: 'any', null: 'any',
};

const FROM_IR = {
  string: 'string', int: 'number', long: 'number', double: 'number', decimal: 'number',
  bool: 'boolean', date: 'string', datetime: 'string', datetimetz: 'string',
  time: 'string', duration: 'string', uuid: 'string', uri: 'string', any: 'unknown',
};

const DATE_KINDS = new Set(['date', 'datetime', 'datetimetz']);

/* ------------------------------------------------------------------ leitura */

const TYPE_HEADER = /(?:^|[\s;}])(?:export\s+|declare\s+)*(interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/g;

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

    if (keyword === 'type' && braceIndex === -1) {
      // Alias simples (type Id = string): sem estrutura para modelar.
      TYPE_HEADER.lastIndex = match.index + match[0].length;
      match = TYPE_HEADER.exec(code);
      continue;
    }
    if (braceIndex === -1) break;

    const close = matchPair(code, braceIndex, '{', '}');
    const body = code.slice(braceIndex + 1, close);

    if (keyword === 'enum') {
      const constants = splitTopLevel(body).map((entry) => (/^([A-Za-z_$][\w$]*)/.exec(entry.trim()) || [])[1]).filter(Boolean);
      addType(ir, { kind: 'enum', name, constants });
      declared.push({ name, kind: 'enum', rawFields: [] });
    } else {
      addType(ir, { kind: 'object', name, fields: [] });
      declared.push({ name, kind: keyword, rawFields: parseMembers(body) });
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
      wireName: field.name,
      type: typeToIR(field.type, ir, field.name),
      optional: field.optional,
    }));
  }

  const first = declared.find((entry) => entry.kind !== 'enum') || declared[0];
  ir.rootName = options.rootType && ir.types.some((type) => type.name === options.rootType)
    ? options.rootType
    : first.name;
  return ir;
}

function parseMembers(body) {
  const fields = [];

  // Membros terminam em ";", "," ou quebra de linha. Trocar todas as vírgulas por
  // ";" quebraria `Record<string, number>`, então só separamos no nível externo.
  scanMembers(splitMembers(body).join(';'), {
    statementEnd: ';',
    onStatement(statement) {
      const text = statement.trim();
      if (!text || /^(constructor|get|set|static|private|public|protected|async|function)\b/.test(text)) return;
      if (/\)\s*(:|$)/.test(text) && /\(/.test(text)) return; // assinatura de método

      const match = /^(readonly\s+)?\[?["']?([A-Za-z_$][\w$]*)["']?\]?\s*(\?)?\s*:\s*(.+)$/.exec(text);
      if (!match) return;

      const [, , name, optionalMark, rawType] = match;
      const type = rawType.trim();
      const nullable = /\|\s*(null|undefined)\b/.test(type) || Boolean(optionalMark);
      fields.push({ name, type: type.replace(/\|\s*(null|undefined)\b/g, '').trim(), optional: nullable });
    },
  });

  return fields;
}

/** Divide membros por vírgula/ponto-e-vírgula/nova linha de nível externo. */
function splitMembers(body) {
  const parts = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '<' || char === '(' || char === '[' || char === '{') depth += 1;
    if (char === '>' || char === ')' || char === ']' || char === '}') depth -= 1;

    if (depth === 0 && (char === ',' || char === ';' || char === '\n')) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function typeToIR(raw, ir, fieldName) {
  let text = String(raw).trim().replace(/;$/, '');

  // União de literais ('open' | 'paid') carrega os valores possíveis: vira enum,
  // o que dá um tipo de verdade ao converter para Java, C#, Swift…
  if (/^(['"][^'"]*['"]\s*\|\s*)+['"][^'"]*['"]$/.test(text)) {
    const values = [...text.matchAll(/['"]([^'"]*)['"]/g)].map((entry) => entry[1]);
    const name = uniqueTypeName(ir, toClassName(fieldName || 'Value'));
    addType(ir, { kind: 'enum', name, constants: values });
    return ref(name);
  }
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
  if (text.endsWith('[]')) return list(typeToIR(text.slice(0, -2), ir));

  const { base, args } = splitGeneric(text);
  const simple = base.split('.').pop();

  if (simple === 'Array' || simple === 'ReadonlyArray') return list(args.length ? typeToIR(args[0], ir) : scalar('any'));
  if (simple === 'Record' || simple === 'Map') return map(args.length > 1 ? typeToIR(args[1], ir) : scalar('any'));
  if (simple === 'Partial' || simple === 'Readonly') return args.length ? typeToIR(args[0], ir) : scalar('any');
  if (/^\{.*\}$/s.test(text)) return scalar('any'); // objeto inline anônimo
  if (ir.types.some((type) => type.name === simple)) return ref(simple);
  if (TO_IR[simple]) return scalar(TO_IR[simple]);
  if (/^['"]/.test(text)) return scalar('string');

  addWarning(ir, msg('core.lang.unknownType', { name: simple || text, lang: label }));
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
  if (ir.rootIsList) parts.push(msg('core.lang.rootArrayNote', { type: `${types[0].name}[]` }));
  parts.push(types.map((type) => renderType(context, type, indent)).join('\n\n'));

  return { output: `${parts.join('\n\n').trimEnd()}\n`, warnings: context.warnings };
}

function renderTypeName(context, type) {
  switch (type.kind) {
    case 'ref':
      return type.name;
    case 'list':
      return `${wrapUnion(renderTypeName(context, type.of))}[]`;
    case 'map':
      return `Record<string, ${renderTypeName(context, type.of)}>`;
    default:
      if (context.options.useDate && DATE_KINDS.has(type.kind)) return 'Date';
      return FROM_IR[type.kind] || 'unknown';
  }
}

/** `(A | B)[]` precisa dos parênteses; `A[]` não. */
const wrapUnion = (name) => (name.includes('|') ? `(${name})` : name);

function renderType(context, type, indent) {
  const { options } = context;
  const exported = options.exportTypes ? 'export ' : '';

  if (type.kind === 'enum') {
    const constants = type.constants.length ? type.constants : ['VALUE'];
    const entries = constants.map((name) => `${indent}${name} = '${name}',`).join('\n');
    return `${exported}enum ${type.name} {\n${entries}\n}`;
  }

  if (options.style === 'class' || options.style === 'angular') return renderClass(context, type, indent);

  const members = type.fields.map((field) => `${indent}${renderMember(context, field)}`).join('\n');
  if (options.style === 'type') {
    return `${exported}type ${type.name} = {\n${members}\n};`;
  }
  return `${exported}interface ${type.name} {\n${members}\n}`;
}

function renderMember(context, field) {
  const { options } = context;
  const readonly = options.readonlyFields ? 'readonly ' : '';
  const name = safeKey(field.wireName);
  const declared = renderTypeName(context, field.type);

  if (!field.optional) return `${readonly}${name}: ${declared};`;
  return options.optionalMarker
    ? `${readonly}${name}?: ${declared};`
    : `${readonly}${name}: ${declared} | null;`;
}

/** Chaves que não são identificadores válidos vão entre aspas. */
function safeKey(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`;
}

function renderClass(context, type, indent) {
  const { options } = context;
  const exported = options.exportTypes ? 'export ' : '';
  const lines = [`${exported}class ${type.name} {`];

  for (const field of type.fields) {
    lines.push(`${indent}${renderMember(context, field)}`);
  }

  if (type.fields.length > 0) {
    // Construtor por objeto: o padrão em modelos Angular, e sobrevive a
    // reordenação de campos.
    lines.push('');
    lines.push(`${indent}constructor(init: Partial<${type.name}> = {}) {`);
    lines.push(`${indent}${indent}Object.assign(this, init);`);
    lines.push(`${indent}}`);
  }

  lines.push('}');
  return lines.join('\n');
}
