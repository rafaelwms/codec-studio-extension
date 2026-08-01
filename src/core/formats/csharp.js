/**
 * Formato C#: classes com propriedades, `record` ou struct de dados.
 */

import { msg } from '../messages.js';
import { addType, addWarning, createIR, list, map, orderedTypes, ref, scalar } from '../ir.js';
import { toClassName, toFieldName, toPascalCase } from '../naming.js';
import {
  collectAnnotations, firstQuoted, matchPair, scanMembers, splitGeneric, stripComments,
} from '../parse-utils.js';
import { CodecError } from '../base64.js';

export const id = 'csharp';
export const label = 'C#';
export const kind = 'lang';
export const highlight = 'csharp';
export const extension = 'cs';

export const defaults = {
  style: 'class', // 'class' | 'record' | 'struct'
  jsonAttributes: true,      // [JsonPropertyName("…")] quando o nome difere
  jsonAttributesAll: false,
  nullableAnnotations: true, // string? para campos opcionais
  namespaceName: '',
  indent: 4,
};

const TO_IR = {
  string: 'string', String: 'string', char: 'string', Char: 'string', Guid: 'uuid', Uri: 'uri',
  int: 'int', Int32: 'int', short: 'int', Int16: 'int', byte: 'int', sbyte: 'int', uint: 'int',
  long: 'long', Int64: 'long', ulong: 'long', BigInteger: 'long',
  float: 'double', double: 'double', Double: 'double', Single: 'double',
  decimal: 'decimal', Decimal: 'decimal',
  bool: 'bool', Boolean: 'bool',
  DateTime: 'datetime', DateTimeOffset: 'datetimetz', DateOnly: 'date', TimeOnly: 'time',
  TimeSpan: 'duration', object: 'any', Object: 'any', dynamic: 'any', JsonElement: 'any',
};

const FROM_IR = {
  string: 'string', int: 'int', long: 'long', double: 'double', decimal: 'decimal',
  bool: 'bool', date: 'DateOnly', datetime: 'DateTime', datetimetz: 'DateTimeOffset',
  time: 'TimeOnly', duration: 'TimeSpan', uuid: 'Guid', uri: 'Uri', any: 'object',
};

/** Tipos de valor: precisam de `?` para aceitar nulo. */
const VALUE_TYPES = new Set(['int', 'long', 'double', 'decimal', 'bool', 'date', 'datetime', 'datetimetz', 'time', 'duration', 'uuid']);

const COLLECTIONS = new Set(['List', 'IList', 'IEnumerable', 'ICollection', 'IReadOnlyList', 'HashSet', 'ISet', 'Collection', 'Queue', 'Stack']);
const MAPS = new Set(['Dictionary', 'IDictionary', 'IReadOnlyDictionary', 'SortedDictionary']);

/* ------------------------------------------------------------------ leitura */

const TYPE_HEADER = /(?:^|[\s;}])(?:public|internal|private|protected|sealed|abstract|static|partial|readonly|record|\s)*\b(class|record|struct|interface|enum)\s+([A-Za-z_]\w*)/g;

export function parse(source, options = {}) {
  if (!source.trim()) {
    throw new CodecError('core.lang.empty', { hintCode: 'core.lang.empty.hint', params: { lang: label } });
  }

  const code = stripComments(source);
  const ir = createIR();
  const declared = [];

  collectTypes(code, ir, declared);

  if (declared.length === 0) {
    throw new CodecError('core.lang.noTypes', { hintCode: 'core.lang.noTypes.hint', params: { lang: label } });
  }

  // Segunda passada: agora que todos os nomes existem, resolvemos as referências.
  for (const entry of declared) {
    const declaration = ir.types.find((type) => type.name === entry.name);
    if (!declaration || declaration.kind === 'enum') continue;
    declaration.fields = entry.rawFields.map((field) => ({
      name: toFieldName(field.name),
      wireName: field.wireName,
      type: typeToIR(field.type, ir, declaration.name),
      optional: field.optional,
    }));
  }

  const first = declared.find((entry) => entry.kind !== 'enum') || declared[0];
  ir.rootName = options.rootType && ir.types.some((type) => type.name === options.rootType)
    ? options.rootType
    : first.name;
  return ir;
}

