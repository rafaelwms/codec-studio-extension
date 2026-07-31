/**
 * Parser leve de declarações Java.
 *
 * Não é um compilador: ele varre o código o suficiente para extrair a *forma* dos
 * tipos (classes, records, enums, interfaces) e seus campos, ignorando corpos de
 * métodos, comentários e literais. É o bastante para gerar JSON a partir de POJOs,
 * records e DTOs anotados — que é o caso de uso da extensão.
 */

const TYPE_HEADER = /(?:^|[\s;}])(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;

const SKIP_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized',
  'native', 'strictfp', 'transient', 'volatile', 'default', 'sealed', 'non-sealed',
]);

/**
 * @param {string} source
 * @returns {{types: any[], warnings: string[]}}
 */
export function parseJava(source) {
  const warnings = [];
  const code = stripComments(source);
  const types = parseScope(code, 0, code.length, warnings);
  return { types, warnings };
}

/** Achata a árvore de tipos num mapa nome → declaração. */
export function flattenTypes(types, target = new Map()) {
  for (const type of types) {
    if (!target.has(type.name)) target.set(type.name, type);
    if (type.nested && type.nested.length) flattenTypes(type.nested, target);
  }
  return target;
}

/* ---------------------------------------------------------------- varredura */

function isLiteralStart(source, index) {
  const char = source[index];
  return char === '"' || char === "'";
}

/** Retorna o índice logo após o literal iniciado em `index`. */
function skipLiteral(source, index) {
  if (source.startsWith('"""', index)) {
    const end = source.indexOf('"""', index + 3);
    return end === -1 ? source.length : end + 3;
  }
  const quoteChar = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quoteChar) return i + 1;
    if (source[i] === '\n') return i; // literal não fechado: aborta na linha
    i += 1;
  }
  return source.length;
}

