# Codec Studio

**[▸ Instalar na Chrome Web Store](https://chromewebstore.google.com/detail/olkgemdfepbfnlgnmopmakdojoidpmbk)**
· também funciona no Microsoft Edge

Extensão de navegador (Chrome e Edge) para converter dados e modelos entre formatos.
Funciona **100% offline**, **sem permissões** e **sem nenhuma dependência externa**.
Interface em **inglês e português**, seguindo o idioma do navegador.

## Formatos

**Dados:** JSON · YAML
**Linguagens:** Java · C# · TypeScript · Dart · Swift · Go
**Texto:** Texto simples ⇄ Base64
**Arquivos:** qualquer arquivo ⇄ Base64 (PDF, imagens, Office, ZIP, áudio, vídeo…)

Qualquer formato de dados ou linguagem converte para qualquer outro — **56 combinações**.
Isso não vem de 56 conversores: cada formato tem um *leitor* (formato → modelo) e um
*escritor* (modelo → formato), e o modelo intermediário faz o resto. Acrescentar uma
linguagem nova é acrescentar um arquivo em [src/core/formats/](src/core/formats).

| Conversão | O que acontece |
|---|---|
| **Dados → Linguagem** | Infere os tipos do documento e gera as classes: `record`, POJO, struct, interface… |
| **Linguagem → Dados** | Lê as declarações e monta um documento de exemplo coerente com cada tipo |
| **Linguagem → Linguagem** | Traduz o modelo de uma para a outra, com as convenções de cada uma |
| **Dados → Dados** | Converte o seu documento preservando os valores reais (JSON ⇄ YAML) |
| **Texto ⇄ Base64** | Codifica e decodifica com UTF-8 correto, alfabeto URL-safe e dump hexadecimal para binário |
| **Arquivo ⇄ Base64** | Lê o arquivo na memória do navegador e gera Base64 ou Data URI; na volta, detecta o tipo pelo conteúdo e salva |

---

> **Publicando na Chrome Web Store?** Todos os textos do formulário, os assets de imagem e o
> passo a passo estão em [STORE.md](STORE.md). A política de privacidade exigida pela loja
> está em [PRIVACY.md](PRIVACY.md).

## Requisitos

Chrome ou Edge **120+** (`minimum_chrome_version` no manifesto). O limite vem do
`mask-image` sem prefixo, usado na animação de revelação do resultado e no esmaecimento da
barra de opções — abaixo dessa versão a interface funcionaria, mas sem esses efeitos.

## Instalação (modo desenvolvedor)

1. Gere a pasta de distribuição:
   ```bash
   npm run build
   ```
2. Abra `chrome://extensions` (ou `edge://extensions`) e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta `dist/`.
4. Fixe o ícone na barra e use `Alt+Shift+C` para abrir.

Para publicar, use o arquivo `codec-studio-<versão>.zip` gerado na raiz.
Também é possível carregar a pasta do projeto diretamente — `dist/` só remove testes e scripts.

---

## Por que ela é realmente offline e segura

Não é uma promessa de marketing; é o que o código permite:

- **`"permissions": []` e `"host_permissions": []`** — a extensão não pede nada. Sem acesso a
  abas, histórico, cookies, downloads ou sites. Chrome mostra "sem permissões" na instalação.
- **Sem `content_scripts`** — nada é injetado nas páginas que você visita. A extensão não
  consegue ler nenhuma página, nem a que está aberta agora.
- **Service worker mínimo** — o único existente ([src/background.js](src/background.js), 3 linhas) só abre o app em uma nova aba ao clicar no ícone. Nada mais roda em segundo plano; confira no código-fonte.
- **CSP restritiva** (`default-src 'none'; connect-src 'none'`) — o próprio navegador impede
  qualquer requisição de rede a partir da extensão, mesmo que um bug tentasse fazê-la.
- **Zero dependências** — nenhum `node_modules`, nenhuma CDN, nenhuma fonte remota, nenhum
  analytics. Todo o código é legível neste repositório, sem build step.
- **Sem `innerHTML`, sem `eval`, sem `new Function`** — o texto que você cola nunca é
  interpretado como HTML ou código. O realce de sintaxe constrói elementos DOM e preenche
  `textContent`, o que torna qualquer entrada inerte por construção.
- **Seu conteúdo não é salvo** — só as *preferências* (tema, opções) vão para o
  `localStorage`. O texto convertido vive na memória da janela e desaparece ao fechar.

Confira você mesmo:

```bash
grep -rE "fetch|XMLHttpRequest|https?://|innerHTML|eval\(" src/ styles/ app.html
```

---

## Uso

| Ação | Atalho |
|---|---|
| Converter | `Ctrl/⌘ + Enter` (a conversão também é automática ao digitar) |
| Inverter direção | `Ctrl/⌘ + I` — o resultado atual vira a nova entrada |
| Copiar resultado | `Ctrl/⌘ + Shift + C` |
| Abrir o app (nova aba) | `Alt + Shift + C` |

Também dá para **arrastar, colar ou abrir um arquivo** (até 100 MB) em qualquer ponto da
janela: texto vai para o editor, o resto entra como arquivo. A página se adapta a janelas
estreitas ou largas.

### Arquivos

- **Arquivo → Base64** gera Base64 puro ou, com a opção *Data URI*, `data:application/pdf;base64,…`.
- **Base64 → Arquivo** aceita Base64 puro, entre aspas ou Data URI. O tipo vem da assinatura
  do conteúdo, e a lista *Salvar como* traz primeiro os tipos prováveis (um ZIP pode ser
  `.docx`, `.jar`…). Imagens têm prévia; o nome do arquivo é livre.
- Resultados grandes aparecem resumidos na tela; Copiar e Baixar usam o conteúdo completo.
- Nada disso exige permissão ou rede: o arquivo fica só na memória da aba e o download é um
  `blob:` local.

### Base64

- **Auto** detecta se o que você colou é texto ou Base64 e escolhe a direção.
- Entradas com espaços, quebras de linha ou sem padding são aceitas (com aviso); o **modo
  estrito** rejeita todas essas tolerâncias.
- Erros apontam a posição exata: *"Caractere inválido para Base64: "#" na posição 5"*.
- Se os bytes decodificados não forem UTF-8 válido, a saída vira um **dump hexadecimal** com
  coluna ASCII, em vez de encher a tela de `�`.

### JSON → Java

Inferência de tipos a partir do documento inteiro:

- Números viram `Integer`, `Long` ou `BigDecimal` conforme a magnitude; decimais viram `Double`.
- Strings ISO viram `LocalDate`, `LocalDateTime`, `OffsetDateTime`; UUIDs viram `UUID`.
- Objetos dentro de um mesmo array são **fundidos numa única classe** — um campo que só
  aparece em alguns elementos é gerado com tipo wrapper (aceita `null`).
- Chaves inválidas em Java (`first-name`, `class`, `2fa`) viram identificadores válidos com
  `@JsonProperty` preservando o nome original.
- Objetos com chaves dinâmicas (ids, UUIDs) viram `Map<String, …>`.
- Avisos explicam cada decisão ambígua (tipos mistos, arrays vazios, colisões de nome).

### Java → JSON

Um parser leve percorre `class`, `record`, `enum` e `interface`, ignorando corpos de método,
comentários e literais. Respeita `@JsonProperty`/`@SerializedName` (renomeia) e `@JsonIgnore`
(remove), pula campos `static`/`transient`, resolve genéricos aninhados
(`Map<String, List<Item>>`), arrays, `Optional`, classes aninhadas e enums. Referências
cíclicas viram `null` com aviso. Os valores de exemplo seguem heurísticas por nome de campo
(`email`, `cep`, `preco`, `latitude`…) — ou use **Valores: Vazios** para um esqueleto neutro.

---

## Desenvolvimento

```bash
npm test           # 86 testes em node:test, sem dependências
npm run build      # gera dist/ + zip para as lojas
npm run icons      # regenera os PNGs a partir da geometria em scripts/make-icons.mjs
npm run serve      # http://localhost:4173/app.html para trabalhar a UI fora da extensão
npm run assets     # capturas 1280×800 e tiles da loja (precisa do serve rodando)
```

A lógica de conversão (`src/core/`) não toca no DOM e é testada diretamente pelo Node; a
interface (`src/ui/`) só orquestra. Por isso a mesma página se adapta a qualquer tamanho de janela, e
os mesmos módulos rodam nos testes.

**Idiomas.** Os catálogos são módulos ES importados estaticamente — não há `fetch`, o que
respeita a CSP e mantém tudo funcionando fora do contexto de extensão. O núcleo não conhece
a interface: ele lança erros com um `code` estável (`core.base64.invalidChar`) e pede o
texto ao catálogo ativo. Os testes verificam o código, que não muda com o idioma, e uma
suíte dedicada garante que `en` e `pt-BR` tenham as mesmas chaves e os mesmos placeholders.

```
manifest.json            MV3, zero permissões, CSP restritiva
app.html                 página do app, aberta em aba (o layout se adapta por media query)
styles/app.css           @layer, color-mix(), @property, temas claro/escuro
src/core/ir.js           modelo intermediário — o centro de tudo
src/core/convert.js      orquestrador: ler de um formato, escrever no outro
src/core/data-model.js   dados ⇄ modelo (inferência de tipos e exemplos)
src/core/parse-utils.js  varredura compartilhada pelos parsers de linguagem
src/core/formats/        um arquivo por formato: json, yaml, java, csharp,
                         typescript, dart, swift, go
src/core/base64.js       codec próprio (sem btoa/atob), erros com posição
src/core/messages.js     tradutor injetável usado pelo núcleo
src/locales/             catálogos en e pt-BR (interface + núcleo)
src/ui/                  main, surfaces, options, highlight, prefs, i18n
_locales/                nome e descrição para a loja localizar sozinha
tests/                   base64, convert, json-to-java, java-to-json, i18n
```

### Design

Paleta derivada do [NanoUrls](https://nanourls.com): verde-limão `#b3e600` sobre grafite,
com um acento único carregando a identidade. Tudo é CSS nativo, sem framework: camadas
`@layer`, `color-mix()` para derivar a paleta inteira do acento, `@property` para animar o
gradiente cônico e a máscara de revelação, `:has()` para estados, e **View Transitions** ao
trocar de formato. Tudo respeita `prefers-reduced-motion`.

O tema claro não usa o mesmo verde: `#b3e600` não alcança contraste suficiente sobre branco,
então a versão clara usa `#5f8a00` — mesma matiz, luminosidade adequada.

**Responsividade.** A barra de opções fixa foi substituída por um popover justamente porque
ela precisava caber no pior caso e estourava a janela. Abaixo de 720px os painéis empilham;
abaixo de 480px a marca vira só o símbolo. Em nenhuma largura há rolagem horizontal.

---

## Limitações conhecidas

- Os parsers de linguagem leem a *forma* dos tipos, não compilam: código com sintaxe
  inválida pode ser parcialmente interpretado em vez de rejeitado.
- Herança não é resolvida — campos de uma superclasse não entram no modelo.
- O YAML cobre o subconjunto usado em documentos reais, mas **não** resolve âncoras (`&`),
  aliases (`*`) nem merge keys (`<<`); nesses casos o conversor avisa em vez de adivinhar.
- Conversões entre linguagens preservam a *estrutura*, não a lógica: métodos, construtores
  e anotações que não descrevem serialização são ignorados por construção.
- Acima de 400 mil caracteres a conversão automática é desligada (use o botão Converter);
  acima de 160 mil o realce de sintaxe é suprimido para manter a interface fluida.

---

## Licença

[MIT](LICENSE) © 2026 Rafael WMS — uso livre, inclusive comercial, bastando
manter o aviso de copyright. Há uma [tradução informativa em português](LICENSE.pt-BR.md);
o texto em inglês é o que tem validade jurídica.
