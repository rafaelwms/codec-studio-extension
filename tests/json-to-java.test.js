import test from 'node:test';
import assert from 'node:assert/strict';

import { jsonToJava } from '../src/core/json-to-java.js';
import { CodecError } from '../src/core/base64.js';

const parse = (json, options) => jsonToJava(JSON.stringify(json), options);

test('gera record com tipos inferidos', () => {
  const { output } = parse({ name: 'Ana', age: 33, active: true, score: 9.5 }, { rootClassName: 'User' });
  assert.match(output, /public record User\(/);
  assert.match(output, /String name/);
  assert.match(output, /Integer age/);
  assert.match(output, /Boolean active/);
  assert.match(output, /Double score/);
});

test('gera POJO com getters e setters JavaBeans', () => {
  const { output } = parse({ name: 'Ana', active: true }, { rootClassName: 'User', style: 'pojo' });
  assert.match(output, /public class User \{/);
  assert.match(output, /private String name;/);
  assert.match(output, /public String getName\(\) \{/);
  assert.match(output, /public void setName\(String name\) \{/);
  assert.match(output, /public boolean isActive\(\) \{/, 'boolean primitivo usa prefixo "is"');
});

test('estilo Lombok não emite acessores', () => {
  const { output } = parse({ name: 'Ana' }, { style: 'lombok', rootClassName: 'User' });
  assert.match(output, /@Data/);
  assert.match(output, /import lombok\.Data;/);
  assert.ok(!output.includes('getName'), 'Lombok gera os acessores em tempo de compilação');
});

test('nomes de chave viram identificadores Java válidos com @JsonProperty', () => {
  const { output } = parse({ 'first-name': 'Ana', user_id: 7, class: 'A', '2fa': true });
  assert.match(output, /@JsonProperty\("first-name"\) String firstName/);
  assert.match(output, /@JsonProperty\("user_id"\) Integer userId/);
  assert.match(output, /@JsonProperty\("class"\) String classValue/, 'palavra reservada é renomeada');
  assert.match(output, /@JsonProperty\("2fa"\) Boolean _2fa/, 'identificador não pode iniciar com dígito');
});

test('objetos aninhados viram classes estáticas internas', () => {
  const { output, classCount } = parse(
    { id: 1, address: { city: 'São Paulo', zip: '01310-000' } },
    { rootClassName: 'Customer' },
  );
  assert.equal(classCount, 2);
  assert.match(output, /public record Customer\(/);
  assert.match(output, /Address address/);
  assert.match(output, /public record Address\(/, 'record aninhado já é implicitamente static');
  assert.ok(output.trimEnd().endsWith('}'));
});

test('arrays de objetos são unificados numa única classe e nome singular', () => {
  const { output, classCount } = parse({
    items: [
      { sku: 'A1', qty: 2 },
      { sku: 'A2', qty: 3, note: 'presente' },
    ],
  });
  assert.equal(classCount, 2);
  assert.match(output, /List<Item> items/);
  assert.match(output, /public record Item\(/);
  assert.match(output, /String note/, 'campo presente em apenas um elemento é incluído');
  assert.match(output, /import java\.util\.List;/);
});

test('tipos numéricos: int, long e BigDecimal', () => {
  const { output } = parse({ small: 42, big: 9_000_000_000, huge: 1e22, decimal: 1.5 });
  assert.match(output, /Integer small/);
  assert.match(output, /Long big/);
  assert.match(output, /BigDecimal huge/);
  assert.match(output, /Double decimal/);
  assert.match(output, /import java\.math\.BigDecimal;/);
});

test('detecta data, data-hora com offset e UUID', () => {
  const { output } = parse({
    date: '2026-07-30',
    dateTime: '2026-07-30T10:15:30',
    offset: '2026-07-30T10:15:30Z',
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  });
  assert.match(output, /LocalDate date/);
  assert.match(output, /LocalDateTime dateTime/);
  assert.match(output, /OffsetDateTime offset/);
  assert.match(output, /UUID id/);
  assert.match(output, /import java\.time\.LocalDate;/);
  assert.match(output, /import java\.util\.UUID;/);
});

test('detecção de data/hora pode ser desligada', () => {
  const { output } = parse({ date: '2026-07-30' }, { detectDateTime: false });
  assert.match(output, /String date/);
});

test('tipos mistos e arrays vazios geram Object com aviso', () => {
  const { output, warnings } = parse({ mixed: [1, 'dois'], empty: [] });
  assert.match(output, /List<Object> mixed/);
  assert.match(output, /List<Object> empty/);
  assert.equal(warnings.length, 2);
});

test('chaves dinâmicas viram Map<String, …>', () => {
  const { output, warnings } = parse({ byId: { 101: { total: 5 }, 102: { total: 8 } } });
  assert.match(output, /Map<String, ById> byId/);
  assert.match(output, /import java\.util\.Map;/);
  assert.ok(warnings.some((warning) => /chaves dinâmicas/.test(warning)));
});

test('raiz em array gera a classe do elemento e explica o tipo da raiz', () => {
  const { output } = jsonToJava('[{"id":1},{"id":2}]', { rootClassName: 'Product' });
  assert.match(output, /List<Product>/);
  assert.match(output, /record Product\(/);
});

test('campos ausentes ou nulos usam tipos wrapper no POJO', () => {
  const { output } = jsonToJava('[{"a":1,"b":true},{"a":2}]', { style: 'pojo', rootClassName: 'Row' });
  assert.match(output, /private int a;/, '"a" está em todas as amostras: pode ser primitivo');
  assert.match(output, /private Boolean b;/, '"b" falta numa amostra: precisa aceitar null');
});

test('classes separadas em vez de aninhadas', () => {
  const { output } = parse({ address: { city: 'SP' } }, { nested: 'separate', rootClassName: 'Customer' });
  assert.match(output, /\/\/ ==== Customer\.java ====/);
  assert.match(output, /\/\/ ==== Address\.java ====/);
  assert.ok(!/public static/.test(output));
});

test('package e imports ordenados', () => {
  const { output } = parse({ when: '2026-07-30', tags: ['a'] }, { packageName: 'com.exemplo.dto' });
  const lines = output.split('\n');
  assert.equal(lines[1], 'package com.exemplo.dto;');
  const imports = lines.filter((line) => line.startsWith('import '));
  assert.deepEqual(imports, [
    'import java.time.LocalDate;',
    'import java.util.List;',
    'import com.fasterxml.jackson.annotation.JsonProperty;',
  ]);
});

test('colisão de nomes de classe é resolvida', () => {
  const { output } = parse({ user: { id: 1 }, orders: [{ user: { name: 'x' } }] });
  assert.match(output, /record User\(/);
  assert.match(output, /record User2\(/);
});

test('JSON inválido reporta linha e coluna', () => {
  const error = catchError(() => jsonToJava('{\n  "a": 1,\n  "b": \n}'));
  assert.ok(error instanceof CodecError);
  assert.match(error.message, /linha \d+, coluna \d+/);
});

test('raiz escalar é recusada com orientação', () => {
  const error = catchError(() => jsonToJava('42'));
  assert.match(error.message, /objeto ou um array/);
});

test('entrada vazia é recusada', () => {
  assert.throws(() => jsonToJava('   '), CodecError);
});

function catchError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('esperava uma exceção');
}
