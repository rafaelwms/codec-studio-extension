/**
 * Base64 — implementação própria, sem dependências e sem `btoa`/`atob`.
 *
 * Motivos para não usar btoa/atob:
 *  - btoa lança em qualquer caractere > U+00FF (quebra com acentuação e emoji);
 *  - atob é silenciosamente tolerante com entradas malformadas;
 *  - precisamos de alfabeto URL-safe, padding opcional e erros com posição.
 *
 * Todas as funções são puras e funcionam tanto no navegador quanto no Node.
 */

import { msg } from './messages.js';

const ALPHABET_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ALPHABET_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Erro de conversão com contexto legível para a interface.
 *
 * `code` identifica o problema de forma estável e independente de idioma — é por ele
 * que os testes verificam, e é ele que a interface usa se precisar reagir a um caso
 * específico. `message` e `hint` já vêm traduzidos no idioma ativo.
 */
export class CodecError extends Error {
  /**
   * @param {string} code chave no catálogo de mensagens
   * @param {{params?: object, hintCode?: string, hintParams?: object, position?: number, hint?: string}} [details]
   */
  constructor(code, details = {}) {
    super(msg(code, details.params));
    this.name = 'CodecError';
    /** @type {string} */ this.code = code;
    /** @type {object|undefined} */ this.params = details.params;
    /** @type {string|undefined} */ this.hint = details.hintCode
      ? msg(details.hintCode, details.hintParams || details.params)
      : details.hint;
    /** @type {number|undefined} */ this.position = details.position;
  }
}

function buildLookup() {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET_STD.length; i += 1) table[ALPHABET_STD.charCodeAt(i)] = i;
  // Aceita o alfabeto URL-safe no mesmo mapa: '-' → 62, '_' → 63.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
}

const LOOKUP = buildLookup();

/**
 * Converte bytes em texto Base64.
 * @param {Uint8Array} bytes
 * @param {{urlSafe?: boolean, padding?: boolean, lineLength?: number}} [options]
 * @returns {string}
 */
export function bytesToBase64(bytes, options = {}) {
  const { urlSafe = false, padding = true, lineLength = 0 } = options;
  const alphabet = urlSafe ? ALPHABET_URL : ALPHABET_STD;
  const length = bytes.length;
  const parts = [];
  let index = 0;

  for (; index + 2 < length; index += 3) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    parts.push(
      alphabet[(chunk >>> 18) & 63] +
        alphabet[(chunk >>> 12) & 63] +
        alphabet[(chunk >>> 6) & 63] +
        alphabet[chunk & 63],
    );
  }

  const remaining = length - index;
  if (remaining === 1) {
    const chunk = bytes[index] << 16;
    parts.push(alphabet[(chunk >>> 18) & 63] + alphabet[(chunk >>> 12) & 63] + (padding ? '==' : ''));
  } else if (remaining === 2) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8);
    parts.push(
      alphabet[(chunk >>> 18) & 63] +
        alphabet[(chunk >>> 12) & 63] +
        alphabet[(chunk >>> 6) & 63] +
        (padding ? '=' : ''),
    );
  }

  const encoded = parts.join('');
  if (lineLength > 0) return wrapLines(encoded, lineLength);
  return encoded;
}

function wrapLines(text, lineLength) {
  const lines = [];
  for (let i = 0; i < text.length; i += lineLength) lines.push(text.slice(i, i + lineLength));
  return lines.join('\n');
}

/**
 * Converte texto Base64 em bytes.
 * @param {string} input
 * @param {{strict?: boolean}} [options] strict rejeita espaços, padding ausente e alfabetos misturados.
 * @returns {{bytes: Uint8Array, warnings: string[]}}
 */