function collectTypes(code, ir, declared) {
  TYPE_HEADER.lastIndex = 0;
  let match = TYPE_HEADER.exec(code);

  while (match) {
    const [, keyword, name] = match;
    const braceIndex = code.indexOf('{', match.index + match[0].length);
    if (braceIndex === -1) break;

    // Record posicional: record Pessoa(string Nome, int Idade);
    const parenIndex = code.indexOf('(', match.index + match[0].length);
    const positional = keyword === 'record' && parenIndex !== -1 && parenIndex < braceIndex;

    const close = matchPair(code, braceIndex, '{', '}');
    const body = code.slice(braceIndex + 1, close);

    if (keyword === 'enum') {
      const constants = body.split(',').map((entry) => (/^\s*([A-Za-z_]\w*)/.exec(entry) || [])[1]).filter(Boolean);
      addType(ir, { kind: 'enum', name, constants });
      declared.push({ name, kind: 'enum', rawFields: [] });
    } else {
      const rawFields = positional
        ? parsePositional(code, parenIndex)
        : parseMembers(body);
      addType(ir, { kind: 'object', name, fields: [] });
      declared.push({ name, kind: keyword, rawFields });
    }

    TYPE_HEADER.lastIndex = close;
    match = TYPE_HEADER.exec(code);
  }
}

function parsePositional(code, parenIndex) {
  const close = matchPair(code, parenIndex, '(', ')');
  const inside = code.slice(parenIndex + 1, close);
  const fields = [];

  for (const part of inside.split(/,(?![^<]*>)/)) {
    const parsed = /^\s*(.+?)\s+([A-Za-z_]\w*)\s*$/.exec(part.replace(/\[[^\]]*\]/g, ' ').trim());
    if (!parsed) continue;
    const [, type, name] = parsed;
    fields.push({ type: type.trim(), name, wireName: name, optional: type.trim().endsWith('?') });
  }
  return fields;
}

function parseMembers(body) {
  const fields = [];
  let pendingAttributes = '';

  scanMembers(body, {
    onBlock(header, blockBody) {
      // Propriedade com { get; set; } — o corpo é acessório, o que importa é o cabeçalho.
      if (!/\b(get|set|init)\b/.test(blockBody)) return;
      const field = parseDeclaration(`${pendingAttributes} ${header}`);
      if (field) fields.push(field);
      pendingAttributes = '';
    },
    onStatement(statement) {
      // Atributos soltos numa linha aplicam-se ao próximo membro.
      if (/^\[[^\]]*\]$/.test(statement.trim())) {
        pendingAttributes = `${pendingAttributes} ${statement}`;
        return;
      }
      const field = parseDeclaration(`${pendingAttributes} ${statement}`);
      if (field) fields.push(field);
      pendingAttributes = '';
    },
  });

  return fields;
}

const MODIFIERS = /\b(public|private|protected|internal|static|readonly|const|virtual|override|sealed|required|new|volatile|extern|unsafe|async|partial)\b/g;

function parseDeclaration(text) {
  const attributes = collectAnnotations(text, 'bracket');
  if (attributes.some((attribute) => /^Json(Ignore)$/.test(attribute.name))) return null;

  let declaration = text.replace(/\[[^\]]*\]/g, ' ').replace(MODIFIERS, ' ').trim();
  if (!declaration || /^(namespace|using|return|if|for|foreach|while|switch)\b/.test(declaration)) return null;

  // Corta inicializadores e corpos de expressão.
  const cut = declaration.search(/=>|=(?!=)/);
  if (cut !== -1) declaration = declaration.slice(0, cut).trim();
  // Métodos: parênteses sobrando após remover atributos.
  if (/\)\s*$/.test(declaration) || /\w\s*\(/.test(declaration)) return null;

  const match = /^(.*[\w?>\]])\s+([A-Za-z_]\w*)\s*$/.exec(declaration);
  if (!match) return null;

  const type = match[1].trim();
  const name = match[2];
  const property = attributes.find((attribute) => /^(JsonPropertyName|JsonProperty|DataMember)$/.test(attribute.name));
  // Sem atributo, a chave no documento segue a política padrão do ASP.NET Core
  // (camelCase) — e não o PascalCase da propriedade.
  const wireName = property && firstQuoted(property.args)
    ? firstQuoted(property.args)
    : name.charAt(0).toLowerCase() + name.slice(1);

  return { type, name, wireName, optional: type.endsWith('?') };
}

function typeToIR(raw, ir, owner) {
  let text = String(raw).trim();
  if (text.endsWith('?')) text = text.slice(0, -1).trim();
  if (text.endsWith('[]')) return list(typeToIR(text.slice(0, -2), ir, owner));

  const { base, args } = splitGeneric(text);
  const simple = base.split('.').pop();

  if (COLLECTIONS.has(simple)) return list(args.length ? typeToIR(args[0], ir, owner) : scalar('any'));
  if (MAPS.has(simple)) return map(args.length > 1 ? typeToIR(args[1], ir, owner) : scalar('any'));
  if (simple === 'Nullable') return args.length ? typeToIR(args[0], ir, owner) : scalar('any');
  if (ir.types.some((type) => type.name === simple)) return ref(simple);
  if (TO_IR[simple]) return scalar(TO_IR[simple]);

  addWarning(ir, msg('core.lang.unknownType', { name: simple, lang: label }));
  return scalar('any');
}

