import test from 'node:test';
import assert from 'node:assert/strict';

import { base64ToBytes, bytesToBase64 } from '../src/core/base64.js';
import {
  decodeFile, detectFileType, encodeFile, FILE_TYPES, isTextBytes, parseDataUri, replaceExtension, sanitizeFileName,
} from '../src/core/files.js';
import { isValidPair, runConversion, SAMPLE_PDF_BASE64, targetsFor } from '../src/ui/surfaces.js';

const bytesOf = (...values) => Uint8Array.from(values);
const fromAscii = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

/** ZIP mínimo com uma entrada no diretório central e sem dados. */
function zipWith(name) {
  const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(26)]);
  const central = Buffer.alloc(46);
  central.set([0x50, 0x4b, 1, 2]);
  central.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.set([0x50, 0x4b, 5, 6]);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(local.length, 16);
  return new Uint8Array(Buffer.concat([local, central, Buffer.from(name), eocd]));
}

test('codifica e decodifica bytes arbitrários igual à implementação de referência', () => {
  for (let length = 0; length < 70; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
    assert.equal(bytesToBase64(bytes), b64(bytes));
    assert.deepEqual([...base64ToBytes(b64(bytes)).bytes], [...bytes]);
  }
});

test('sem padding e URL-safe continuam funcionando em bytes binários', () => {
  const bytes = bytesOf(0xfb, 0xff, 0xfe, 0x01);
  assert.equal(bytesToBase64(bytes, { urlSafe: true, padding: false }), '-__-AQ');
  assert.deepEqual([...base64ToBytes('-__-AQ').bytes], [...bytes]);
});

test('reconhece os tipos pela assinatura do conteúdo', () => {
  const cases = {
    pdf: fromAscii('%PDF-1.7\n'),
    png: bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0),
    jpg: bytesOf(0xff, 0xd8, 0xff, 0xe0),
    gif: fromAscii('GIF89a'),
    webp: fromAscii('RIFF0000WEBPVP8 '),
    wav: fromAscii('RIFF0000WAVEfmt '),
    gz: bytesOf(0x1f, 0x8b, 8),
    mp3: fromAscii('ID3\x04'),
    mp4: fromAscii('\0\0\0\x18ftypisom'),
    mov: fromAscii('\0\0\0\x14ftypqt  '),
    sqlite: fromAscii('SQLite format 3\0'),
    doc: bytesOf(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
    json: fromAscii('{"a":1}'),
    svg: fromAscii('<?xml version="1.0"?><svg xmlns="x"/>'),
    html: fromAscii('<!DOCTYPE html><html></html>'),
    csv: fromAscii('a,b\n1,2\n3,4\n'),
    txt: fromAscii('apenas um texto'),
  };
  for (const [ext, bytes] of Object.entries(cases)) {
    assert.equal(detectFileType(bytes).type.ext, ext, ext);
  }
});

test('o diretório central diferencia os formatos baseados em ZIP', () => {
  assert.equal(detectFileType(zipWith('word/document.xml')).type.ext, 'docx');
  assert.equal(detectFileType(zipWith('xl/workbook.xml')).type.ext, 'xlsx');
  assert.equal(detectFileType(zipWith('ppt/presentation.xml')).type.ext, 'pptx');
  assert.equal(detectFileType(zipWith('META-INF/MANIFEST.MF')).type.ext, 'jar');
  const zip = detectFileType(zipWith('foto.png'));
  assert.equal(zip.type.ext, 'zip');
  assert.ok(zip.alternatives.some((type) => type.ext === 'docx'));
});

test('toda alternativa aponta para um tipo existente', () => {
  for (const type of FILE_TYPES) {
    const bytes = type.ext === 'txt' ? fromAscii('x') : bytesOf(0x80, 0x81);
    for (const alternative of detectFileType(bytes).alternatives) assert.ok(alternative);
  }
});

test('conteúdo binário desconhecido vira .bin e avisa', () => {
  const file = decodeFile(b64(bytesOf(0x80, 0x81, 0x82, 0)));
  assert.equal(file.type.ext, 'bin');
  assert.equal(file.known, false);
  assert.equal(file.warnings.length, 1);
});

test('executáveis geram aviso', () => {
  const bytes = new Uint8Array(64);
  bytes.set(fromAscii('MZ'));
  assert.equal(decodeFile(b64(bytes)).warnings.length, 1);
});

