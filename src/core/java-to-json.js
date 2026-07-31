/**
 * Java → JSON.
 *
 * Recebe classes/records/enums Java e devolve um documento JSON com a mesma forma,
 * preenchido com valores de exemplo (ou vazios) coerentes com cada tipo.
 */

import { CodecError } from './base64.js';
import { flattenTypes, parseJava } from './java-parser.js';

const DEFAULTS = {
  rootType: '', // vazio = escolha automática
  values: 'example', // 'example' | 'empty'
  indent: 2,
  maxDepth: 12,
};

const COLLECTIONS = new Set([
  'List', 'ArrayList', 'LinkedList', 'Collection', 'Iterable', 'Set', 'HashSet',
  'LinkedHashSet', 'TreeSet', 'Queue', 'Deque', 'Stream',
]);
const MAPS = new Set(['Map', 'HashMap', 'LinkedHashMap', 'TreeMap', 'SortedMap', 'Properties']);
const WRAPPERS = new Set(['Optional', 'OptionalInt', 'OptionalLong', 'OptionalDouble', 'AtomicReference']);

/**
 * @param {string} source código Java
 * @param {Partial<typeof DEFAULTS>} [userOptions]
 * @returns {{output: string, warnings: string[], rootName: string, types: string[]}}
 */
export function javaToJson(source, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  if (!source.trim()) {
    throw new CodecError('Nada para converter.', { hint: 'Cole uma classe ou record Java no painel de entrada.' });
  }

  const { types, warnings } = parseJava(source);
  if (types.length === 0) {
    throw new CodecError('Nenhuma classe, record ou enum encontrado.', {
      hint: 'Cole a declaração completa, incluindo "class Nome { … }" ou "record Nome(…) { }".',
    });
  }

  const registry = flattenTypes(types);
  const candidates = types.filter((type) => type.kind === 'class' || type.kind === 'record');
  const rootName = options.rootType && registry.has(options.rootType)
    ? options.rootType
    : (candidates[0] || types[0]).name;

  const root = registry.get(rootName);
  const context = { registry, options, warnings: new Set(warnings), stack: new Set() };
  const value = valueForType(context, root, 0);

  return {
    output: `${JSON.stringify(value, null, options.indent)}\n`,
    warnings: [...context.warnings],
    rootName,
    types: [...registry.keys()],
  };
}

function valueForType(context, type, depth) {
  if (type.kind === 'enum') {
    return type.constants[0] ?? 'VALUE';
  }
  if (type.kind === 'interface' && type.fields.length === 0) {
    context.warnings.add(`"${type.name}" é uma interface sem campos; o objeto ficou vazio.`);
    return {};
  }
  if (context.stack.has(type.name)) {
    context.warnings.add(`Referência cíclica em "${type.name}"; o campo recursivo virou null.`);
    return null;
  }
  if (depth > context.options.maxDepth) return null;

  context.stack.add(type.name);
  const result = {};
  for (const field of type.fields) {
    result[field.jsonName || field.name] = valueForJavaType(context, field.type, field, depth + 1);
  }
  context.stack.delete(type.name);

  if (type.fields.length === 0) {
    context.warnings.add(`"${type.name}" não tem campos de instância; o objeto ficou vazio.`);
  }
  return result;
}

function valueForJavaType(context, rawType, field, depth) {
  const type = String(rawType).trim();
  if (depth > context.options.maxDepth) return null;

  // Arrays: Tipo[] / Tipo[][]
  if (type.endsWith('[]')) {
    const inner = valueForJavaType(context, type.slice(0, -2), field, depth + 1);
    return context.options.values === 'empty' ? [] : [inner];
  }

  const { base, args } = splitGeneric(type);
  const simple = base.split('.').pop();

  if (COLLECTIONS.has(simple)) {
    const inner = args.length ? valueForJavaType(context, args[0], field, depth + 1) : {};
    return context.options.values === 'empty' ? [] : [inner];
  }

  if (MAPS.has(simple)) {
    if (context.options.values === 'empty') return {};
    const valueSample = args.length > 1 ? valueForJavaType(context, args[1], field, depth + 1) : {};
    return { chave: valueSample };
  }

  if (WRAPPERS.has(simple)) {
    return args.length ? valueForJavaType(context, args[0], field, depth + 1) : null;
  }

  const known = context.registry.get(simple);
  if (known) return valueForType(context, known, depth);

  return scalarValue(context, simple, field);
}