/* ------------------------------------------------------------------ escrita */

export function emit(ir, userOptions = {}) {
  const options = { ...defaults, ...userOptions };
  const indent = ' '.repeat(options.indent);
  const context = { ir, options, usings: new Set(), usedJson: false, warnings: [...ir.warnings] };

  const types = orderedTypes(ir).filter((type) => type.name);
  if (types.length === 0) {
    throw new CodecError('core.lang.rootMustBeObject', {
      hintCode: 'core.lang.rootMustBeObject.hint',
      params: { lang: label },
      hintParams: { lang: label, type: ir.rootLabel || 'empty' },
    });
  }

  const bodies = types.map((type) => renderType(context, type, indent));

  const header = [msg('core.lang.header', { lang: label })];
  if (options.jsonAttributes && context.usedJson) context.usings.add('System.Text.Json.Serialization');

  const usings = [...context.usings].sort().map((entry) => `using ${entry};`);
  const parts = [header.join('\n')];
  if (usings.length) parts.push(usings.join('\n'));

  if (ir.rootIsList) {
    parts.push(msg('core.lang.rootArrayNote', { type: `List<${types[0].name}>` }));
  }

  let body = bodies.join('\n\n');
  if (options.namespaceName.trim()) {
    // File-scoped namespace: menos aninhamento, idiomático desde o C# 10.
    parts.push(`namespace ${options.namespaceName.trim()};`);
  }
  parts.push(body);

  return { output: `${parts.filter(Boolean).join('\n\n').trimEnd()}\n`, warnings: context.warnings };
}

function renderTypeName(context, type) {
  switch (type.kind) {
    case 'ref':
      return type.name;
    case 'list':
      context.usings.add('System.Collections.Generic');
      return `List<${renderTypeName(context, type.of)}>`;
    case 'map':
      context.usings.add('System.Collections.Generic');
      return `Dictionary<string, ${renderTypeName(context, type.of)}>`;
    default: {
      const name = FROM_IR[type.kind] || 'object';
      if (name === 'Uri') context.usings.add('System');
      if (['DateTime', 'DateTimeOffset', 'DateOnly', 'TimeOnly', 'TimeSpan', 'Guid'].includes(name)) {
        context.usings.add('System');
      }
      return name;
    }
  }
}

function declaredType(context, field) {
  const base = renderTypeName(context, field.type);
  if (!field.optional || !context.options.nullableAnnotations) return base;
  // Tipos de referência e de valor recebem "?" igualmente em C# moderno.
  return `${base}?`;
}

function attributeFor(context, field) {
  const { options } = context;
  if (!options.jsonAttributes) return '';
  // Propriedades C# são PascalCase, então comparar com o nome cru anotaria tudo.
  // A referência é o camelCase, que é a política padrão do ASP.NET Core.
  const conventional = toCamelCase(toPascalCase(field.name));
  if (!options.jsonAttributesAll && conventional === field.wireName) return '';
  context.usedJson = true;
  return `[JsonPropertyName("${field.wireName}")]`;
}

const toCamelCase = (name) => name.charAt(0).toLowerCase() + name.slice(1);

function renderType(context, type, indent) {
  if (type.kind === 'enum') {
    const constants = type.constants.length ? type.constants : ['Value'];
    return `public enum ${type.name}\n{\n${constants.map((name) => `${indent}${toPascalCase(name)},`).join('\n')}\n}`;
  }

  const { options } = context;
  if (options.style === 'record' && type.fields.length > 0) return renderRecord(context, type, indent);

  const keyword = options.style === 'struct' ? 'struct' : 'class';
  const lines = [`public ${keyword} ${type.name}`, '{'];

  type.fields.forEach((field, index) => {
    const attribute = attributeFor(context, field);
    if (attribute) {
      if (index > 0) lines.push('');
      lines.push(`${indent}${attribute}`);
    }
    lines.push(`${indent}public ${declaredType(context, field)} ${toPascalCase(field.name)} { get; set; }`);
  });

  lines.push('}');
  return lines.join('\n');
}

function renderRecord(context, type, indent) {
  const lines = [`public record ${type.name}(`];
  type.fields.forEach((field, index) => {
    const attribute = attributeFor(context, field);
    const prefix = attribute ? `${attribute} ` : '';
    const comma = index === type.fields.length - 1 ? '' : ',';
    lines.push(`${indent}${prefix}${declaredType(context, field)} ${toPascalCase(field.name)}${comma}`);
  });
  lines.push(');');
  return lines.join('\n');
}
