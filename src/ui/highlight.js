/**
 * Realce de sintaxe por construção de nós DOM.
 *
 * Segurança: nunca usamos innerHTML/insertAdjacentHTML. Cada token vira um
 * `<span>` cujo conteúdo é definido via textContent, de modo que qualquer texto
 * do usuário — inclusive algo como `<img onerror=…>` — é sempre inerte.
 */

const MAX_HIGHLIGHT_LENGTH = 160_000; // acima disso, texto puro (mantém a UI fluida)

const JSON_TOKENS = new RegExp(
  [
    '(?<key>"(?:\\\\.|[^"\\\\])*")(?=\\s*:)',
    '(?<string>"(?:\\\\.|[^"\\\\])*")',
    '(?<number>-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)',
    '(?<bool>\\b(?:true|false)\\b)',
    '(?<nul>\\bnull\\b)',
    '(?<punct>[{}\\[\\],:])',
  ].join('|'),
  'g',
);

const JAVA_KEYWORDS = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'record', 'return', 'sealed', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
  'try', 'var', 'void', 'volatile', 'while', 'true', 'false', 'null',
];

const JAVA_TOKENS = new RegExp(
  [
    '(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)',
    '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')',
    '(?<annotation>@[A-Za-z_$][\\w$.]*)',
    `(?<keyword>\\b(?:${JAVA_KEYWORDS.join('|')})\\b)`,
    '(?<type>\\b[A-Z][A-Za-z0-9_$]*\\b)',
    '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?[LlDdFf]?\\b)',
    '(?<punct>[{}()\\[\\];,<>])',
  ].join('|'),
  'g',
);

const CLASS_BY_GROUP = {
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
};

/**
 * @param {string} text
 * @param {'json'|'java'|'plain'} language
 * @returns {DocumentFragment}
 */
export function highlight(text, language) {
  const fragment = document.createDocumentFragment();

  if (!text) return fragment;
  if (language === 'plain' || text.length > MAX_HIGHLIGHT_LENGTH) {
    fragment.append(document.createTextNode(text));
    return fragment;
  }

  const pattern = language === 'json' ? JSON_TOKENS : JAVA_TOKENS;
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
    span.className = CLASS_BY_GROUP[name] || '';
    span.textContent = match[0];
    fragment.append(span);

    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}
