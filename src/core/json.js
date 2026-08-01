import { CodecError } from './base64.js';
import { msg } from './messages.js';

/**
 * JSON.parse com mensagem de erro localizada (linha/coluna) e trecho do problema.
 *
 * O V8 moderno nem sempre inclui a posição na mensagem ("Unexpected token '}' … is not
 * valid JSON"), então, quando o parse falha, um scanner próprio percorre o texto para
 * apontar exatamente onde a estrutura quebrou. JSON.parse continua sendo a fonte da
 * verdade: o scanner só é usado para *explicar* a falha.
 *
 * @param {string} text
 * @returns {any}
 */
export function parseJson(text) {
  const source = text.trim();
  if (!source) {
    throw new CodecError('core.json.empty', { hintCode: 'core.json.empty.hint' });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    const native = String(error && error.message ? error.message : error);
    const located = locateError(source) || positionFromMessage(native, source);
    if (located) {
      const { line, column, index, message } = located;
      throw new CodecError('core.json.invalidAt', {
        params: { line, column },
        position: index,
        hint: msg('core.json.hint', {
          message: message || cleanupMessage(native),
          excerpt: excerpt(source, index),
        }),
      });
    }
    throw new CodecError('core.json.invalid', { hint: cleanupMessage(native) });
  }
}

function lineColumn(source, index) {
  let line = 1;
  let column = 1;
  const limit = Math.min(index, source.length);
  for (let i = 0; i < limit; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column, index: limit };
}

function positionFromMessage(message, source) {
  const withPosition = /position (\d+)/i.exec(message);
  if (withPosition) return { ...lineColumn(source, Number(withPosition[1])), message: cleanupMessage(message) };
  const withLine = /line (\d+) column (\d+)/i.exec(message);
  if (withLine) {
    return {
      line: Number(withLine[1]),
      column: Number(withLine[2]),
      index: 0,
      message: cleanupMessage(message),
    };
  }
  return null;
}

/* ------------------------------------------------- scanner de diagnóstico ---- */

/**
 * Percorre o texto como JSON e devolve a primeira posição inconsistente.
 * @returns {{line:number, column:number, index:number, message:string}|null}
 */
function locateError(source) {
  const state = { source, index: 0 };
  try {
    skipWhitespace(state);
    scanValue(state);
    skipWhitespace(state);
    if (state.index < source.length) {
      fail(state, msg('core.json.scan.extraContent', { char: source[state.index] }));
    }
    return null; // o scanner não encontrou problema; deixa a mensagem nativa falar
  } catch (error) {
    if (error && error.__jsonScan) {
      return { ...lineColumn(source, error.index), message: error.reason };
    }
    return null;
  }
}

function fail(state, reason) {
  const error = new Error(reason);
  error.__jsonScan = true;
  error.index = state.index;
  error.reason = reason;
  throw error;
}

function skipWhitespace(state) {
  while (state.index < state.source.length && /[\s]/.test(state.source[state.index])) state.index += 1;
}

function scanValue(state) {
  skipWhitespace(state);
  const char = state.source[state.index];
  if (char === undefined) fail(state, msg('core.json.scan.unexpectedEnd'));
  if (char === '{') return scanObject(state);
  if (char === '[') return scanArray(state);
  if (char === '"') return scanString(state);
  if (char === '-' || (char >= '0' && char <= '9')) return scanNumber(state);
  for (const literal of ['true', 'false', 'null']) {
    if (state.source.startsWith(literal, state.index)) {
      state.index += literal.length;
      return undefined;
    }
  }
  fail(state, msg('core.json.scan.unexpectedValue', { char }));
  return undefined;
}

function scanObject(state) {
  state.index += 1; // {
  skipWhitespace(state);
  if (state.source[state.index] === '}') {
    state.index += 1;
    return;
  }
  for (;;) {
    skipWhitespace(state);
    if (state.source[state.index] !== '"') {
      fail(state, msg('core.json.scan.expectedKey'));
    }
    scanString(state);
    skipWhitespace(state);
    if (state.source[state.index] !== ':') fail(state, msg('core.json.scan.expectedColon'));
    state.index += 1;
    scanValue(state);
    skipWhitespace(state);
    const char = state.source[state.index];
    if (char === ',') {
      state.index += 1;
      skipWhitespace(state);
      if (state.source[state.index] === '}') fail(state, msg('core.json.scan.trailingCommaObject'));
      continue;
    }
    if (char === '}') {
      state.index += 1;
      return;
    }
    fail(state, char === undefined ? msg('core.json.scan.unclosedObject') : msg('core.json.scan.expectedCommaOrBrace', { char }));
  }
}

function scanArray(state) {
  state.index += 1; // [
  skipWhitespace(state);
  if (state.source[state.index] === ']') {
    state.index += 1;
    return;
  }
  for (;;) {
    scanValue(state);
    skipWhitespace(state);
    const char = state.source[state.index];
    if (char === ',') {
      state.index += 1;
      skipWhitespace(state);
      if (state.source[state.index] === ']') fail(state, msg('core.json.scan.trailingCommaArray'));
      continue;
    }
    if (char === ']') {
      state.index += 1;
      return;
    }
    fail(state, char === undefined ? msg('core.json.scan.unclosedArray') : msg('core.json.scan.expectedCommaOrBracket', { char }));
  }
}

function scanString(state) {
  state.index += 1; // aspas de abertura
  while (state.index < state.source.length) {
    const char = state.source[state.index];
    if (char === '\\') {
      state.index += 2;
      continue;
    }
    if (char === '"') {
      state.index += 1;
      return;
    }
    if (char === '\n') fail(state, msg('core.json.scan.newlineInString'));
    state.index += 1;
  }
  fail(state, msg('core.json.scan.unclosedString'));
}

function scanNumber(state) {
  const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(state.source.slice(state.index));
  if (!match || match[0].length === 0) fail(state, msg('core.json.scan.badNumber'));
  state.index += match[0].length;
}

function cleanupMessage(message) {
  return message
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/\s*in JSON at position \d+.*$/i, '')
    .replace(/,?\s*"[\s\S]*"\s*is not valid JSON$/i, '');
}

function excerpt(source, index) {
  const start = Math.max(0, index - 20);
  const end = Math.min(source.length, index + 20);
  return `…${source.slice(start, end).replace(/\s+/g, ' ')}…`;
}

/**
 * Serializa JSON preservando a ordem das chaves, com indentação configurável.
 * @param {any} value
 * @param {number|string} indent
 */
export function formatJson(value, indent = 2) {
  return JSON.stringify(value, null, indent);
}