export function base64ToBytes(input, options = {}) {
  const { strict = false } = options;
  const warnings = [];

  let sanitized = '';
  let sawWhitespace = false;
  let sawUrlSafe = false;
  let sawStandard = false;
  let padCount = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const code = input.charCodeAt(i);

    if (char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f' || char === '\v') {
      sawWhitespace = true;
      continue;
    }
    if (char === '=') {
      padCount += 1;
      continue;
    }
    if (code > 127 || LOOKUP[code] === -1) {
      throw new CodecError('core.base64.invalidChar', {
        params: { char, position: i + 1 },
        hintCode: 'core.base64.invalidChar.hint',
        position: i,
      });
    }
    if (char === '-' || char === '_') sawUrlSafe = true;
    if (char === '+' || char === '/') sawStandard = true;
    if (padCount > 0) {
      throw new CodecError('core.base64.dataAfterPadding', {
        params: { position: i + 1 },
        hintCode: 'core.base64.dataAfterPadding.hint',
        position: i,
      });
    }
    sanitized += char;
  }

  if (sawWhitespace) {
    if (strict) throw new CodecError('core.base64.whitespaceStrict');
    warnings.push(msg('core.base64.whitespaceIgnored'));
  }
  if (sawUrlSafe && sawStandard) {
    if (strict) throw new CodecError('core.base64.mixedAlphabetStrict');
    warnings.push(msg('core.base64.mixedAlphabet'));
  }
  if (padCount > 2) {
    throw new CodecError('core.base64.invalidPadding', {
      params: { count: padCount },
      hintCode: 'core.base64.invalidPadding.hint',
    });
  }

  const remainder = sanitized.length % 4;
  if (remainder === 1) {
    throw new CodecError('core.base64.invalidLength', {
      hintCode: 'core.base64.invalidLength.hint',
    });
  }
  if (remainder !== 0) {
    if (strict) throw new CodecError('core.base64.missingPaddingStrict');
    if (padCount === 0) warnings.push(msg('core.base64.missingPadding'));
  }
  if (padCount > 0 && (sanitized.length + padCount) % 4 !== 0) {
    warnings.push(msg('core.base64.oddPadding'));
  }

  const byteLength = Math.floor((sanitized.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < sanitized.length; i += 1) {
    buffer = (buffer << 6) | LOOKUP[sanitized.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >>> bits) & 0xff;
      byteIndex += 1;
    }
  }

  return { bytes: bytes.subarray(0, byteIndex), warnings };
}

const encoder = new TextEncoder();

/**
 * Codifica texto (UTF-8) em Base64.
 * @param {string} text
 * @param {{urlSafe?: boolean, padding?: boolean, lineLength?: number}} [options]
 * @returns {{output: string, bytes: number, warnings: string[]}}
 */
export function encodeText(text, options = {}) {
  const bytes = encoder.encode(text);
  return { output: bytesToBase64(bytes, options), bytes: bytes.length, warnings: [] };
}

/**
 * Decodifica Base64 para texto UTF-8.
 * @param {string} input
 * @param {{strict?: boolean}} [options]
 * @returns {{output: string, bytes: number, warnings: string[], binary: boolean, hex: string}}
 */
export function decodeText(input, options = {}) {
  const { bytes, warnings } = base64ToBytes(input, options);

  let output;
  let binary = false;
  try {
    output = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    binary = true;
    output = new TextDecoder('utf-8').decode(bytes); // substitui bytes inválidos por U+FFFD
    warnings.push(msg('core.base64.notUtf8'));
  }

  return { output, bytes: bytes.length, warnings, binary, hex: binary ? toHex(bytes, 512) : '' };
}

/**
 * Representação hexadecimal legível (usada quando o conteúdo não é texto).
 * @param {Uint8Array} bytes
 * @param {number} [limit]
 */
export function toHex(bytes, limit = Infinity) {
  const slice = bytes.length > limit ? bytes.subarray(0, limit) : bytes;
  const lines = [];
  for (let offset = 0; offset < slice.length; offset += 16) {
    const row = slice.subarray(offset, offset + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
  }
  if (bytes.length > slice.length) lines.push(`… (+${bytes.length - slice.length} bytes)`);
  return lines.join('\n');
}

/**
 * Heurística para o modo automático: a string parece Base64?
 * @param {string} text
 */
export function looksLikeBase64(text) {
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  const compact = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/\-_]+={0,2}$/.test(compact)) return false;
  if (compact.replace(/=+$/, '').length % 4 === 1) return false;
  try {
    const { bytes } = base64ToBytes(compact);
    if (bytes.length === 0) return false;
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
