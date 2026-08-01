/**
 * Ponte entre *dados* (JSON, YAML) e o modelo intermediário.
 *
 *   inferIR(valor)   → IR   : deduz a forma dos tipos a partir de um documento
 *   sampleData(IR)   → valor: monta um documento de exemplo a partir dos tipos
 *
 * Os dois formatos de dados que suportamos (JSON e YAML) compartilham este
 * arquivo por inteiro: eles diferem apenas na sintaxe de leitura e escrita.
 */

import { msg } from './messages.js';
import { addType, addWarning, createIR, findType, list, map, ref, scalar, unify, uniqueTypeName } from './ir.js';
import { singularize, toClassName, toFieldName } from './naming.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?$/;
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;
const ISO_TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URI_RE = /^(https?|ftp):\/\/\S+$/i;
const DYNAMIC_KEY = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/* ------------------------------------------------------------- inferência -- */

/**
 * @param {any} value documento já decodificado (JSON.parse ou parseYaml)
 * @param {{rootName?: string, detectDateTime?: boolean}} [options]
 * @returns {import('./ir.js').IR}
 */
export function inferIR(value, options = {}) {
  const { rootName = 'Root', detectDateTime = true } = options;
  const ir = createIR(toClassName(rootName));
  const context = { ir, detectDateTime };

  if (Array.isArray(value)) {
    const type = describe(context, [value], ir.rootName);
    ir.rootIsList = true;
    if (type.kind === 'list' && type.of.kind === 'ref') {
      ir.rootName = type.of.name;
    } else {
      // Array de escalares: não há tipo para declarar.
      ir.rootName = '';
      ir.rootScalar = type.kind === 'list' ? type.of : scalar('any');
      ir.rootLabel = 'array';
      addWarning(ir, msg('core.data.rootIsArrayOfScalars'));
    }
    return ir;
  }

  if (isPlainObject(value)) {
    const type = describeObject(context, [value], ir.rootName);
    ir.rootName = type.name;
    return ir;
  }

  ir.rootName = '';
  ir.rootScalar = describe(context, [value], 'Value');
  ir.rootLabel = typeof value; // preservado para as mensagens de erro dos emissores
  addWarning(ir, msg('core.data.rootIsScalar', { type: ir.rootLabel }));
  return ir;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Unifica todos os valores observados num mesmo campo em um tipo do IR. */
function describe(context, values, hint) {
  const present = values.filter((value) => value !== undefined);
  const nonNull = present.filter((value) => value !== null);
  if (nonNull.length === 0) return scalar('any');

  const kinds = new Set(nonNull.map(kindOf));

  if (kinds.size > 1) {
    const numeric = [...kinds].every((kind) => kind === 'int' || kind === 'double');
    if (numeric) return numberType(nonNull);
    addWarning(context.ir, msg('core.data.mixedTypes', { name: hint, types: [...kinds].sort().join(', ') }));
    return scalar('any');
  }

  switch ([...kinds][0]) {
    case 'bool':
      return scalar('bool');
    case 'int':
    case 'double':
      return numberType(nonNull);
    case 'string':
      return stringType(context, nonNull);
    case 'array': {
      const items = nonNull.flat();
      if (items.length === 0) {
        addWarning(context.ir, msg('core.data.emptyArray', { name: hint }));
        return list(scalar('any'));
      }
      return list(describe(context, items, singularize(hint)));
    }
    case 'object': {
      const asMap = detectMap(context, nonNull, hint);
      if (asMap) return asMap;
      const declaration = describeObject(context, nonNull, hint);
      return ref(declaration.name);
    }
    default:
      return scalar('any');
  }
}

function kindOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
  return 'string';
}

function numberType(values) {
  if (!values.every((value) => Number.isInteger(value))) return scalar('double');
  const max = values.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0);
  if (max > Number.MAX_SAFE_INTEGER) return scalar('decimal');
  if (max > 2147483647) return scalar('long');
  return scalar('int');
}

function stringType(context, values) {
  if (!context.detectDateTime) return scalar('string');
  const all = (regex) => values.every((value) => regex.test(value));
  if (all(UUID_RE)) return scalar('uuid');
  if (all(ISO_OFFSET)) return scalar('datetimetz');
  if (all(ISO_DATE_TIME)) return scalar('datetime');
  if (all(ISO_DATE)) return scalar('date');
  if (all(ISO_TIME)) return scalar('time');
  if (all(URI_RE)) return scalar('uri');
  return scalar('string');
}

/** Objeto com chaves dinâmicas (ids, uuids) vira um dicionário, não uma classe. */
function detectMap(context, objects, hint) {
  const keys = objects.flatMap((object) => Object.keys(object));
  if (keys.length < 2 || !keys.every((key) => DYNAMIC_KEY.test(key))) return null;
  const valueType = describe(
    context,
    objects.flatMap((object) => Object.values(object)),
    singularize(hint),
  );
  addWarning(context.ir, msg('core.data.dynamicKeys', { name: hint }));
  return map(valueType);
}

function describeObject(context, objects, hint) {
  const { ir } = context;
  const name = uniqueTypeName(ir, toClassName(hint) || 'Type');
  const declaration = addType(ir, { kind: 'object', name });

  // União das chaves, preservando a ordem de primeira aparição.
  const keys = [];
  for (const object of objects) {
    for (const key of Object.keys(object)) if (!keys.includes(key)) keys.push(key);
  }

  const used = new Set();
  for (const key of keys) {
    const values = objects.map((object) => (key in object ? object[key] : undefined));
    const optional = values.some((value) => value === undefined || value === null);

    let fieldName = toFieldName(key);
    let candidate = fieldName;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = `${fieldName}${counter}`;
      counter += 1;
    }
    fieldName = candidate;
    used.add(fieldName);

    declaration.fields.push({
      name: fieldName,
      wireName: key,
      type: describe(context, values, key),
      optional,
    });
  }

  if (declaration.fields.length === 0) {
    addWarning(ir, msg('core.data.emptyObject', { name: hint, className: name }));
  }
  return declaration;
}

