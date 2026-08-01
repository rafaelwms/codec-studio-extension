import test from 'node:test';
import assert from 'node:assert/strict';

import { convert } from '../src/core/convert.js';
import { FORMAT_IDS, FORMATS, getFormat } from '../src/core/formats/index.js';
import { CodecError } from '../src/core/base64.js';

/** Amostra equivalente em cada formato: a mesma entidade descrita oito vezes. */
const SAMPLES = {
  json: JSON.stringify({
    id: 1, fullName: 'Ana', active: true, score: 1.5, tags: ['a'], address: { city: 'SP' },
  }),
  yaml: 'id: 1\nfullName: Ana\nactive: true\nscore: 1.5\ntags:\n  - a\naddress:\n  city: SP',
  java: `public class Root {
    private Integer id;
    private String fullName;
    private Boolean active;
    private Double score;
    private List<String> tags;
    private Address address;
}
class Address { private String city; }`,
  csharp: `public class Root {
    public int Id { get; set; }
    public string FullName { get; set; }
    public bool Active { get; set; }
    public double Score { get; set; }
    public List<string> Tags { get; set; }
    public Address Address { get; set; }
}
public class Address { public string City { get; set; } }`,
  typescript: `export interface Root {
  id: number;
  fullName: string;
  active: boolean;
  score: number;
  tags: string[];
  address: Address;
}
export interface Address { city: string; }`,
  dart: `class Root {
  final int id;
  final String fullName;
  final bool active;
  final double score;
  final List<String> tags;
  final Address address;
  Root({required this.id, required this.fullName, required this.active, required this.score, required this.tags, required this.address});
}
class Address { final String city; Address({required this.city}); }`,
  swift: `struct Root: Codable {
    let id: Int
    let fullName: String
    let active: Bool
    let score: Double
    let tags: [String]
    let address: Address
}
struct Address: Codable { let city: String }`,
  go: `type Root struct {
	ID       int      \`json:"id"\`
	FullName string   \`json:"fullName"\`
	Active   bool     \`json:"active"\`
	Score    float64  \`json:"score"\`
	Tags     []string \`json:"tags"\`
	Address  Address  \`json:"address"\`
}
type Address struct {
	City string \`json:"city"\`
}`,
};

test('todo formato registrado expõe a mesma interface', () => {
  for (const format of FORMATS) {
    assert.equal(typeof format.id, 'string', 'id');
    assert.equal(typeof format.label, 'string', `${format.id}: label`);
    assert.ok(['data', 'lang'].includes(format.kind), `${format.id}: kind`);
    assert.equal(typeof format.parse, 'function', `${format.id}: parse`);
    assert.equal(typeof format.emit, 'function', `${format.id}: emit`);
    assert.equal(typeof format.extension, 'string', `${format.id}: extension`);
  }
});

test('todos os pares de formatos convertem sem falhar', () => {
  const failures = [];
  let count = 0;

  for (const from of FORMAT_IDS) {
    for (const to of FORMAT_IDS) {
      if (from === to) continue;
      count += 1;
      try {
        const { output } = convert(SAMPLES[from], from, to, { rootName: 'Root' });
        if (!output.trim()) failures.push(`${from} → ${to}: saída vazia`);
      } catch (error) {
        failures.push(`${from} → ${to}: ${error.message}`);
      }
    }
  }

  assert.equal(count, 56, 'oito formatos produzem 56 pares');
  assert.deepEqual(failures, []);
});

test('os campos sobrevivem a qualquer conversão para JSON', () => {
  for (const from of FORMAT_IDS) {
    if (from === 'json') continue;
    const { output } = convert(SAMPLES[from], from, 'json');
    const value = JSON.parse(output);
    const keys = Object.keys(value).map((key) => key.toLowerCase());

    for (const expected of ['id', 'fullname', 'active', 'tags', 'address']) {
      assert.ok(keys.includes(expected), `${from}: perdeu o campo "${expected}" (veio ${keys})`);
    }
    assert.ok(Array.isArray(value[Object.keys(value).find((k) => k.toLowerCase() === 'tags')]), `${from}: tags deve ser lista`);
  }
});

test('ida e volta por qualquer linguagem preserva a forma', () => {
  const original = JSON.stringify({ id: 1, name: 'Ana', tags: ['x'], nested: { city: 'SP' } });

  for (const lang of ['java', 'csharp', 'typescript', 'dart', 'swift', 'go']) {
    const code = convert(original, 'json', lang, { rootName: 'Root' }).output;
    const back = JSON.parse(convert(code, lang, 'json').output);
    const keys = Object.keys(back).map((key) => key.toLowerCase());

    assert.deepEqual(keys, ['id', 'name', 'tags', 'nested'], `${lang}: chaves da ida e volta`);
    assert.ok(Array.isArray(back.tags), `${lang}: tags`);
    assert.equal(typeof back.nested, 'object', `${lang}: objeto aninhado`);
  }
});

test('entre formatos de dados, os valores reais são preservados', () => {
  // De dados para dados não inferimos tipos: convertemos o documento do usuário.
  const original = {
    id: 1024, nome: 'Ana Souza', ativo: true, notas: [9.5, 8],
    endereco: { cidade: 'São Paulo', cep: '01310-000' }, nulo: null,
  };

  const yaml = convert(JSON.stringify(original), 'json', 'yaml').output;
  assert.match(yaml, /^id: 1024$/m, 'o valor original, não um exemplo');
  assert.match(yaml, /^nome: Ana Souza$/m);
  assert.match(yaml, /cep: 01310-000$/m);

  const back = JSON.parse(convert(yaml, 'yaml', 'json').output);
  assert.deepEqual(back, original, 'ida e volta idêntica');
});

