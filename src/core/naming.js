/** Utilitários de nomenclatura para gerar identificadores Java válidos. */

export const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null', 'record', 'var', 'yield', 'sealed', 'permits',
]);

/** Quebra uma chave arbitrária em palavras: "user_name", "user-name", "userName" → ["user","name"]. */
export function splitWords(input) {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** "user_name" → "userName" */
export function toCamelCase(input) {
  const words = splitWords(input);
  if (words.length === 0) return '';
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('');
}

/** "user_name" → "UserName" */
export function toPascalCase(input) {
  const camel = toCamelCase(input);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** "USER_NAME" a partir de "userName" (constantes de enum). */
export function toScreamingSnakeCase(input) {
  return splitWords(input).map((word) => word.toUpperCase()).join('_') || 'VALUE';
}

/** Nome de campo Java seguro (nunca vazio, nunca palavra reservada, nunca inicia com dígito). */
export function toFieldName(key) {
  let name = toCamelCase(key);
  if (!name) name = 'value';
  if (/^[0-9]/.test(name)) name = `_${name}`;
  if (JAVA_KEYWORDS.has(name)) name = `${name}Value`;
  return name;
}

/** Nome de classe Java seguro. */
export function toClassName(key) {
  let name = toPascalCase(key);
  if (!name) name = 'Root';
  if (/^[0-9]/.test(name)) name = `_${name}`;
  if (JAVA_KEYWORDS.has(name.toLowerCase()) && JAVA_KEYWORDS.has(name)) name = `${name}Type`;
  return name;
}

/** Singulariza nomes de coleção para nomear a classe do elemento: "items" → "Item". */
export function singularize(word) {
  const value = String(word);
  if (/[^s]ss$|us$|is$|ss$/i.test(value)) return value;
  if (/ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/(ch|sh|x|z|s)es$/i.test(value)) return value.slice(0, -2);
  if (/[^s]s$/i.test(value)) return value.slice(0, -1);
  return value;
}

/** Escapa uma string para um literal Java/JSON entre aspas duplas. */
export function quote(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}
