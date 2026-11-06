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
import { decodeFile, encodeFile, parseDataUri } from '../core/files.js';
import { FORMATS, getFormat } from '../core/formats/index.js';

/** Família "texto": transformação de bytes, sem estrutura. */
const TEXT_SURFACES = [
  { id: 'text', labelKey: 'ui.surface.text', family: 'text', highlight: 'plain', extension: 'txt' },
  { id: 'base64', labelKey: 'ui.surface.base64', family: 'text', highlight: 'plain', extension: 'txt' },
  { id: 'file', labelKey: 'ui.surface.file', family: 'text', highlight: 'plain', extension: 'bin' },
];

/** PDF mínimo e válido: o "Exemplo" de Base64 → Arquivo precisa gerar um arquivo que abra. */
export const SAMPLE_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9Db250ZW50cyA0IDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+Pj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDExMT4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgNjAgNzIwIFRkIChDb2RlYyBTdHVkaW8pIFRqIDAgLTMyIFRkIC9GMSAxMyBUZiAoRGVjb2RlZCBsb2NhbGx5LiBOb3RoaW5nIGxlZnQgeW91ciBicm93c2VyLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKMDAwMDAwMDM3NyAwMDAwMCBuIAp0cmFpbGVyPDwvU2l6ZSA2L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNDQwCiUlRU9GCg==';

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
 * Destinos válidos para uma origem. Na família "texto", tudo passa pelo Base64: texto e
 * arquivo não conversam entre si. Estruturas conversam com qualquer outra estrutura.
 */
export function targetsFor(sourceId) {
  const source = getSurface(sourceId);
  if (!source) return [];
  return SURFACES.filter((surface) => isValidPair(sourceId, surface.id));
}

/** O par é convertível? */
export function isValidPair(fromId, toId) {
  const from = getSurface(fromId);
  const to = getSurface(toId);
  if (!from || !to || from.family !== to.family || from.id === to.id) return false;
  return from.family !== 'text' || from.id === 'base64' || to.id === 'base64';
}

/**
 * Executa a conversão apropriada ao par. A entrada é texto, ou bytes quando a origem é um arquivo.
 * @param {string|Uint8Array} text
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
  const encoding = {
    urlSafe: options.alphabet === 'url',
    padding: options.padding !== false,
    lineLength: options.wrap ? 76 : 0,
  };

  if (fromId === 'file') {
    const result = encodeFile(text, { ...encoding, dataUri: options.dataUri, mime: options.mime });
    return { output: result.output, warnings: result.warnings, highlight: 'plain', detectedTypes: [], autoNote: '' };
  }

  if (toId === 'file') {
    const file = decodeFile(text, { strict: Boolean(options.strict) });
    return { output: '', file, warnings: file.warnings, highlight: 'plain', detectedTypes: [], autoNote: '' };
  }

  // Texto → Base64 codifica; Base64 → Texto decodifica.
  if (toId === 'base64') {
    const result = encodeText(text, encoding);
    return {
      output: result.output, warnings: result.warnings,
      highlight: 'plain', detectedTypes: [], autoNote: '',
    };
  }

  const result = decodeText(parseDataUri(text)?.payload ?? text, { strict: Boolean(options.strict) });
  return {
    // Conteúdo binário vira dump hexadecimal: mais útil do que uma parede de U+FFFD.
    output: result.binary ? result.hex : result.output,
    warnings: result.warnings,
    binary: result.binary,
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
