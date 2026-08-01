/**
 * Modelo intermediário (IR) — o centro de toda conversão.
 *
 * Em vez de escrever um conversor para cada par de formatos (o que cresceria ao
 * quadrado), cada formato implementa no máximo duas peças:
 *
 *   parse:  texto do formato  →  IR
 *   emit:   IR                →  texto do formato
 *
 * Com isso, N formatos produzem N×(N−1) conversões sem código específico por par.
 *
 * O IR descreve *forma de dados*: quais tipos existem, quais campos cada um tem e
 * qual o tipo de cada campo. Não guarda valores — os valores de exemplo usados ao
 * emitir JSON/YAML são derivados do IR em `data-model.js`.
 */

/* ------------------------------------------------------------------- tipos -- */

/**
 * Tipos escalares reconhecidos. Cada emissor mapeia estes nomes para o tipo
 * nativo da sua linguagem; nenhum deles é específico de uma linguagem.
 * @typedef {'string'|'int'|'long'|'double'|'decimal'|'bool'|'date'|'datetime'|
 *           'datetimetz'|'time'|'duration'|'uuid'|'uri'|'any'} ScalarKind
 */

export const SCALARS = new Set([
  'string', 'int', 'long', 'double', 'decimal', 'bool',
  'date', 'datetime', 'datetimetz', 'time', 'duration', 'uuid', 'uri', 'any',
]);

export const scalar = (kind) => ({ kind: SCALARS.has(kind) ? kind : 'any' });
export const list = (of) => ({ kind: 'list', of });
export const map = (of) => ({ kind: 'map', of });
export const ref = (name) => ({ kind: 'ref', name });

export const isScalar = (type) => SCALARS.has(type.kind);
export const isRef = (type) => type.kind === 'ref';

/* ------------------------------------------------------------------ modelo -- */

/**
 * @typedef {Object} Field
 * @property {string} name        nome canônico do campo (camelCase)
 * @property {string} wireName    nome no documento serializado (chave JSON/YAML)
 * @property {any} type
 * @property {boolean} optional   pode faltar ou vir nulo
 *
 * @typedef {Object} TypeDecl
 * @property {'object'|'enum'} kind
 * @property {string} name
 * @property {Field[]} fields
 * @property {string[]} constants apenas para enums
 *
 * @typedef {Object} IR
 * @property {TypeDecl[]} types    ordem de declaração; o primeiro é a raiz
 * @property {string} rootName
 * @property {boolean} rootIsList  o documento raiz é uma coleção do tipo raiz
 * @property {string[]} warnings
 */

/** Cria um IR vazio e consistente. */
export function createIR(rootName = 'Root') {
  return { types: [], rootName, rootIsList: false, warnings: [] };
}

export function addType(ir, declaration) {
  const type = {
    kind: 'object',
    fields: [],
    constants: [],
    ...declaration,
  };
  ir.types.push(type);
  return type;
}

export function findType(ir, name) {
  return ir.types.find((type) => type.name === name);
}

export function addWarning(ir, message) {
  if (message && !ir.warnings.includes(message)) ir.warnings.push(message);
}

/**
 * Garante um nome de tipo único dentro do IR, com sufixo numérico quando preciso.
 * @param {IR} ir
 * @param {string} base
 */
export function uniqueTypeName(ir, base) {
  const clean = base || 'Type';
  if (!findType(ir, clean)) return clean;
  let counter = 2;
  while (findType(ir, `${clean}${counter}`)) counter += 1;
  return `${clean}${counter}`;
}

/**
 * Ordena os tipos com a raiz primeiro, preservando a ordem de descoberta para o
 * restante — a saída de qualquer emissor fica estável e previsível.
 * @param {IR} ir
 */
export function orderedTypes(ir) {
  const root = findType(ir, ir.rootName);
  if (!root) return ir.types;
  return [root, ...ir.types.filter((type) => type !== root)];
}

/**
 * Percorre todos os tipos referenciados a partir da raiz, na ordem em que
 * aparecem. Emissores usam isso para não emitir tipos órfãos.
 * @param {IR} ir
 */
export function reachableTypes(ir) {
  const seen = new Set();
  const result = [];

  const visitType = (name) => {
    if (!name || seen.has(name)) return;
    const declaration = findType(ir, name);
    if (!declaration) return;
    seen.add(name);
    result.push(declaration);
    for (const field of declaration.fields) visitValue(field.type);
  };

  const visitValue = (type) => {
    if (!type) return;
    if (type.kind === 'ref') visitType(type.name);
    else if (type.kind === 'list' || type.kind === 'map') visitValue(type.of);
  };

  visitType(ir.rootName);
  // Tipos não alcançáveis (enums soltos, por exemplo) entram no fim.
  for (const declaration of ir.types) {
    if (!seen.has(declaration.name)) result.push(declaration);
  }
  return result;
}

/* -------------------------------------------------------------- unificação -- */

const NUMERIC_ORDER = ['int', 'long', 'double', 'decimal'];

/**
 * Combina dois tipos observados no mesmo campo num tipo que comporta ambos.
 * Usado quando um array traz objetos com formas ligeiramente diferentes.
 */
export function unify(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.kind === 'any') return b.kind === 'any' ? a : b;
  if (b.kind === 'any') return a;

  if (a.kind === b.kind) {
    if (a.kind === 'list' || a.kind === 'map') {
      return { kind: a.kind, of: unify(a.of, b.of) };
    }
    if (a.kind === 'ref') return a.name === b.name ? a : scalar('any');
    return a;
  }

  // Números convivem promovendo para o tipo mais abrangente.
  const indexA = NUMERIC_ORDER.indexOf(a.kind);
  const indexB = NUMERIC_ORDER.indexOf(b.kind);
  if (indexA !== -1 && indexB !== -1) return scalar(NUMERIC_ORDER[Math.max(indexA, indexB)]);

  // Um tipo temporal misturado com string vira string: é como o dado chega.
  const temporal = new Set(['date', 'datetime', 'datetimetz', 'time', 'duration', 'uuid', 'uri']);
  if ((temporal.has(a.kind) && b.kind === 'string') || (temporal.has(b.kind) && a.kind === 'string')) {
    return scalar('string');
  }

  return scalar('any');
}