test('YAML e JSON descrevem a mesma estrutura para uma linguagem', () => {
  const fromJson = convert(SAMPLES.json, 'json', 'java', { rootName: 'R' }).output;
  const fromYaml = convert(SAMPLES.yaml, 'yaml', 'java', { rootName: 'R' }).output;
  assert.equal(fromJson, fromYaml, 'os dois documentos geram o mesmo tipo');
});

test('tipos temporais atravessam as linguagens', () => {
  const source = JSON.stringify({ when: '2026-07-30T10:15:30Z', day: '2026-07-30', id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });
  const expectations = {
    java: [/OffsetDateTime when/, /LocalDate day/, /UUID id/],
    csharp: [/DateTimeOffset When/, /DateOnly Day/, /Guid Id/],
    swift: [/when: Date/, /day: Date/, /id: UUID/],
    dart: [/DateTime when/, /DateTime day/, /String id/],
    go: [/When\s+time\.Time/, /Day\s+time\.Time/, /ID\s+string/],
  };

  for (const [lang, patterns] of Object.entries(expectations)) {
    const { output } = convert(source, 'json', lang, { rootName: 'Event' });
    for (const pattern of patterns) {
      assert.match(output, pattern, `${lang}: ${pattern}`);
    }
  }
});

test('nomes fora da convenção viram anotação na linguagem de destino', () => {
  const source = JSON.stringify({ full_name: 'Ana', created_at: '2026-07-30' });

  assert.match(convert(source, 'json', 'java', { rootName: 'U' }).output, /@JsonProperty\("full_name"\)/);
  assert.match(convert(source, 'json', 'csharp', { rootName: 'U' }).output, /\[JsonPropertyName\("full_name"\)\]/);
  assert.match(convert(source, 'json', 'go', { rootName: 'U' }).output, /`json:"full_name"`/);
  assert.match(convert(source, 'json', 'swift', { rootName: 'U' }).output, /case fullName = "full_name"/);
});

test('campos opcionais viram o idioma de nulidade de cada linguagem', () => {
  const source = '[{"a":1,"b":true},{"a":2}]'; // "b" falta no segundo item

  assert.match(convert(source, 'json', 'typescript', { rootName: 'Row' }).output, /b\?: boolean;/);
  assert.match(convert(source, 'json', 'swift', { rootName: 'Row' }).output, /let b: Bool\?/);
  assert.match(convert(source, 'json', 'dart', { rootName: 'Row' }).output, /final bool\? b;/);
  assert.match(convert(source, 'json', 'csharp', { rootName: 'Row' }).output, /bool\? B/);
  assert.match(convert(source, 'json', 'go', { rootName: 'Row' }).output, /\*bool.*omitempty/);
});

test('união de literais TypeScript vira enum de verdade', () => {
  const source = "export interface Task { status: 'open' | 'done'; }";

  assert.match(convert(source, 'typescript', 'java').output, /public enum Status \{ OPEN, DONE \}/);
  assert.match(convert(source, 'typescript', 'csharp').output, /public enum Status/);
  assert.match(convert(source, 'typescript', 'swift').output, /enum Status: String, Codable/);
  assert.equal(JSON.parse(convert(source, 'typescript', 'json').output).status, 'open');
});

test('o estilo Angular gera classe com construtor', () => {
  const { output } = convert(SAMPLES.json, 'json', 'typescript', { style: 'angular', rootName: 'Customer' });
  assert.match(output, /export class Customer \{/);
  assert.match(output, /constructor\(init: Partial<Customer> = \{\}\)/);
  assert.match(output, /Object\.assign\(this, init\);/);
});

test('linguagem recusa documento sem estrutura; formato de dados aceita', () => {
  for (const lang of ['java', 'csharp', 'typescript', 'dart', 'swift', 'go']) {
    const error = catchError(() => convert('42', 'json', lang));
    assert.ok(error instanceof CodecError, `${lang} deveria recusar um escalar`);
    assert.match(error.code, /rootMustBeObject/, `${lang}: código do erro`);
  }
  // JSON → YAML de um escalar é perfeitamente válido e mantém o valor.
  assert.equal(convert('42', 'json', 'yaml').output.trim(), '42');
});

test('formato desconhecido é recusado', () => {
  const error = catchError(() => convert('{}', 'json', 'cobol'));
  assert.equal(error.code, 'core.convert.unknownFormat');
  assert.match(error.message, /cobol/);
});

test('o nome da raiz escolhido pelo usuário é aplicado e propagado', () => {
  const { output } = convert('{"a":{"b":1}}', 'json', 'java', { rootName: 'Pedido' });
  assert.match(output, /public record Pedido\(/);
  // O tipo aninhado continua referenciado corretamente após o rename.
  assert.match(output, /A a/);
});

test('a extensão de arquivo de cada formato é a esperada', () => {
  const expected = {
    json: 'json', yaml: 'yaml', java: 'java', csharp: 'cs',
    typescript: 'ts', dart: 'dart', swift: 'swift', go: 'go',
  };
  for (const [id, extension] of Object.entries(expected)) {
    assert.equal(getFormat(id).extension, extension, id);
  }
});

function catchError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('esperava uma exceção');
}
