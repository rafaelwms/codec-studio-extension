import test from 'node:test';
import assert from 'node:assert/strict';

import {
  base64ToBytes,
  bytesToBase64,
  decodeText,
  encodeText,
  looksLikeBase64,
  CodecError,
} from '../src/core/base64.js';

test('vetores RFC 4648', () => {
  const vectors = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];
  for (const [plain, encoded] of vectors) {
    assert.equal(encodeText(plain).output, encoded, `encode ${JSON.stringify(plain)}`);
    assert.equal(decodeText(encoded).output, plain, `decode ${encoded}`);
  }
});

test('UTF-8 multibyte: acentos, CJK e emoji', () => {
  const samples = ['ação', 'coração ❤️', '日本語テキスト', '👩‍💻 café ☕', 'ñ Ω ∑ 𝄞'];
  for (const sample of samples) {
    const encoded = encodeText(sample).output;
    assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/);
    assert.equal(decodeText(encoded).output, sample);
  }
});

test('alfabeto URL-safe e padding opcional', () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0xbe, 0x00]);
  assert.equal(bytesToBase64(bytes), '+/++AA==');
  assert.equal(bytesToBase64(bytes, { urlSafe: true }), '-_--AA==');
  assert.equal(bytesToBase64(bytes, { urlSafe: true, padding: false }), '-_--AA');
  assert.deepEqual([...base64ToBytes('-_--AA').bytes], [...bytes]);
});

test('quebra de linha a cada N caracteres (MIME)', () => {
  const encoded = encodeText('a'.repeat(120), { lineLength: 76 }).output;
  const lines = encoded.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.length <= 76));
  assert.equal(decodeText(encoded).output, 'a'.repeat(120));
});

test('decodificação tolera espaços e quebras, e avisa', () => {
  const result = decodeText('Zm9v\n  YmFy');
  assert.equal(result.output, 'foobar');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /ignorad/i);
});

test('modo estrito rejeita espaços', () => {
  assert.throws(() => decodeText('Zm9v YmFy', { strict: true }), CodecError);
});

test('erros trazem posição e dica', () => {
  const error = await_throws(() => decodeText('Zm9v#YmFy'));
  assert.ok(error instanceof CodecError);
  assert.equal(error.position, 4);
  assert.match(error.message, /posição 5/);

  const lengthError = await_throws(() => decodeText('Zm9vY'));
  assert.match(lengthError.message, /[Cc]omprimento inválido/);

  const paddingError = await_throws(() => decodeText('Zm==9v'));
  assert.match(paddingError.message, /padding/i);
});

test('conteúdo binário é sinalizado com dump hexadecimal', () => {
  const binary = bytesToBase64(new Uint8Array([0x00, 0xff, 0xfe, 0x89, 0x50, 0x4e, 0x47]));
  const result = decodeText(binary);
  assert.equal(result.binary, true);
  assert.match(result.hex, /^00000000 {2}00 ff fe 89 50 4e 47/);
  assert.equal(result.warnings.length, 1);
});

test('round-trip com todos os 256 bytes', () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) bytes[i] = i;
  const encoded = bytesToBase64(bytes);
  assert.deepEqual([...base64ToBytes(encoded).bytes], [...bytes]);
});

test('detecção heurística de Base64', () => {
  assert.equal(looksLikeBase64('Zm9vYmFy'), true);
  assert.equal(looksLikeBase64('SGVsbG8sIG11bmRvIQ=='), true);
  assert.equal(looksLikeBase64('Olá, mundo!'), false);
  assert.equal(looksLikeBase64('abc'), false);
  assert.equal(looksLikeBase64('{"a":1}'), false);
});

test('entrada grande permanece rápida', () => {
  const big = 'x'.repeat(1_000_000);
  const started = Date.now();
  const encoded = encodeText(big).output;
  assert.equal(decodeText(encoded).output, big);
  assert.ok(Date.now() - started < 3000, 'round-trip de 1 MB deve levar menos de 3s');
});

function await_throws(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('esperava uma exceção');
}
