# Codec Studio

Extensão de navegador (Chrome e Edge) para converter texto entre formatos de código.
Funciona **100% offline**, **sem permissões** e **sem nenhuma dependência externa**.

| | |
|---|---|
| **Base64** | Codificar / decodificar UTF-8, alfabeto padrão ou URL-safe, padding opcional, quebra MIME em 76 colunas, modo estrito, detecção automática de direção e dump hexadecimal para conteúdo binário |
| **JSON ⇄ Java** | JSON → `record`, POJO ou Lombok (com Jackson, `java.time`, classes aninhadas) e Java → JSON de exemplo |

---

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
- **Sem service worker / background** — nada roda quando o popup está fechado.
- **CSP restritiva** (`default-src 'none'; connect-src 'none'`) — o próprio navegador impede
  qualquer requisição de rede a partir da extensão, mesmo que um bug tentasse fazê-la.
- **Zero dependências** — nenhum `node_modules`, nenhuma CDN, nenhuma fonte remota, nenhum
  analytics. Todo o código é legível neste repositório (~2.400 linhas, sem build step).
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
| Abrir o popup | `Alt + Shift + C` |

Também dá para **arrastar um arquivo de texto** (até 5 MB) para o painel de entrada e
**abrir em uma aba** (ícone ↗) quando o popup ficar apertado — a mesma página se adapta.

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
npm test          # 53 testes em node:test, sem dependências
npm run build     # gera dist/ + zip para as lojas
npm run icons     # regenera os PNGs a partir da geometria em scripts/make-icons.mjs
npm run serve     # http://localhost:4173/app.html para trabalhar a UI fora da extensão
```

A lógica de conversão (`src/core/`) não toca no DOM e é testada diretamente pelo Node; a
interface (`src/ui/`) só orquestra. Por isso a mesma página abre como popup e como aba, e os
mesmos módulos rodam nos testes.

```
manifest.json          MV3, zero permissões, CSP restritiva
app.html               popup e aba (o layout troca por media query em 801px)
styles/app.css         @layer, color-mix(), @property, container-friendly, temas claro/escuro
src/core/base64.js     codec próprio (sem btoa/atob), erros com posição
src/core/json.js       JSON.parse + localizador de erro com linha/coluna
src/core/json-to-java.js
src/core/java-parser.js  varredura de declarações Java
src/core/java-to-json.js
src/ui/                main, options (spec declarativa), highlight, prefs
tests/                 base64, json-to-java, java-to-json
```

### Design

Tudo é CSS nativo, sem framework: camadas `@layer`, `color-mix()` para derivar toda a paleta
de três cores de acento, `@property` para animar gradiente cônico e a máscara de revelação,
`:has()` para estados, e **View Transitions** ao trocar de ferramenta ou inverter a direção.
A conversão dispara uma varredura luminosa no painel e uma revelação em máscara diagonal do
resultado. Tudo respeita `prefers-reduced-motion`.

---

## Limitações conhecidas

- O parser Java lê a *forma* dos tipos, não compila: código com sintaxe inválida pode ser
  parcialmente interpretado em vez de rejeitado.
- Herança não é resolvida — campos de uma superclasse não aparecem no JSON gerado.
- Acima de 400 mil caracteres a conversão automática é desligada (use o botão Converter);
  acima de 160 mil o realce de sintaxe é suprimido para manter a interface fluida.
