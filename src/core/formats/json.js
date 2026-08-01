/**
 * Formato JSON: leitura para o IR e escrita a partir do IR.
 */

import { inferIR, sampleData } from '../data-model.js';
import { parseJson } from '../json.js';

export const id = 'json';
export const label = 'JSON';
export const kind = 'data';
export const highlight = 'json';
export const extension = 'json';

/**
 * @param {string} text
 * @param {{rootName?: string, detectDateTime?: boolean}} [options]
 * @returns {import('../ir.js').IR}
 */
export function parse(text, options = {}) {
  return inferIR(parseJson(text), options);
}

/** Leitura crua, preservando os valores (usada de dados para dados). */
export function parseData(text) {
  return parseJson(text);
}

/** Escrita crua dos valores recebidos. */
export function emitData(value, options = {}) {
  return `${JSON.stringify(value, null, options.indent ?? 2)}\n`;
}

/**
 * @param {import('../ir.js').IR} ir
 * @param {{values?: 'example'|'empty', indent?: number}} [options]
 * @returns {{output: string, warnings: string[]}}
 */
export function emit(ir, options = {}) {
  const { indent = 2 } = options;
  const { value, warnings } = sampleData(ir, options);
  // Avisos vindos da leitura (tipos desconhecidos, chaves dinâmicas…) somam-se
  // aos da geração de exemplo.
  return { output: `${JSON.stringify(value, null, indent)}\n`, warnings: [...ir.warnings, ...warnings] };
}