function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (isLiteralStart(source, i)) {
      const end = skipLiteral(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      // preserva quebras de linha para não colar declarações
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function matchPair(source, index, open, close) {
  let depth = 0;
  let i = index;
  while (i < source.length) {
    if (isLiteralStart(source, i)) {
      i = skipLiteral(source, i);
      continue;
    }
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return source.length - 1;
}

/** Analisa um escopo (arquivo ou corpo de tipo) e devolve as declarações encontradas. */
function parseScope(source, from, to, warnings) {
  const types = [];
  let buffer = '';
  let i = from;

  while (i < to) {
    if (isLiteralStart(source, i)) {
      const end = skipLiteral(source, i);
      buffer += source.slice(i, end);
      i = end;
      continue;
    }

    const char = source[i];

    if (char === '(') {
      const close = matchPair(source, i, '(', ')');
      buffer += source.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    if (char === '{') {
      const close = matchPair(source, i, '{', '}');
      const header = buffer;
      const declaration = matchTypeHeader(header);

      if (declaration) {
        types.push(buildType(declaration, header, source, i + 1, close, warnings));
        buffer = '';
      } else if (/=\s*$/.test(header.trimEnd()) || /=\s*[^=]*$/.test(header)) {
        // inicializador de array ou lambda: mantém o buffer para não perder o campo
        buffer += ' ';
      } else {
        buffer = ''; // corpo de método, bloco estático, etc.
      }
      i = close + 1;
      continue;
    }

    if (char === ';') {
      buffer = '';
      i += 1;
      continue;
    }

    buffer += char;
    i += 1;
  }

  return types;
}

function matchTypeHeader(header) {
  TYPE_HEADER.lastIndex = 0;
  let last = null;
  let match = TYPE_HEADER.exec(header);
  while (match) {
    last = match;
    match = TYPE_HEADER.exec(header);
  }
  if (!last) return null;
  return { kind: last[1], name: last[2], index: last.index };
}

function buildType(declaration, header, source, bodyStart, bodyEnd, warnings) {
  const { kind, name } = declaration;
  const type = {
    kind,
    name,
    fields: [],
    constants: [],
    nested: [],
    annotations: collectAnnotations(header),
  };

  if (kind === 'record') {
    type.fields = parseRecordComponents(header, name, warnings);
  }

  if (kind === 'enum') {
    type.constants = parseEnumConstants(source, bodyStart, bodyEnd);
  }

  const body = source.slice(bodyStart, bodyEnd);
  type.nested = parseScope(body, 0, body.length, warnings);

  if (kind !== 'record') {
    type.fields.push(...parseFields(body, kind, warnings));
  } else {
    // Um record pode declarar campos estáticos; ignorados por parseFields (static).
    type.fields.push(...parseFields(body, kind, warnings).filter((field) =>
      !type.fields.some((existing) => existing.name === field.name)));
  }

  return type;
}

function collectAnnotations(text) {
  const annotations = [];
  const regex = /@([A-Za-z_$][\w$.]*)\s*(\(([^)]*)\))?/g;
  let match = regex.exec(text);
  while (match) {
    annotations.push({ name: match[1].split('.').pop(), args: match[3] ? match[3].trim() : '' });
    match = regex.exec(text);
  }
  return annotations;
}

/** Divide por vírgulas de nível superior (respeita <>, () e []). */
function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < text.length) {
    if (isLiteralStart(text, i)) {
      const end = skipLiteral(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    const char = text[i];
    if (char === '<' || char === '(' || char === '[') depth += 1;
    else if (char === '>' || char === ')' || char === ']') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
    i += 1;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseRecordComponents(header, name, warnings) {
  const start = header.indexOf('(', header.indexOf(name));
  if (start === -1) return [];
  const end = matchPair(header, start, '(', ')');
  const inside = header.slice(start + 1, end).trim();
  if (!inside) return [];

  const fields = [];
  for (const component of splitTopLevel(inside)) {
    const parsed = parseDeclarator(component, warnings);
    if (parsed) fields.push(parsed);
  }
  return fields;
}

function parseEnumConstants(source, bodyStart, bodyEnd) {
  const body = source.slice(bodyStart, bodyEnd);
  let cut = body.length;
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    if (isLiteralStart(body, i)) {
      i = skipLiteral(body, i);
      continue;
    }
    const char = body[i];
    if (char === '(' || char === '{') depth += 1;
    else if (char === ')' || char === '}') depth -= 1;
    else if (char === ';' && depth === 0) {
      cut = i;
      break;
    }
    i += 1;
  }
  return splitTopLevel(body.slice(0, cut))
    .map((entry) => {
      const match = /^(?:@[\w$.]+\s*(?:\([^)]*\))?\s*)*([A-Za-z_$][\w$]*)/.exec(entry.trim());
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

/** Extrai os campos de instância do corpo de um tipo. */
function parseFields(body, kind, warnings) {
  const fields = [];
  let buffer = '';
  let i = 0;

  while (i < body.length) {
    if (isLiteralStart(body, i)) {
      const end = skipLiteral(body, i);
      buffer += body.slice(i, end);
      i = end;
      continue;
    }

    const char = body[i];

    if (char === '(') {
      const close = matchPair(body, i, '(', ')');
      buffer += body.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    if (char === '{') {
      const close = matchPair(body, i, '{', '}');
      const isInitializer = /=[^=]*$/.test(buffer);
      if (!isInitializer) buffer = '';
      i = close + 1;
      continue;
    }

    if (char === ';') {
      const statement = buffer.trim();
      buffer = '';
      i += 1;
      if (!statement) continue;
      fields.push(...parseFieldStatement(statement, kind, warnings));
      continue;
    }

    buffer += char;
    i += 1;
  }

  return fields;
}

function parseFieldStatement(statement, kind, warnings) {
  const annotations = collectAnnotations(statement);
  const withoutAnnotations = statement.replace(/@[A-Za-z_$][\w$.]*\s*(\([^)]*\))?/g, ' ').trim();
  if (!withoutAnnotations) return [];

  const tokens = withoutAnnotations.split(/\s+/);
  const modifiers = new Set();
  let rest = withoutAnnotations;
  for (const token of tokens) {
    if (SKIP_MODIFIERS.has(token)) {
      modifiers.add(token);
      rest = rest.slice(rest.indexOf(token) + token.length);
    } else break;
  }
  rest = rest.trim();
  if (!rest) return [];

  // Métodos e construtores: parênteses fora de um inicializador.
  const equalsIndex = indexOfTopLevel(rest, '=');
  const head = equalsIndex === -1 ? rest : rest.slice(0, equalsIndex);
  if (indexOfTopLevel(head, '(') !== -1) return [];
  if (/^(?:class|interface|enum|record|package|import|return|throw|new)\b/.test(rest)) return [];

  // Campos estáticos/transientes não fazem parte do estado serializado.
  if (modifiers.has('static') || modifiers.has('transient')) return [];
  if (kind === 'interface') return [];
  if (annotations.some((annotation) => /^Json(Ignore|BackReference)$/.test(annotation.name) || annotation.name === 'Transient')) {
    return [];
  }

  const declarators = splitTopLevel(rest);
  const first = parseDeclarator(declarators[0], warnings, annotations);
  if (!first) return [];

  const fields = [first];
  for (const extra of declarators.slice(1)) {
    const name = /^([A-Za-z_$][\w$]*)/.exec(extra.split('=')[0].trim());
    if (name) fields.push({ ...first, name: name[1], jsonName: name[1] });
  }
  return fields;
}

function indexOfTopLevel(text, target) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '<' || char === '(' || char === '[') depth += 1;
    else if (char === '>' || char === ')' || char === ']') depth -= 1;
    else if (char === target && depth === 0) {
      if (target === '=' && (text[i + 1] === '=' || text[i - 1] === '!' || text[i - 1] === '<' || text[i - 1] === '>')) continue;
      return i;
    }
  }
  return -1;
}

/** "Map<String, Integer> values = new HashMap<>()" → { type, name } */
function parseDeclarator(text, warnings, inheritedAnnotations = []) {
  const annotations = [...inheritedAnnotations, ...collectAnnotations(text)];
  let declaration = text.replace(/@[A-Za-z_$][\w$.]*\s*(\([^)]*\))?/g, ' ').trim();

  const equalsIndex = indexOfTopLevel(declaration, '=');
  if (equalsIndex !== -1) declaration = declaration.slice(0, equalsIndex).trim();

  for (const token of declaration.split(/\s+/)) {
    if (SKIP_MODIFIERS.has(token)) {
      declaration = declaration.replace(new RegExp(`^${token}\\s+`), '').trim();
    } else break;
  }

  const match = /^(.*?[>\]\w$])\s+([A-Za-z_$][\w$]*)\s*((?:\[\s*\])*)$/.exec(declaration);
  if (!match) return null;

  let type = match[1].trim();
  const name = match[2];
  const trailingArray = match[3].replace(/\s+/g, '');
  if (trailingArray) type += trailingArray;
  if (declaration.includes('...')) type = `${type.replace('...', '')}[]`;

  const jsonProperty = annotations.find((annotation) =>
    annotation.name === 'JsonProperty' || annotation.name === 'SerializedName' || annotation.name === 'JsonAlias');
  let jsonName = name;
  if (jsonProperty && jsonProperty.args) {
    const quoted = /"([^"]*)"/.exec(jsonProperty.args);
    if (quoted && quoted[1]) jsonName = quoted[1];
  }

  if (!type || type === 'return') return null;
  return { type, name, jsonName, annotations };
}
