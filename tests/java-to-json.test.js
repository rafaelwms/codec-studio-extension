import test from 'node:test';
import assert from 'node:assert/strict';

import { javaToJson } from '../src/core/java-to-json.js';
import { parseJava } from '../src/core/java-parser.js';
import { CodecError } from '../src/core/base64.js';

const asJson = (source, options) => JSON.parse(javaToJson(source, options).output);

test('POJO simples com campos privados', () => {
  const value = asJson(`
    public class User {
        private String name;
        private int age;
        private boolean active;
    }
  `);
  assert.deepEqual(Object.keys(value), ['name', 'age', 'active']);
  assert.equal(typeof value.name, 'string');
  assert.equal(typeof value.age, 'number');
  assert.equal(value.active, true);
});

test('métodos, construtores e blocos são ignorados', () => {
  const value = asJson(`
    public class User {
        private String name;

        public User(String name) { this.name = name; }

        public String getName() { return name; }

        public void setName(String name) { this.name = name; }

        static { System.out.println("init"); }
    }
  `);
  assert.deepEqual(Object.keys(value), ['name']);
});

test('campos static e transient ficam de fora', () => {
  const value = asJson(`
    public class Config {
        public static final long serialVersionUID = 1L;
        private static String SHARED = "x";
        private transient String cache;
        private String region;
    }
  `);
  assert.deepEqual(Object.keys(value), ['region']);
});

test('record com componentes no cabeçalho', () => {
  const value = asJson('public record Point(double x, double y, String label) { }');
  assert.deepEqual(Object.keys(value), ['x', 'y', 'label']);
  assert.equal(typeof value.x, 'number');
});

test('record com corpo, métodos compactos e constantes', () => {
  const value = asJson(`
    public record Money(BigDecimal amount, String currency) {
        public static final Money ZERO = new Money(BigDecimal.ZERO, "BRL");
        public Money {
            if (amount == null) throw new IllegalArgumentException();
        }
        public Money plus(Money other) { return new Money(amount.add(other.amount), currency); }
    }
  `);
  assert.deepEqual(Object.keys(value), ['amount', 'currency']);
});

test('@JsonProperty renomeia a chave e @JsonIgnore remove o campo', () => {
  const value = asJson(`
    public class Account {
        @JsonProperty("account_number")
        private String accountNumber;

        @JsonIgnore
        private String internalToken;

        @com.fasterxml.jackson.annotation.JsonProperty("created_at")
        private LocalDateTime createdAt;
    }
  `);
  assert.deepEqual(Object.keys(value), ['account_number', 'created_at']);
  assert.equal(value.created_at, '2026-07-30T10:15:30');
});

test('coleções, mapas, Optional e arrays', () => {
  const value = asJson(`
    public class Cart {
        private List<String> tags;
        private Set<Integer> ids;
        private Map<String, Integer> totals;
        private Optional<String> coupon;
        private double[] weights;
        private String[][] grid;
    }
  `);
  assert.ok(Array.isArray(value.tags) && typeof value.tags[0] === 'string');
  assert.ok(Array.isArray(value.ids) && typeof value.ids[0] === 'number');
  assert.equal(typeof value.totals, 'object');
  assert.equal(typeof value.totals.chave, 'number');
  assert.equal(typeof value.coupon, 'string');
  assert.ok(Array.isArray(value.weights));
  assert.ok(Array.isArray(value.grid) && Array.isArray(value.grid[0]));
});

test('genéricos aninhados preservam o tipo interno', () => {
  const value = asJson(`
    public class Report {
        private Map<String, List<Item>> grouped;
    }
    class Item { private String sku; }
  `);
  assert.ok(Array.isArray(value.grouped.chave));
  assert.deepEqual(Object.keys(value.grouped.chave[0]), ['sku']);
});

test('classes aninhadas e referenciadas são resolvidas', () => {
  const value = asJson(`
    public class Order {
        private Long id;
        private Customer customer;
        private List<Line> lines;

        public static class Customer {
            private String name;
            private Address address;
        }

        public static class Address {
            private String city;
        }

        public static class Line {
            private String sku;
            private int quantity;
        }
    }
  `);
  assert.equal(typeof value.customer.name, 'string');
  assert.equal(typeof value.customer.address.city, 'string');
  assert.equal(value.lines[0].quantity, 3);
});

test('enum usa a primeira constante', () => {
  const value = asJson(`
    public class Task {
        private Status status;
    }
    enum Status {
        PENDING("p"), DONE("d");
        private final String code;
        Status(String code) { this.code = code; }
    }
  `);
  assert.equal(value.status, 'PENDING');
});

