/**
 * Superfícies: tudo que pode aparecer nos seletores de origem e destino.
 *
 * Base64 e Texto não são "formatos" no sentido do modelo intermediário — não têm
 * tipos nem campos —, mas do ponto de vista de quem usa são só mais duas opções
 * na mesma lista. Este módulo reúne as duas famílias e decide quais combinações
 * fazem sentido, para a interface nunca oferecer um par impossível.
 */

import { decodeText, encodeText, looksLikeBase64 } from '../core/base64.js';
import { convert } from '../core/convert.js';
import { FORMATS, getFormat } from '../core/formats/index.js';

/** Família "texto": transformação de bytes, sem estrutura. */
const TEXT_SURFACES = [
  { id: 'text', labelKey: 'ui.surface.text', family: 'text', highlight: 'plain', extension: 'txt' },
  { id: 'base64', labelKey: 'ui.surface.base64', family: 'text', highlight: 'plain', extension: 'txt' },
];

/** Família "estrutura": tudo que passa pelo modelo intermediário. */
const STRUCTURED_SURFACES = FORMATS.map((format) => ({
  id: format.id,
  label: format.label,
  family: 'structured',
  kind: format.kind,
  highlight: format.highlight,
  extension: format.extension,
  defaults: format.defaults || {},
}));

export const SURFACES = [...TEXT_SURFACES, ...STRUCTURED_SURFACES];

const BY_ID = new Map(SURFACES.map((surface) => [surface.id, surface]));

export function getSurface(id) {
  return BY_ID.get(id) || null;
}

/**
 * Destinos válidos para uma origem. Texto e Base64 só conversam entre si;
 * estruturas conversam com qualquer outra estrutura.
 */
export function targetsFor(sourceId) {
  const source = getSurface(sourceId);
  if (!source) return [];
  return SURFACES.filter((surface) => surface.family === source.family && surface.id !== sourceId);
}

/** O par é convertível? */
export function isValidPair(fromId, toId) {
  const from = getSurface(fromId);
  const to = getSurface(toId);
  return Boolean(from && to && from.family === to.family && from.id !== to.id);
}

/**
 * Executa a conversão apropriada ao par.
 * @returns {{output: string, warnings: string[], highlight: string, detectedTypes: string[], autoNote: string}}
 */
export function runConversion(text, fromId, toId, options = {}) {
  const from = getSurface(fromId);
  const to = getSurface(toId);

  if (from.family === 'text') return runTextConversion(text, fromId, toId, options);

  const result = convert(text, fromId, toId, options);
  return {
    output: result.output,
    warnings: result.warnings,
    highlight: to.highlight,
    // Tipos detectados alimentam o seletor de raiz quando a origem é uma linguagem.
    detectedTypes: result.ir ? result.ir.types.map((type) => type.name).filter(Boolean) : [],
    rootName: result.ir ? result.ir.rootName : '',
    autoNote: '',
  };
}

function runTextConversion(text, fromId, toId, options) {
  // Texto → Base64 codifica; Base64 → Texto decodifica.
  if (toId === 'base64') {
    const result = encodeText(text, {
      urlSafe: options.alphabet === 'url',
      padding: options.padding !== false,
      lineLength: options.wrap ? 76 : 0,
    });
    return {
      output: result.output, warnings: result.warnings,
      highlight: 'plain', detectedTypes: [], autoNote: '',
    };
  }

  const result = decodeText(text, { strict: Boolean(options.strict) });
  return {
    // Conteúdo binário vira dump hexadecimal: mais útil do que uma parede de U+FFFD.
    output: result.binary ? result.hex : result.output,
    warnings: result.warnings,
    highlight: 'plain',
    detectedTypes: [],
    autoNote: '',
  };
}

/**
 * Sugere o par de superfícies para um texto colado, quando o usuário pede
 * detecção automática. Só olha a forma do texto — nunca altera nada sozinho.
 */
export function detectSurface(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (looksLikeBase64(trimmed)) return 'base64';
  if (/^\s*(public|private|internal)?\s*(class|record|struct|interface|enum)\s+\w/m.test(trimmed)) return 'java';
  if (/^\s*type\s+\w+\s+struct\s*\{/m.test(trimmed)) return 'go';
  if (/^\s*(export\s+)?(interface|type)\s+\w+/m.test(trimmed)) return 'typescript';
  if (/^\s*\w+:\s|^\s*-\s/m.test(trimmed)) return 'yaml';
  return null;
}
