/**
 * Catálogo em português do Brasil.
 *
 * Deve conter exatamente as mesmas chaves de en.js — há um teste que garante isso
 * e que confere se os placeholders {assim} batem entre os dois idiomas.
 */

export default {
  /* ------------------------------------------------------------- core/base64 */
  'core.base64.invalidChar': 'Caractere inválido para Base64: "{char}" na posição {position}.',
  'core.base64.invalidChar.hint':
    'O alfabeto Base64 aceita A–Z, a–z, 0–9, "+" e "/" (ou "-" e "_" no modo URL-safe).',
  'core.base64.dataAfterPadding': 'Dados depois do padding "=" na posição {position}.',
  'core.base64.dataAfterPadding.hint': 'O caractere "=" só pode aparecer no final da string.',
  'core.base64.whitespaceStrict': 'Espaços e quebras de linha não são permitidos no modo estrito.',
  'core.base64.whitespaceIgnored': 'Espaços e quebras de linha foram ignorados.',
  'core.base64.mixedAlphabetStrict': 'A entrada mistura os alfabetos padrão ("+/") e URL-safe ("-_").',
  'core.base64.mixedAlphabet': 'A entrada mistura os alfabetos padrão e URL-safe; ambos foram aceitos.',
  'core.base64.invalidPadding': 'Padding inválido: {count} caracteres "=" no final.',
  'core.base64.invalidPadding.hint': 'Base64 admite no máximo dois "=".',
  'core.base64.invalidLength': 'Comprimento inválido: sobra um único caractere Base64 no final.',
  'core.base64.invalidLength.hint':
    'Uma string Base64 válida tem comprimento múltiplo de 4 (desconsiderando o padding).',
  'core.base64.missingPaddingStrict': 'Padding "=" ausente no modo estrito.',
  'core.base64.missingPadding': 'Padding "=" ausente; a decodificação foi feita mesmo assim.',
  'core.base64.oddPadding': 'A quantidade de "=" no final não fecha um bloco de 4 caracteres.',
  'core.base64.notUtf8':
    'Os bytes decodificados não formam um texto UTF-8 válido — provavelmente é conteúdo binário.',

  /* --------------------------------------------------------------- core/json */
  'core.json.empty': 'Nada para converter.',
  'core.json.empty.hint': 'Cole ou digite um JSON no painel de entrada.',
  'core.json.invalidAt': 'JSON inválido na linha {line}, coluna {column}.',
  'core.json.invalid': 'JSON inválido.',
  'core.json.hint': '{message} — trecho: {excerpt}',
  'core.json.scan.extraContent': 'Conteúdo extra depois do fim do documento ("{char}").',
  'core.json.scan.unexpectedEnd': 'Documento terminou antes do esperado.',
  'core.json.scan.unexpectedValue': 'Valor inesperado começando em "{char}".',
  'core.json.scan.expectedKey': 'Esperava o nome de uma chave entre aspas duplas.',
  'core.json.scan.expectedColon': 'Esperava ":" depois do nome da chave.',
  'core.json.scan.trailingCommaObject': 'Vírgula sobrando antes de "}".',
  'core.json.scan.trailingCommaArray': 'Vírgula sobrando antes de "]".',
  'core.json.scan.unclosedObject': 'Faltou fechar o objeto com "}".',
  'core.json.scan.expectedCommaOrBrace': 'Esperava "," ou "}" mas veio "{char}".',
  'core.json.scan.unclosedArray': 'Faltou fechar o array com "]".',
  'core.json.scan.expectedCommaOrBracket': 'Esperava "," ou "]" mas veio "{char}".',
  'core.json.scan.newlineInString': 'Quebra de linha dentro de uma string (use \\n).',
  'core.json.scan.unclosedString': 'String sem aspas de fechamento.',
  'core.json.scan.badNumber': 'Número mal formado.',

  /* -------------------------------------------------------- core/json → java */
  'core.jsonToJava.header': '// Gerado pelo Codec Studio — revise antes de usar em produção.',
  'core.jsonToJava.rootArrayNote': '// A raiz do JSON é um array — desserialize como {type}.',
  'core.jsonToJava.mixedTypes': 'O campo "{name}" mistura tipos ({types}); foi gerado como Object.',
  'core.jsonToJava.rootMustBeObject': 'O JSON precisa ser um objeto ou um array para virar classes Java.',
  'core.jsonToJava.rootMustBeObject.hint':
    'Valor recebido: {type}. Envolva o conteúdo em { } para gerar uma classe.',
  'core.jsonToJava.rootIsArrayOfScalars':
    'A raiz é um array de valores simples: use {type} diretamente.',
  'core.jsonToJava.emptyArray': 'O array "{name}" está vazio; o tipo do elemento virou Object.',
  'core.jsonToJava.dynamicKeys': '"{name}" tem chaves dinâmicas; foi gerado como Map<String, …>.',
  'core.jsonToJava.emptyObject':
    'O objeto "{name}" está vazio; a classe {className} foi gerada sem campos.',

  /* -------------------------------------------------------- core/java → json */
  'core.javaToJson.empty': 'Nada para converter.',
  'core.javaToJson.empty.hint': 'Cole uma classe ou record Java no painel de entrada.',
  'core.javaToJson.noTypes': 'Nenhuma classe, record ou enum encontrado.',
  'core.javaToJson.noTypes.hint':
    'Cole a declaração completa, incluindo "class Nome { … }" ou "record Nome(…) { }".',
  'core.javaToJson.interfaceNoFields': '"{name}" é uma interface sem campos; o objeto ficou vazio.',
  'core.javaToJson.cyclic': 'Referência cíclica em "{name}"; o campo recursivo virou null.',
  'core.javaToJson.noFields': '"{name}" não tem campos de instância; o objeto ficou vazio.',
  'core.javaToJson.unknownType': 'O tipo "{name}" é desconhecido; foi gerado como objeto vazio.',

  /* ------------------------------------------- core: valores de exemplo (java→json) */
  'core.convert.unknownFormat': 'Formato desconhecido: {name}.',
  'core.convert.unknownFormat.hint': 'Escolha um dos formatos listados no seletor.',

  /* --------------------------------------------- core: linguagens (genérico) */
  'core.lang.header': '// Gerado pelo Codec Studio — revise antes de usar em produção.',
  'core.lang.rootArrayNote': '// A raiz do documento é uma coleção — desserialize como {type}.',
  'core.lang.empty': 'Nada para converter.',
  'core.lang.empty.hint': 'Cole um código {lang} no painel de entrada.',
  'core.lang.noTypes': 'Nenhuma declaração de tipo {lang} foi encontrada.',
  'core.lang.noTypes.hint': 'Cole a declaração completa, incluindo o nome do tipo e o corpo.',
  'core.lang.unknownType': 'O tipo "{name}" é desconhecido para o leitor {lang}; virou um valor livre.',
  'core.lang.rootMustBeObject': '{lang} precisa de um objeto para descrever.',
  'core.lang.rootMustBeObject.hint': 'O documento é um {type}, que não tem campos para virar um tipo {lang}. Envolva-o em um objeto.',

  /* ---------------------------------------------- core: dados (JSON e YAML) */
  'core.data.rootIsArrayOfScalars': 'A raiz é um array de valores simples; nenhum tipo foi declarado.',
  'core.data.rootIsScalar': 'A raiz do documento é um único valor {type}; não há estrutura para modelar.',
  'core.data.mixedTypes': 'O campo "{name}" mistura tipos ({types}); virou um valor livre.',
  'core.data.emptyArray': 'O array "{name}" está vazio; o tipo do elemento é desconhecido.',
  'core.data.dynamicKeys': '"{name}" tem chaves dinâmicas; virou um dicionário.',
  'core.data.emptyObject': 'O objeto "{name}" está vazio; o tipo {className} ficou sem campos.',
  'core.data.cyclic': 'Referência cíclica em "{name}"; o campo recursivo virou null.',
  'core.data.noFields': '"{name}" não tem campos; o objeto ficou vazio.',

  /* --------------------------------------------------------------- core/yaml */
  'core.yaml.empty': 'Nada para converter.',
  'core.yaml.empty.hint': 'Cole ou digite um YAML no painel de entrada.',
  'core.yaml.unsupported': 'Este YAML usa âncoras, aliases ou merge keys.',
  'core.yaml.unsupported.hint': 'Esses recursos formam um grafo de referências que este conversor não resolve. Expanda-os e tente de novo.',
  'core.yaml.badIndent': 'Indentação inesperada na linha {line}.',
  'core.yaml.badIndent.hint': 'Blocos aninhados precisam alinhar de forma consistente; misturar tabulação e espaços também quebra a estrutura.',
  'core.yaml.expectedKey': 'A linha {line} não é um par "chave: valor" nem um item "- ".',
  'core.yaml.expectedKey.hint': 'Dentro de um mapeamento toda linha precisa de uma chave seguida de dois-pontos.',

  'core.sample.mapKey': 'chave',
  'core.sample.text': 'texto',
  'core.sample.name': 'Maria Silva',
  'core.sample.email': 'pessoa@exemplo.com',
  'core.sample.url': 'https://example.com/recurso',
  'core.sample.phone': '+55 11 90000-0000',
  'core.sample.city': 'São Paulo',
  'core.sample.state': 'SP',
  'core.sample.country': 'BR',
  'core.sample.zip': '01310-000',
  'core.sample.status': 'ATIVO',
  'core.sample.description': 'Descrição de exemplo',
  'core.sample.title': 'Título de exemplo',
  'core.sample.locale': 'pt-BR',
  'core.sample.currency': 'BRL',
  'core.sample.masked': '••••••••',

  /* ---------------------------------------------------------------- ui/chrome */
  'ui.brand.tagline': '100% offline · sem permissões',
  'ui.tab.base64': 'Base64',
  'ui.tab.jsonJava': 'JSON ⇄ Java',
  'ui.tabs.label': 'Ferramenta',
  'ui.action.theme': 'Alternar tema claro/escuro',
  'ui.action.expand': 'Abrir em uma aba',
  'ui.action.language': 'Switch to English',
  'ui.action.languageCode': 'PT',
  'ui.options.label': 'Opções de conversão',

  'ui.panel.input': 'Entrada',
  'ui.panel.output': 'Saída',
  'ui.panel.sample': 'Exemplo',
  'ui.panel.clear': 'Limpar',
  'ui.panel.download': 'Baixar',
  'ui.panel.copy': 'Copiar',
  'ui.panel.copied': 'Copiado',
  'ui.convert': 'Converter',
  'ui.convert.title': 'Converter (Ctrl/⌘ + Enter)',
  'ui.swap': 'Inverter direção',
  'ui.swap.title': 'Inverter direção (Ctrl/⌘ + I)',
  'ui.dropzone': 'Solte o arquivo para carregar',
  'ui.placeholder.output': 'O resultado aparece aqui.',
  'ui.input.placeholder': 'Digite, cole ou solte um arquivo aqui…',
  'ui.status.shield': 'Nada sai do seu navegador',
  'ui.status.convert': 'converter',
  'ui.status.swap': 'inverter',
  'ui.status.copy': 'copiar',
  'ui.footer.copyright': '© 2026 Rafael WMS',

  /* --------------------------------------------------------------- ui/metrics */
  'ui.unit.char.one': 'caractere',
  'ui.unit.char.other': 'caracteres',
  'ui.unit.byte.one': 'byte',
  'ui.unit.byte.other': 'bytes',
  'ui.unit.line.one': 'linha',
  'ui.unit.line.other': 'linhas',
  'ui.metrics.none': '—',
  'ui.metrics.ms': '{value} ms',
  'ui.metrics.largeInput': 'entrada grande — use o botão Converter',

  /* ---------------------------------------------------------------- ui/errors */
  'ui.error.generic': 'Não foi possível converter.',
  'ui.toast.copied': 'Resultado copiado.',
  'ui.toast.nothingToCopy': 'Nada para copiar ainda.',
  'ui.toast.copyBlocked': 'O navegador bloqueou a cópia.',
  'ui.toast.nothingToDownload': 'Nada para baixar ainda.',
  'ui.toast.downloaded': 'Arquivo {name} salvo.',
  'ui.toast.fileLoaded': '{name} carregado.',
  'ui.toast.fileTooLarge': 'Arquivo muito grande (máx. {size} MB).',
  'ui.toast.fileError': 'Não foi possível ler o arquivo.',
  'ui.download.encoded': 'codificado.b64.txt',
  'ui.download.decoded': 'decodificado.txt',

  /* ---------------------------------------------------------------- ui/labels */
  'ui.label.detected': '{output} · detectado',
  'ui.label.base64.encode.input': 'Texto',
  'ui.label.base64.encode.output': 'Base64',
  'ui.label.base64.encode.placeholder': 'Digite o texto que deve virar Base64…',
  'ui.label.base64.decode.input': 'Base64',
  'ui.label.base64.decode.output': 'Texto',
  'ui.label.base64.decode.placeholder': 'Cole o Base64 para decodificar…',
  'ui.label.base64.auto.input': 'Texto ou Base64',
  'ui.label.base64.auto.output': 'Resultado',
  'ui.label.base64.auto.placeholder': 'Cole qualquer um dos dois — a direção é detectada…',
  'ui.label.jsonJava.json-to-java.input': 'JSON',
  'ui.label.jsonJava.json-to-java.output': 'Java',
  'ui.label.jsonJava.json-to-java.placeholder': '{\n  "id": 1,\n  "nome": "Ana"\n}',
  'ui.label.jsonJava.java-to-json.input': 'Java',
  'ui.label.jsonJava.java-to-json.output': 'JSON',
  'ui.label.jsonJava.java-to-json.placeholder': 'public record Pessoa(Long id, String nome) { }',

  /* --------------------------------------------------------------- ui/options */
  'ui.opt.direction': 'Direção',
  'ui.opt.encode': 'Codificar',
  'ui.opt.decode': 'Decodificar',
  'ui.opt.auto': 'Auto',
  'ui.opt.alphabet': 'Alfabeto',
  'ui.opt.standard': 'Padrão',
  'ui.opt.urlSafe': 'URL-safe',
  'ui.opt.padding': 'Padding =',
  'ui.opt.wrap': 'Quebrar em 76',
  'ui.opt.strict': 'Modo estrito',
  'ui.opt.jsonToJava': 'JSON → Java',
  'ui.opt.javaToJson': 'Java → JSON',
  'ui.opt.style': 'Estilo',
  'ui.opt.record': 'Record',
  'ui.opt.pojo': 'POJO',
  'ui.opt.lombok': 'Lombok',
  'ui.opt.className': 'Classe',
  'ui.opt.classNamePlaceholder': 'Root',
  'ui.opt.package': 'Package',
  'ui.opt.packagePlaceholder': 'com.exemplo',
  'ui.opt.jackson': 'Jackson',
  'ui.opt.jacksonAll': 'Anotar tudo',
  'ui.opt.primitives': 'Primitivos',
  'ui.opt.detectDates': 'Detectar datas',
  'ui.opt.separateFiles': 'Arquivos separados',
  'ui.opt.values': 'Valores',
  'ui.opt.example': 'Exemplo',
  'ui.opt.empty': 'Vazios',
  'ui.opt.rootType': 'Raiz',

  /* ------------------------------------------------------- ui: formatos novos */
  'ui.surface.text': 'Texto simples',
  'ui.surface.base64': 'Base64',
  'ui.format.from': 'Converter de',
  'ui.format.to': 'Converter para',
  'ui.options.title': 'Opções',
  'ui.options.close': 'Fechar opções',
  'ui.options.reset': 'Restaurar',
  'ui.options.none': 'Este par não tem opções para ajustar.',
  'ui.toast.optionsReset': 'Opções restauradas para o padrão.',
  'ui.toast.cannotSwap': 'Estes dois formatos não podem trocar de lugar.',

  'ui.opt.namespace': 'Namespace',
  'ui.opt.namespacePlaceholder': 'Empresa.Api',
  'ui.opt.goPackagePlaceholder': 'main',
  'ui.opt.class': 'Classe',
  'ui.opt.struct': 'Struct',
  'ui.opt.interface': 'Interface',
  'ui.opt.typeAlias': 'Type',
  'ui.opt.angular': 'Angular',
  'ui.opt.jsonAttributes': 'Atributos JSON',
  'ui.opt.jsonAttributesAll': 'Anotar tudo',
  'ui.opt.nullable': 'Tipos anuláveis',
  'ui.opt.exportTypes': 'export',
  'ui.opt.optionalMarker': 'Usar "?" para opcional',
  'ui.opt.readonly': 'Campos readonly',
  'ui.opt.useDate': 'Date em vez de string',
  'ui.opt.finalFields': 'Campos final',
  'ui.opt.jsonMethods': 'fromJson / toJson',
  'ui.opt.namedParameters': 'Parâmetros nomeados',
  'ui.opt.codable': 'Codable',
  'ui.opt.letConstants': 'let em vez de var',
  'ui.opt.codingKeys': 'CodingKeys',
  'ui.opt.jsonTags': 'Tags JSON',
  'ui.opt.omitempty': 'omitempty',
  'ui.opt.pointerOptionals': 'Ponteiro para opcional',
  'ui.opt.useTime': 'time.Time para datas',

  'ui.sample.text': 'Olá, mundo! Codec Studio funciona 100% offline. 🔒',
  'ui.sample.base64': 'T2zDoSwgbXVuZG8hIENvZGVjIFN0dWRpbyBmdW5jaW9uYSAxMDAlIG9mZmxpbmUuIPCflJI=',
  'ui.sample.yaml': `id: 1024
full_name: Ana Souza
email: ana@exemplo.com
active: true
score: 9.75
created_at: 2026-07-30T10:15:30Z
address:
  city: São Paulo
  state: SP
  zip: "01310-000"
orders:
  - sku: CS-100
    quantity: 2
    total: 199.9
tags:
  - premium
  - beta`,
  'ui.sample.csharp': `public class Pedido
{
    public long Id { get; set; }

    [JsonPropertyName("criado_em")]
    public DateTimeOffset CriadoEm { get; set; }

    public decimal Total { get; set; }
    public string? Observacao { get; set; }
    public List<Item> Itens { get; set; }
}

public class Item
{
    public string Sku { get; set; }
    public int Quantidade { get; set; }
}`,
  'ui.sample.typescript': `export interface Pedido {
  id: number;
  criado_em: string;
  total: number;
  observacao?: string;
  status: 'aberto' | 'pago' | 'cancelado';
  itens: Item[];
}

export interface Item {
  sku: string;
  quantidade: number;
}`,
  'ui.sample.dart': `class Pedido {
  final int id;
  final DateTime criadoEm;
  final double total;
  final String? observacao;
  final List<Item> itens;

  Pedido({
    required this.id,
    required this.criadoEm,
    required this.total,
    this.observacao,
    required this.itens,
  });
}

class Item {
  final String sku;
  final int quantidade;

  Item({required this.sku, required this.quantidade});
}`,
  'ui.sample.swift': `struct Pedido: Codable {
    let id: Int
    let criadoEm: Date
    let total: Double
    let observacao: String?
    let itens: [Item]

    enum CodingKeys: String, CodingKey {
        case id
        case criadoEm = "criado_em"
        case total
        case observacao
        case itens
    }
}

struct Item: Codable {
    let sku: String
    let quantidade: Int
}`,
  'ui.sample.go': `type Pedido struct {
	ID        int64     \`json:"id"\`
	CriadoEm  time.Time \`json:"criado_em"\`
	Total     float64   \`json:"total"\`
	Observacao *string  \`json:"observacao,omitempty"\`
	Itens     []Item    \`json:"itens"\`
}

type Item struct {
	SKU        string \`json:"sku"\`
	Quantidade int    \`json:"quantidade"\`
}`,

  /* -------------------------------------------------------- ui/sample content */
  'ui.sample.json': `{
  "id": 1024,
  "full_name": "Ana Souza",
  "email": "ana@exemplo.com",
  "active": true,
  "score": 9.75,
  "created_at": "2026-07-30T10:15:30Z",
  "address": {
    "city": "São Paulo",
    "state": "SP",
    "zip": "01310-000"
  },
  "orders": [
    {
      "sku": "CS-100",
      "quantity": 2,
      "total": 199.9
    },
    {
      "sku": "CS-200",
      "quantity": 1,
      "total": 49.9,
      "note": "presente"
    }
  ],
  "tags": [
    "premium",
    "beta"
  ]
}`,
  'ui.sample.java': `public class Pedido {
    private Long id;
    private String cliente;

    @JsonProperty("criado_em")
    private OffsetDateTime criadoEm;

    private BigDecimal total;
    private Status status;
    private List<Item> itens;

    public static class Item {
        private String sku;
        private int quantidade;
        private BigDecimal preco;
    }
}

enum Status { ABERTO, PAGO, CANCELADO }`,
};
