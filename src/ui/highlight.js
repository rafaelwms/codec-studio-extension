/**
 * Realce de sintaxe por construção de nós DOM.
 *
 * Segurança: nunca usamos innerHTML/insertAdjacentHTML. Cada token vira um
 * `<span>` cujo conteúdo é definido via textContent, de modo que qualquer texto
 * do usuário — inclusive algo como `<img onerror=…>` — é sempre inerte.
 */

const MAX_HIGHLIGHT_LENGTH = 160_000; // acima disso, texto puro (mantém a UI fluida)

/* ---------------------------------------------------------------- gramáticas */

const KEYWORDS = {
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while true false null',
  csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while',
  typescript: 'abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined union unknown var void while yield',
  dart: 'abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void while with yield',
  swift: 'actor any as associatedtype async await break case catch class continue default defer deinit didSet do else enum extension fallthrough false fileprivate final for func get guard if import in indirect infix init inout internal is lazy let mutating nil none nonmutating open operator private protocol public repeat required rethrows return self Self set some static struct subscript super switch throw throws true try typealias var weak where while willSet',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota',
};

const TOKEN_CLASSES = {
  key: 'tok-key',
  string: 'tok-string',
  number: 'tok-number',
  bool: 'tok-bool',
  nul: 'tok-null',
  punct: 'tok-punct',
  keyword: 'tok-keyword',
  type: 'tok-type',
  annotation: 'tok-annotation',
  comment: 'tok-comment',
  tag: 'tok-annotation',
};

const JSON_TOKENS = new RegExp([
  '(?<key>"(?:\\\\.|[^"\\\\])*")(?=\\s*:)',
  '(?<string>"(?:\\\\.|[^"\\\\])*")',
  '(?<number>-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)',
  '(?<bool>\\b(?:true|false)\\b)',
  '(?<nul>\\bnull\\b)',
  '(?<punct>[{}\\[\\],:])',
].join('|'), 'g');

const YAML_TOKENS = new RegExp([
  '(?<comment>#[^\\n]*)',
  '(?<key>^[ \\t]*-?[ \\t]*(?:"[^"]*"|\'[^\']*\'|[\\w.$-]+)(?=\\s*:(?:\\s|$)))',
  '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:[^\']|\'\')*\')',
  '(?<number>(?<=[:\\s-])[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',
  '(?<bool>\\b(?:true|false|yes|no|on|off)\\b)',
  '(?<nul>\\b(?:null|~)\\b)',
  '(?<punct>^\\s*-|[:{}\\[\\],]|^---$)',
].join('|'), 'gm');

/** Linguagens de chaves compartilham a mesma gramática, mudando as palavras-chave. */
function buildCurlyGrammar(language) {
  const words = KEYWORDS[language].split(/\s+/).join('|');
  return new RegExp([
    '(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)',
    // Tags do Go ficam entre crases; template strings do TS também.
    '(?<tag>`[^`]*`)',
    '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')',
    '(?<annotation>[@\\[]{1}[A-Za-z_$][\\w$.]*(?:\\([^)]*\\))?\\]?)',
    `(?<keyword>\\b(?:${words})\\b)`,
    '(?<type>\\b[A-Z][A-Za-z0-9_$]*\\b)',
    '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?[LlDdFf]?\\b)',
    '(?<punct>[{}()\\[\\];,<>])',
  ].join('|'), 'g');
}

const GRAMMARS = {
  json: JSON_TOKENS,
  yaml: YAML_TOKENS,
  java: buildCurlyGrammar('java'),
  csharp: buildCurlyGrammar('csharp'),
  typescript: buildCurlyGrammar('typescript'),
  dart: buildCurlyGrammar('dart'),
  swift: buildCurlyGrammar('swift'),
  go: buildCurlyGrammar('go'),
};

/**
 * @param {string} text
 * @param {string} language identificador do formato ('json', 'java', 'plain'…)
 * @returns {DocumentFragment}
 */
export function highlight(text, language) {
  const fragment = document.createDocumentFragment();
  if (!text) return fragment;

  const pattern = GRAMMARS[language];
  if (!pattern || text.length > MAX_HIGHLIGHT_LENGTH) {
    fragment.append(document.createTextNode(text));
    return fragment;
  }

  pattern.lastIndex = 0;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    const groups = match.groups || {};
    const name = Object.keys(groups).find((key) => groups[key] !== undefined);
    const span = document.createElement('span');
    span.className = TOKEN_CLASSES[name] || '';
    span.textContent = match[0];
    fragment.append(span);

    cursor = match.index + match[0].length;
    // Padrões ancorados (^) podem casar vazio; garante progresso.
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }

  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}
