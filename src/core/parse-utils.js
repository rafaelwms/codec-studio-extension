/**
 * Utilitários de varredura compartilhados pelos parsers de linguagem.
 *
 * Nenhum destes parsers é um compilador: eles varrem o código o suficiente para
 * extrair a *forma* dos tipos, ignorando corpos de método, comentários e literais.
 * O que muda de uma linguagem para outra é a gramática de declaração — o trabalho
 * chato de pular strings e blocos balanceados é o mesmo, e mora aqui.
 */

/** O caractere em `index` inicia um literal de texto? */
export function isLiteralStart(source, index) {
  const char = source[index];
  return char === '"' || char === "'" || char === '`';
}

/**
 * Índice logo após o literal iniciado em `index`.
 * Cobre aspas simples/duplas, template strings e text blocks (""" e ''').
 */
export function skipLiteral(source, index) {
  for (const fence of ['"""', "'''"]) {
    if (source.startsWith(fence, index)) {
      const end = source.indexOf(fence, index + fence.length);
      return end === -1 ? source.length : end + fence.length;
    }
  }

  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    // Template strings podem cruzar linhas; aspas normais não.
    if (source[i] === '\n' && quote !== '`') return i;
    i += 1;
  }
  return source.length;
}

/**
 * Remove comentários preservando literais e a contagem de linhas.
 * @param {string} source
 * @param {{line?: string, blockOpen?: string, blockClose?: string}} [syntax]
 */
export function stripComments(source, syntax = {}) {
  const { line = '//', blockOpen = '/*', blockClose = '*/' } = syntax;
  let out = '';
  let i = 0;

  while (i < source.length) {
    if (isLiteralStart(source, i)) {
      const end = skipLiteral(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (line && source.startsWith(line, i)) {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (blockOpen && source.startsWith(blockOpen, i)) {
      const end = source.indexOf(blockClose, i + blockOpen.length);
      const stop = end === -1 ? source.length : end + blockClose.length;
      // Troca por espaços para manter offsets de linha.
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Índice do fechamento correspondente ao par aberto em `index`. */
export function matchPair(source, index, open, close) {
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

/**
 * Divide por um separador que esteja no nível mais externo, respeitando
 * <>, () e [] — necessário para `Map<String, List<Item>> x`.
 */
export function splitTopLevel(text, separator = ',') {
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
    if (char === '<' || char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === '>' || char === ')' || char === ']' || char === '}') depth -= 1;

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

/** Índice da primeira ocorrência de `target` no nível mais externo. */
export function indexOfTopLevel(text, target) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (isLiteralStart(text, i)) {
      i = skipLiteral(text, i) - 1;
      continue;
    }
    const char = text[i];
    if (char === '<' || char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === '>' || char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === target && depth === 0) return i;
  }
  return -1;
}

/**
 * Separa `Map<String, Integer>` em base e argumentos genéricos.
 * @returns {{base: string, args: string[]}}
 */
export function splitGeneric(type) {
  const start = type.indexOf('<');
  if (start === -1) return { base: type.trim(), args: [] };
  const end = type.lastIndexOf('>');
  const inside = type.slice(start + 1, end === -1 ? type.length : end);
  return { base: type.slice(0, start).trim(), args: splitTopLevel(inside) };
}

/** Coleta anotações/atributos (`@Name(...)`, `[Name(...)]`) de um trecho. */
export function collectAnnotations(text, style = 'at') {
  const pattern = style === 'bracket'
    ? /\[([A-Za-z_][\w.]*)\s*(\(([^\])]*)\))?\]/g
    : /@([A-Za-z_$][\w$.]*)\s*(\(([^)]*)\))?/g;

  const found = [];
  let match = pattern.exec(text);
  while (match) {
    found.push({ name: match[1].split('.').pop(), args: match[3] ? match[3].trim() : '' });
    match = pattern.exec(text);
  }
  return found;
}

/** Primeiro literal de string dentro dos argumentos de uma anotação. */
export function firstQuoted(text) {
  const match = /["']([^"']*)["']/.exec(text || '');
  return match ? match[1] : '';
}

/**
 * Varre membros de um corpo de tipo, chamando os callbacks para cada declaração
 * terminada em `;`/nova linha e para cada bloco `{ … }` encontrado.
 *
 * @param {string} body
 * @param {{onStatement?: (text: string) => void, onBlock?: (header: string, body: string) => void,
 *          statementEnd?: string}} handlers
 */
export function scanMembers(body, handlers) {
  const { onStatement, onBlock, statementEnd = ';' } = handlers;
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
      onBlock?.(buffer, body.slice(i + 1, close));
      // Um `=` pendente indica inicializador (array, lambda): o campo continua.
      buffer = /=[^=]*$/.test(buffer) ? `${buffer} ` : '';
      i = close + 1;
      continue;
    }

    if (char === statementEnd || (statementEnd === '\n' && char === '\n')) {
      const statement = buffer.trim();
      buffer = '';
      i += 1;
      if (statement) onStatement?.(statement);
      continue;
    }

    buffer += char;
    i += 1;
  }

  const tail = buffer.trim();
  if (tail) onStatement?.(tail);
}
