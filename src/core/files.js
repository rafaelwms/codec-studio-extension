/**
 * Arquivos ⇄ Base64.
 *
 * Tudo acontece em memória, sobre os bytes que o próprio usuário entregou: nada é
 * enviado, gravado ou executado. O tipo vem da assinatura do conteúdo ("magic
 * numbers"), não do que a entrada alega ser — Base64 puro não traz nome nem
 * extensão, e um Data URI pode declarar um tipo errado.
 *
 * Todas as funções são puras e funcionam tanto no navegador quanto no Node.
 */

import { base64ToBytes, bytesToBase64, CodecError } from './base64.js';
import { msg } from './messages.js';

const type = (ext, label, mime, extra = {}) => ({ ext, label, mime, ...extra });
const text = { text: true };
const image = { image: true };
const risky = { risky: true };

/** Tudo que a interface oferece para salvar. Os rótulos são nomes de formato, sem tradução. */
export const FILE_TYPES = [
  type('pdf', 'PDF', 'application/pdf'),
  type('png', 'PNG', 'image/png', image),
  type('jpg', 'JPEG', 'image/jpeg', image),
  type('gif', 'GIF', 'image/gif', image),
  type('webp', 'WebP', 'image/webp', image),
  type('svg', 'SVG', 'image/svg+xml', { ...image, ...text }),
  type('bmp', 'BMP', 'image/bmp', image),
  type('ico', 'ICO', 'image/x-icon', image),
  type('tif', 'TIFF', 'image/tiff'),
  type('heic', 'HEIC', 'image/heic'),
  type('psd', 'Photoshop', 'image/vnd.adobe.photoshop'),
  type('docx', 'Word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  type('xlsx', 'Excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  type('pptx', 'PowerPoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  type('doc', 'Word 97–2003', 'application/msword'),
  type('xls', 'Excel 97–2003', 'application/vnd.ms-excel'),
  type('ppt', 'PowerPoint 97–2003', 'application/vnd.ms-powerpoint'),
  type('msg', 'Outlook', 'application/vnd.ms-outlook'),
  type('odt', 'OpenDocument Text', 'application/vnd.oasis.opendocument.text'),
  type('ods', 'OpenDocument Sheet', 'application/vnd.oasis.opendocument.spreadsheet'),
  type('odp', 'OpenDocument Slides', 'application/vnd.oasis.opendocument.presentation'),
  type('epub', 'EPUB', 'application/epub+zip'),
  type('rtf', 'RTF', 'application/rtf', text),
  type('txt', 'Text', 'text/plain', text),
  type('md', 'Markdown', 'text/markdown', text),
  type('log', 'Log', 'text/plain', text),
  type('csv', 'CSV', 'text/csv', text),
  type('json', 'JSON', 'application/json', text),
  type('xml', 'XML', 'application/xml', text),
  type('yml', 'YAML', 'application/yaml', text),
  type('html', 'HTML', 'text/html', text),
  type('ps', 'PostScript', 'application/postscript', text),
  type('zip', 'ZIP', 'application/zip'),
  type('gz', 'GZIP', 'application/gzip'),
  type('tgz', 'TAR + GZIP', 'application/gzip'),
  type('tar', 'TAR', 'application/x-tar'),
  type('7z', '7-Zip', 'application/x-7z-compressed'),
  type('rar', 'RAR', 'application/vnd.rar'),
  type('bz2', 'BZIP2', 'application/x-bzip2'),
  type('xz', 'XZ', 'application/x-xz'),
  type('mp3', 'MP3', 'audio/mpeg'),
  type('wav', 'WAV', 'audio/wav'),
  type('ogg', 'Ogg', 'audio/ogg'),
  type('flac', 'FLAC', 'audio/flac'),
  type('m4a', 'M4A', 'audio/mp4'),
  type('mp4', 'MP4', 'video/mp4'),
  type('m4v', 'M4V', 'video/x-m4v'),
  type('mov', 'QuickTime', 'video/quicktime'),
  type('webm', 'WebM', 'video/webm'),
  type('mkv', 'Matroska', 'video/x-matroska'),
  type('avi', 'AVI', 'video/x-msvideo'),
  type('woff', 'WOFF', 'font/woff'),
  type('woff2', 'WOFF2', 'font/woff2'),
  type('ttf', 'TrueType', 'font/ttf'),
  type('otf', 'OpenType', 'font/otf'),
  type('sqlite', 'SQLite', 'application/vnd.sqlite3'),
  type('wasm', 'WebAssembly', 'application/wasm'),
  type('class', 'Java class', 'application/java-vm', risky),
  type('jar', 'JAR', 'application/java-archive', risky),
  type('apk', 'Android', 'application/vnd.android.package-archive', risky),
  type('exe', 'Windows', 'application/vnd.microsoft.portable-executable', risky),
  type('elf', 'ELF', 'application/x-elf', risky),
  type('bin', 'Binary', 'application/octet-stream'),
  type('dat', 'Data', 'application/octet-stream'),
];

const BY_EXT = new Map(FILE_TYPES.map((entry) => [entry.ext, entry]));

export const getFileType = (ext) => BY_EXT.get(ext) || null;

/** Formatos que a mesma assinatura também pode representar. */
const ALTERNATIVES = {
  zip: ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'jar', 'apk'],
  doc: ['xls', 'ppt', 'msg'],
  gz: ['tgz'],
  mp4: ['m4v', 'm4a', 'mov'],
  m4a: ['mp4'],
  mov: ['mp4'],
  mkv: ['webm'],
  webm: ['mkv'],
  ogg: ['webm'],
  txt: ['md', 'log', 'csv', 'json', 'xml', 'yml', 'html'],
  xml: ['svg', 'html'],
  html: ['xml', 'txt'],
  json: ['txt'],
  csv: ['txt'],
  bin: ['dat', 'txt'],
};

const ascii = (bytes, offset, length) => {
  let out = '';
  const end = Math.min(offset + length, bytes.length);
  for (let i = offset; i < end; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

const hasBytes = (bytes, offset, ...expected) =>
  bytes.length >= offset + expected.length && expected.every((value, i) => bytes[offset + i] === value);

const hasAscii = (bytes, offset, expected) => ascii(bytes, offset, expected.length) === expected;

/** A assinatura de PDF pode vir depois de lixo; a especificação tolera até 1 KB. */
function isPdf(bytes) {
  return ascii(bytes, 0, 1024).includes('%PDF-');
}

/** Lê os nomes do diretório central do ZIP: é ele que diferencia um .docx de um .jar. */
function zipEntryNames(bytes) {
  const names = [];
  const start = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (hasBytes(bytes, i, 0x50, 0x4b, 0x05, 0x06)) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return names;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count && offset + 46 <= bytes.length; i += 1) {
    if (!hasBytes(bytes, offset, 0x50, 0x4b, 0x01, 0x02)) break;
    const nameLength = view.getUint16(offset + 28, true);
    names.push(ascii(bytes, offset + 46, nameLength));
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return names;
}

function detectZip(bytes) {
  const names = zipEntryNames(bytes);
  const has = (name) => names.includes(name);
  if (has('word/document.xml')) return 'docx';
  if (has('xl/workbook.xml')) return 'xlsx';
  if (has('ppt/presentation.xml')) return 'pptx';
  if (has('AndroidManifest.xml')) return 'apk';
  if (has('META-INF/MANIFEST.MF')) return 'jar';

  // ODF e EPUB guardam o tipo real em texto puro, logo na primeira entrada.
  const head = ascii(bytes, 0, 256);
  if (head.includes('application/epub+zip')) return 'epub';
  if (head.includes('oasis.opendocument.text')) return 'odt';
  if (head.includes('oasis.opendocument.spreadsheet')) return 'ods';
  if (head.includes('oasis.opendocument.presentation')) return 'odp';
  return 'zip';
}

function detectFtyp(bytes) {
  const brand = ascii(bytes, 8, 4).trim().toLowerCase();
  if (brand === 'qt') return 'mov';
  if (brand === 'm4a' || brand === 'm4b') return 'm4a';
  if (brand === 'm4v') return 'm4v';
  if (['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1'].includes(brand)) return 'heic';
  return 'mp4';
}

/** Assinaturas binárias, da mais específica para a mais fraca. */
function detectBinary(bytes) {
  if (isPdf(bytes)) return 'pdf';
  if (hasBytes(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (hasBytes(bytes, 0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return 'gif';
  if (hasAscii(bytes, 0, 'RIFF')) {
    const form = ascii(bytes, 8, 4);
    if (form === 'WEBP') return 'webp';
    if (form === 'WAVE') return 'wav';
    if (form === 'AVI ') return 'avi';
  }
  if (hasBytes(bytes, 0, 0x50, 0x4b, 0x03, 0x04) || hasBytes(bytes, 0, 0x50, 0x4b, 0x05, 0x06)) return detectZip(bytes);
  if (hasBytes(bytes, 0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'doc';
  if (hasBytes(bytes, 0, 0x1f, 0x8b)) return 'gz';
  if (hasBytes(bytes, 0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7z';
  if (hasAscii(bytes, 0, 'Rar!\x1a\x07')) return 'rar';
  if (hasBytes(bytes, 0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)) return 'xz';
  if (hasAscii(bytes, 0, 'BZh') && hasBytes(bytes, 4, 0x31, 0x41, 0x59, 0x26, 0x53, 0x59)) return 'bz2';
  if (hasAscii(bytes, 257, 'ustar')) return 'tar';
  if (hasAscii(bytes, 4, 'ftyp')) return detectFtyp(bytes);
  if (hasBytes(bytes, 0, 0x1a, 0x45, 0xdf, 0xa3)) return ascii(bytes, 0, 64).includes('webm') ? 'webm' : 'mkv';
  if (hasAscii(bytes, 0, 'ID3') || hasBytes(bytes, 0, 0xff, 0xfb) || hasBytes(bytes, 0, 0xff, 0xf3) || hasBytes(bytes, 0, 0xff, 0xf2)) return 'mp3';
  if (hasAscii(bytes, 0, 'fLaC')) return 'flac';
  if (hasAscii(bytes, 0, 'OggS')) return 'ogg';
  if (hasAscii(bytes, 0, 'wOFF')) return 'woff';
  if (hasAscii(bytes, 0, 'wOF2')) return 'woff2';
  if (hasAscii(bytes, 0, 'OTTO')) return 'otf';
  if (hasAscii(bytes, 0, 'SQLite format 3\0')) return 'sqlite';
  if (hasBytes(bytes, 0, 0x00, 0x61, 0x73, 0x6d)) return 'wasm';
  if (hasBytes(bytes, 0, 0xca, 0xfe, 0xba, 0xbe)) return 'class';
  if (hasBytes(bytes, 0, 0x7f, 0x45, 0x4c, 0x46)) return 'elf';
  if (hasAscii(bytes, 0, '8BPS')) return 'psd';
  if (hasBytes(bytes, 0, 0x49, 0x49, 0x2a, 0x00) || hasBytes(bytes, 0, 0x4d, 0x4d, 0x00, 0x2a)) return 'tif';

  // Assinaturas curtas: exigem mais uma confirmação para não confundir com outro conteúdo.
  if (hasAscii(bytes, 0, 'MZ') && bytes.length >= 64) return 'exe';
  if (hasAscii(bytes, 0, 'BM') && bytes.length >= 26 && hasBytes(bytes, 6, 0, 0, 0, 0)) return 'bmp';
  if (hasBytes(bytes, 0, 0x00, 0x00, 0x01, 0x00) && bytes.length >= 22 && bytes[4] > 0) return 'ico';
  if (hasBytes(bytes, 0, 0x00, 0x01, 0x00, 0x00, 0x00) && bytes.length >= 12) return 'ttf';
  return null;
}

const TEXT_SAMPLE = 64 * 1024;

/** Decodifica o começo do conteúdo como UTF-8; null quando não é texto. */
function textSample(bytes) {
  const sample = bytes.subarray(0, TEXT_SAMPLE);
  if (sample.includes(0)) return null;
  try {
    // stream: a amostra pode cortar um caractere ao meio sem que isso seja erro.
    return new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: bytes.length > TEXT_SAMPLE });
  } catch {
    return null;
  }
}

function looksLikeCsv(sample) {
  const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 5);
  if (lines.length < 2) return false;
  return [',', ';', '\t'].some((separator) => {
    const count = lines[0].split(separator).length;
    return count > 1 && lines.every((line) => line.split(separator).length === count);
  });
}

function detectText(sample, complete) {
  const trimmed = sample.trimStart();
  const lower = trimmed.slice(0, 2048).toLowerCase();
  if (trimmed.startsWith('{\\rtf')) return 'rtf';
  if (trimmed.startsWith('%!PS')) return 'ps';
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return 'html';
  if (lower.startsWith('<svg') || (lower.startsWith('<?xml') && lower.includes('<svg'))) return 'svg';
  if (lower.startsWith('<?xml')) return 'xml';
  if (complete && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Parece JSON mas não é: segue como texto comum.
    }
  }
  return looksLikeCsv(sample) ? 'csv' : 'txt';
}

/**
 * Descobre o tipo pelo conteúdo.
 * @param {Uint8Array} bytes
 * @returns {{type: object, alternatives: object[], known: boolean}}
 */
export function detectFileType(bytes) {
  let ext = detectBinary(bytes);
  if (!ext) {
    const sample = textSample(bytes);
    if (sample !== null) ext = detectText(sample.replace(/^﻿/, ''), bytes.length <= TEXT_SAMPLE);
  }
  const known = Boolean(ext);
  const found = BY_EXT.get(ext || 'bin');
  return {
    type: found,
    alternatives: (ALTERNATIVES[found.ext] || []).map((alternative) => BY_EXT.get(alternative)),
    known,
  };
}

/** O conteúdo é texto, ou seja, cabe num editor? */
export function isTextBytes(bytes) {
  return Boolean(detectFileType(bytes).type.text);
}

/**
 * Separa um Data URI (`data:application/pdf;base64,JVBER…`) em tipo e conteúdo.
 * @param {string} input
 * @returns {{mime: string, payload: string}|null} null quando a entrada não é um Data URI
 */
export function parseDataUri(input) {
  const start = input.search(/\S/);
  if (start < 0 || input.slice(start, start + 5).toLowerCase() !== 'data:') return null;
  const comma = input.indexOf(',', start);
  if (comma < 0) return null;

  const [mime, ...params] = input.slice(start + 5, comma).split(';');
  if (!params.some((param) => param.trim().toLowerCase() === 'base64')) {
    throw new CodecError('core.file.dataUriNotBase64', { hintCode: 'core.file.dataUriNotBase64.hint' });
  }
  return { mime: mime.trim().toLowerCase(), payload: input.slice(comma + 1) };
}

/** Base64 costuma chegar copiado de um JSON, com aspas e vírgula em volta. */
function unquote(input) {
  const match = /^\s*(["'`])/.exec(input);
  if (!match) return input;
  const end = input.lastIndexOf(match[1]);
  return end > match[0].length - 1 ? input.slice(match[0].length, end) : input;
}

/**
 * Decodifica Base64 (ou Data URI) em um arquivo.
 * @param {string} input
 * @param {{strict?: boolean}} [options]
 * @returns {{bytes: Uint8Array, type: object, alternatives: object[], known: boolean, warnings: string[]}}
 */
export function decodeFile(input, options = {}) {
  const unquoted = unquote(input);
  const dataUri = parseDataUri(unquoted);
  const { bytes, warnings } = base64ToBytes(dataUri ? dataUri.payload : unquoted, options);

  if (bytes.length === 0) {
    throw new CodecError('core.file.empty', { hintCode: 'core.file.empty.hint' });
  }

  const detected = detectFileType(bytes);
  const declared = dataUri && dataUri.mime
    ? FILE_TYPES.find((entry) => entry.mime === dataUri.mime)
    : null;

  if (declared && !detected.known) {
    // Sem assinatura reconhecível, o que o Data URI declara é a melhor pista.
    detected.type = declared;
    detected.alternatives = (ALTERNATIVES[declared.ext] || []).map((ext) => BY_EXT.get(ext));
    detected.known = true;
  } else if (declared && declared.mime !== detected.type.mime && !detected.type.text) {
    warnings.push(msg('core.file.mimeMismatch', { declared: declared.label, detected: detected.type.label }));
  }

  if (!detected.known) warnings.push(msg('core.file.unknownType'));
  if (detected.type.risky) warnings.push(msg('core.file.executable'));

  return { bytes, ...detected, warnings };
}

/**
 * Codifica os bytes de um arquivo em Base64 ou em Data URI.
 * @param {Uint8Array} bytes
 * @param {{urlSafe?: boolean, padding?: boolean, lineLength?: number, dataUri?: boolean, mime?: string}} [options]
 * @returns {{output: string, warnings: string[]}}
 */
export function encodeFile(bytes, options = {}) {
  if (options.dataUri) {
    // Data URI exige o alfabeto padrão e não admite quebra de linha.
    return { output: toDataUri(bytes, options.mime || detectFileType(bytes).type.mime), warnings: [] };
  }
  return { output: bytesToBase64(bytes, options), warnings: [] };
}

export function toDataUri(bytes, mime) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Remove o que nenhum sistema de arquivos aceita; o nome vem de um campo livre. */
export function sanitizeFileName(name, fallback = 'file') {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return clean || fallback;
}

/** Troca a extensão do nome, ou acrescenta uma se ele não tiver. */
export function replaceExtension(name, ext) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}