function splitGeneric(type) {
  const start = type.indexOf('<');
  if (start === -1) return { base: type, args: [] };
  const end = type.lastIndexOf('>');
  const inside = type.slice(start + 1, end === -1 ? type.length : end);
  const args = [];
  let depth = 0;
  let current = '';
  for (const char of inside) {
    if (char === '<') depth += 1;
    if (char === '>') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(current.trim());
  return { base: type.slice(0, start).trim(), args };
}

function scalarValue(context, simple, field) {
  const empty = context.options.values === 'empty';
  const name = (field?.jsonName || field?.name || '').toLowerCase();

  switch (simple) {
    case 'String':
    case 'CharSequence':
      return empty ? '' : sampleString(name);
    case 'char':
    case 'Character':
      return empty ? '' : 'a';
    case 'boolean':
    case 'Boolean':
      return empty ? false : true;
    case 'byte':
    case 'short':
    case 'int':
    case 'Integer':
    case 'Byte':
    case 'Short':
    case 'long':
    case 'Long':
    case 'BigInteger':
    case 'AtomicInteger':
    case 'AtomicLong':
      return empty ? 0 : sampleInteger(name);
    case 'float':
    case 'double':
    case 'Float':
    case 'Double':
    case 'BigDecimal':
      return empty ? 0 : sampleDecimal(name);
    case 'UUID':
      return empty ? '' : '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    case 'LocalDate':
      return empty ? '' : '2026-07-30';
    case 'LocalTime':
      return empty ? '' : '10:15:30';
    case 'LocalDateTime':
      return empty ? '' : '2026-07-30T10:15:30';
    case 'OffsetDateTime':
    case 'ZonedDateTime':
    case 'Instant':
    case 'Date':
    case 'Timestamp':
      return empty ? '' : '2026-07-30T10:15:30Z';
    case 'Duration':
      return empty ? '' : 'PT1H30M';
    case 'Period':
      return empty ? '' : 'P1M';
    case 'URI':
    case 'URL':
      return empty ? '' : 'https://example.com/recurso';
    case 'Locale':
      return empty ? '' : 'pt-BR';
    case 'Currency':
      return empty ? '' : 'BRL';
    case 'Object':
    case 'JsonNode':
      return empty ? null : {};
    case 'void':
      return null;
    default:
      context.warnings.add(`O tipo "${simple}" é desconhecido; foi gerado como objeto vazio.`);
      return {};
  }
}

function sampleString(name) {
  if (/mail/.test(name)) return 'pessoa@exemplo.com';
  if (/(url|link|site|href)/.test(name)) return 'https://example.com/recurso';
  if (/(phone|telefone|celular)/.test(name)) return '+55 11 90000-0000';
  if (/(cpf)/.test(name)) return '000.000.000-00';
  if (/(cnpj)/.test(name)) return '00.000.000/0000-00';
  if (/(cep|zip|postal)/.test(name)) return '01310-000';
  if (/(uuid|guid)/.test(name)) return '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  if (/(password|senha|token|secret)/.test(name)) return '••••••••';
  if (/(city|cidade)/.test(name)) return 'São Paulo';
  if (/(state|estado|uf)/.test(name)) return 'SP';
  if (/(country|pais|país)/.test(name)) return 'BR';
  if (/(status|situacao|situação)/.test(name)) return 'ACTIVE';
  if (/(descricao|descrição|description|desc)/.test(name)) return 'Descrição de exemplo';
  if (/(title|titulo|título)/.test(name)) return 'Título de exemplo';
  if (/(name|nome)/.test(name)) return 'Maria Silva';
  if (/(date|data)/.test(name)) return '2026-07-30';
  return 'texto';
}

function sampleInteger(name) {
  if (/(id|codigo|código|code)$/.test(name)) return 1;
  if (/(year|ano)/.test(name)) return 2026;
  if (/(age|idade)/.test(name)) return 30;
  if (/(count|total|quantidade|qtd|quantity)/.test(name)) return 3;
  if (/(version|versao|versão)/.test(name)) return 1;
  return 0;
}

function sampleDecimal(name) {
  if (/(price|preco|preço|valor|amount|total)/.test(name)) return 199.9;
  if (/(rate|taxa|percent|percentual)/.test(name)) return 0.15;
  if (/(lat|latitude)/.test(name)) return -23.5505;
  if (/(lng|lon|longitude)/.test(name)) return -46.6333;
  return 0.0;
}