test('Data URI: o tipo declarado só decide quando o conteúdo não é reconhecível', () => {
  const unknown = b64(bytesOf(0x80, 0x81, 0x82));
  assert.equal(decodeFile(`data:image/heic;base64,${unknown}`).type.ext, 'heic');

  const pdf = decodeFile(`data:image/png;base64,${b64(fromAscii('%PDF-1.4'))}`);
  assert.equal(pdf.type.ext, 'pdf');
  assert.equal(pdf.warnings.length, 1, 'a divergência é avisada');
});

test('Data URI sem base64 é recusado com orientação', () => {
  assert.throws(() => parseDataUri('data:text/plain,oi'), { code: 'core.file.dataUriNotBase64' });
  assert.equal(parseDataUri('SGVsbG8='), null);
});

test('aceita Base64 entre aspas, como vem de um JSON', () => {
  assert.equal(decodeFile(`"${b64(fromAscii('%PDF-1.4'))}"`).type.ext, 'pdf');
});

test('Base64 vazio não vira arquivo', () => {
  assert.throws(() => decodeFile('===='.slice(0, 2)), { code: 'core.file.empty' });
});

test('ida e volta preserva os bytes, inclusive como Data URI', () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 0xff);
  assert.deepEqual([...decodeFile(encodeFile(bytes).output).bytes], [...bytes]);

  const uri = encodeFile(bytes, { dataUri: true, mime: 'image/png', urlSafe: true, lineLength: 76 }).output;
  assert.ok(uri.startsWith('data:image/png;base64,'));
  assert.ok(!uri.includes('\n'));
  assert.deepEqual([...decodeFile(uri).bytes], [...bytes]);
});

test('arquivos grandes convertem em tempo razoável', () => {
  const bytes = new Uint8Array(20 * 1024 * 1024).fill(7);
  const started = performance.now();
  const decoded = decodeFile(encodeFile(bytes).output);
  assert.equal(decoded.bytes.length, bytes.length);
  assert.ok(performance.now() - started < 5000);
});

test('isTextBytes separa o que cabe no editor', () => {
  assert.equal(isTextBytes(new TextEncoder().encode('olá')), true);
  assert.equal(isTextBytes(fromAscii('%PDF-1.4')), false);
  assert.equal(isTextBytes(bytesOf(0, 1, 2)), false);
});

test('nomes de arquivo são limpos e a extensão é trocada', () => {
  assert.equal(sanitizeFileName('a/b:c?.pdf'), 'a_b_c_.pdf');
  assert.equal(sanitizeFileName('.oculto'), 'oculto');
  assert.equal(sanitizeFileName('  ', 'arquivo'), 'arquivo');
  assert.equal(replaceExtension('nota.fiscal.pdf', 'txt'), 'nota.fiscal.txt');
  assert.equal(replaceExtension('nota', 'pdf'), 'nota.pdf');
});

test('pares: tudo na família texto passa pelo Base64', () => {
  assert.deepEqual(targetsFor('file').map((s) => s.id), ['base64']);
  assert.deepEqual(targetsFor('text').map((s) => s.id), ['base64']);
  assert.deepEqual(targetsFor('base64').map((s) => s.id), ['text', 'file']);
  assert.equal(isValidPair('text', 'file'), false);
  assert.equal(isValidPair('json', 'file'), false);
});

test('a conversão pela interface devolve o arquivo e o texto aceita Data URI', () => {
  const result = runConversion(SAMPLE_PDF_BASE64, 'base64', 'file', {});
  assert.equal(result.file.type.ext, 'pdf');
  assert.equal(result.output, '');
  assert.equal(runConversion(result.file.bytes, 'file', 'base64', {}).output, SAMPLE_PDF_BASE64);
  assert.equal(runConversion('data:text/plain;base64,b2k=', 'base64', 'text', {}).output, 'oi');
});

test('o PDF de exemplo é estruturalmente válido', () => {
  const pdf = Buffer.from(SAMPLE_PDF_BASE64, 'base64').toString('latin1');
  const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');
  const offsets = pdf.slice(xref).split('\n').slice(3, 8).map((line) => Number(line.slice(0, 10)));
  offsets.forEach((offset, i) => assert.ok(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)));
});