/**
 * Funde dois IRs de tipos com o mesmo nome — usado quando um parser encontra a
 * mesma estrutura mais de uma vez.
 */
export function mergeFields(target, incoming) {
  for (const field of incoming) {
    const existing = target.find((candidate) => candidate.wireName === field.wireName);
    if (existing) {
      existing.type = unify(existing.type, field.type);
      existing.optional = existing.optional || field.optional;
    } else {
      target.push({ ...field, optional: true });
    }
  }
  return target;
}

/* --------------------------------------------------------- dados de exemplo -- */

const SAMPLE_BY_KIND = {
  bool: () => true,
  date: () => '2026-07-30',
  datetime: () => '2026-07-30T10:15:30',
  datetimetz: () => '2026-07-30T10:15:30Z',
  time: () => '10:15:30',
  duration: () => 'PT1H30M',
  uuid: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  uri: () => msg('core.sample.url'),
};

const EMPTY_BY_KIND = {
  bool: () => false,
  int: () => 0,
  long: () => 0,
  double: () => 0,
  decimal: () => 0,
};

/**
 * Monta um documento de exemplo a partir do IR.
 * @param {import('./ir.js').IR} ir
 * @param {{values?: 'example'|'empty', maxDepth?: number}} [options]
 */
export function sampleData(ir, options = {}) {
  const { values = 'example', maxDepth = 12 } = options;
  const context = { ir, values, maxDepth, stack: new Set(), warnings: new Set() };

  const root = ir.rootName ? findType(ir, ir.rootName) : null;
  const value = root
    ? valueForType(context, root, 0)
    : valueForType2(context, ir.rootScalar || scalar('any'), null, 0);

  const document = ir.rootIsList ? [value] : value;
  return { value: document, warnings: [...context.warnings] };
}

function valueForType(context, declaration, depth) {
  if (declaration.kind === 'enum') return declaration.constants[0] ?? 'VALUE';

  if (context.stack.has(declaration.name)) {
    context.warnings.add(msg('core.data.cyclic', { name: declaration.name }));
    return null;
  }
  if (depth > context.maxDepth) return null;

  context.stack.add(declaration.name);
  const result = {};
  for (const field of declaration.fields) {
    result[field.wireName] = valueForType2(context, field.type, field, depth + 1);
  }
  context.stack.delete(declaration.name);

  if (declaration.fields.length === 0) {
    context.warnings.add(msg('core.data.noFields', { name: declaration.name }));
  }
  return result;
}

function valueForType2(context, type, field, depth) {
  if (!type || depth > context.maxDepth) return null;
  const empty = context.values === 'empty';

  switch (type.kind) {
    case 'list':
      return empty ? [] : [valueForType2(context, type.of, field, depth + 1)];
    case 'map':
      return empty ? {} : { [msg('core.sample.mapKey')]: valueForType2(context, type.of, field, depth + 1) };
    case 'ref': {
      const declaration = findType(context.ir, type.name);
      if (!declaration) return {};
      return valueForType(context, declaration, depth);
    }
    case 'any':
      return empty ? null : {};
    default:
      return scalarSample(context, type.kind, field, empty);
  }
}

function scalarSample(context, kind, field, empty) {
  if (empty) {
    if (kind === 'string') return '';
    const factory = EMPTY_BY_KIND[kind];
    return factory ? factory() : '';
  }

  const factory = SAMPLE_BY_KIND[kind];
  if (factory) return factory();

  const name = (field?.wireName || field?.name || '').toLowerCase();
  if (kind === 'int' || kind === 'long') return sampleInteger(name);
  if (kind === 'double' || kind === 'decimal') return sampleDecimal(name);
  return sampleString(name);
}

function sampleString(name) {
  // Documentos brasileiros mantêm o formato nacional em qualquer idioma.
  if (/mail/.test(name)) return msg('core.sample.email');
  if (/(url|link|site|href)/.test(name)) return msg('core.sample.url');
  if (/(phone|telefone|celular)/.test(name)) return msg('core.sample.phone');
  if (/cpf/.test(name)) return '000.000.000-00';
  if (/cnpj/.test(name)) return '00.000.000/0000-00';
  if (/(cep|zip|postal)/.test(name)) return msg('core.sample.zip');
  if (/(uuid|guid)/.test(name)) return '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  if (/(password|senha|token|secret)/.test(name)) return msg('core.sample.masked');
  if (/(city|cidade)/.test(name)) return msg('core.sample.city');
  if (/(state|estado|uf)/.test(name)) return msg('core.sample.state');
  if (/(country|pais|país)/.test(name)) return msg('core.sample.country');
  if (/(status|situacao|situação)/.test(name)) return msg('core.sample.status');
  if (/(descricao|descrição|description|desc)/.test(name)) return msg('core.sample.description');
  if (/(title|titulo|título)/.test(name)) return msg('core.sample.title');
  if (/(name|nome)/.test(name)) return msg('core.sample.name');
  if (/(date|data)/.test(name)) return '2026-07-30';
  return msg('core.sample.text');
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