test('referência cíclica vira null com aviso', () => {
  const result = javaToJson(`
    public class Node {
        private String label;
        private Node parent;
    }
  `);
  const value = JSON.parse(result.output);
  assert.equal(value.parent, null);
  assert.ok(result.warnings.some((warning) => /cíclica/.test(warning)));
});

test('comentários (linha, bloco e javadoc) são ignorados', () => {
  const value = asJson(`
    /** Javadoc com "aspas" e { chaves }. */
    public class Doc {
        // private String comentado;
        private String real; /* outro ; comentário */
        /* private String tambemComentado; */
    }
  `);
  assert.deepEqual(Object.keys(value), ['real']);
});

test('literais de string com chaves e ponto e vírgula não confundem o parser', () => {
  const value = asJson(`
    public class Tricky {
        private String template = "{ \\"a\\": 1; }";
        private char separator = ';';
        private String name;
    }
  `);
  assert.deepEqual(Object.keys(value), ['template', 'separator', 'name']);
});

test('múltiplos campos na mesma declaração', () => {
  const value = asJson('public class P { private int x, y, z; }');
  assert.deepEqual(Object.keys(value), ['x', 'y', 'z']);
});

test('modo "empty" gera valores neutros', () => {
  const value = asJson(
    'public class U { private String name; private int age; private boolean ok; private List<String> tags; }',
    { values: 'empty' },
  );
  assert.deepEqual(value, { name: '', age: 0, ok: false, tags: [] });
});

test('raiz escolhida manualmente entre várias classes', () => {
  const source = 'class A { private int a; } class B { private int b; }';
  assert.deepEqual(Object.keys(asJson(source)), ['a']);
  assert.deepEqual(Object.keys(asJson(source, { rootType: 'B' })), ['b']);
  assert.deepEqual(javaToJson(source).types, ['A', 'B']);
});

test('tipos de data/hora e UUID viram strings ISO', () => {
  const value = asJson(`
    public class Event {
        private UUID id;
        private LocalDate day;
        private LocalTime time;
        private OffsetDateTime at;
        private Instant recordedAt;
        private Duration length;
    }
  `);
  assert.match(value.id, /^[0-9a-f-]{36}$/);
  assert.equal(value.day, '2026-07-30');
  assert.equal(value.time, '10:15:30');
  assert.equal(value.at, '2026-07-30T10:15:30Z');
  assert.equal(value.recordedAt, '2026-07-30T10:15:30Z');
  assert.equal(value.length, 'PT1H30M');
});

test('tipo desconhecido gera objeto vazio com aviso', () => {
  const result = javaToJson('class A { private ThirdPartyThing thing; }');
  assert.deepEqual(JSON.parse(result.output).thing, {});
  assert.ok(result.warnings.some((warning) => /ThirdPartyThing/.test(warning)));
});

test('campos com inicializadores e genéricos diamond', () => {
  const value = asJson(`
    public class Bag {
        private List<String> items = new ArrayList<>();
        private Map<String, String> meta = new HashMap<>();
        private int count = 0;
    }
  `);
  assert.deepEqual(Object.keys(value), ['items', 'meta', 'count']);
});

test('anotações com argumentos complexos não quebram a declaração', () => {
  const value = asJson(`
    public class Entity {
        @Column(name = "full_name", nullable = false, length = 120)
        private String fullName;

        @OneToMany(mappedBy = "entity", cascade = CascadeType.ALL)
        private List<Child> children;
    }
    class Child { private Long id; }
  `);
  assert.deepEqual(Object.keys(value), ['fullName', 'children']);
  assert.equal(value.children[0].id, 1);
});

test('entrada sem tipos é recusada', () => {
  assert.throws(() => javaToJson('int x = 1;'), CodecError);
  assert.throws(() => javaToJson('  '), CodecError);
});

test('parser expõe a árvore de tipos', () => {
  const { types } = parseJava('public class Outer { private int a; static class Inner { private int b; } }');
  assert.equal(types.length, 1);
  assert.equal(types[0].name, 'Outer');
  assert.equal(types[0].nested[0].name, 'Inner');
});

test('ida e volta: JSON → Java → JSON preserva as chaves', async () => {
  const { jsonToJava } = await import('../src/core/json-to-java.js');
  const original = { id: 1, name: 'Ana', tags: ['a', 'b'], address: { city: 'SP' } };
  const java = jsonToJava(JSON.stringify(original), { rootClassName: 'Person', style: 'pojo' }).output;
  const back = JSON.parse(javaToJson(java).output);
  assert.deepEqual(Object.keys(back), Object.keys(original));
  assert.deepEqual(Object.keys(back.address), ['city']);
  assert.ok(Array.isArray(back.tags));
});
