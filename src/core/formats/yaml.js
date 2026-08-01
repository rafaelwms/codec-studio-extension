/**
 * Formato YAML — parser e serializador próprios, sem dependências.
 *
 * Cobre o subconjunto que aparece em documentos reais de configuração:
 * mapeamentos por indentação, sequências, escalares tipados, aspas simples e
 * duplas, comentários, múltiplos documentos e blocos literais (`|`) e dobrados
 * (`>`), além de coleções em fluxo (`{a: 1}`, `[1, 2]`).
 *
 * Fora do escopo, de propósito: âncoras (`&`/`*`), tags (`!!`) e merge keys
 * (`<<`). São recursos raros em payloads e exigiriam um grafo de referências —
 * quando aparecem, o parser avisa em vez de adivinhar.
 */

import { CodecError } from '../base64.js';
import { msg } from '../messages.js';
import { inferIR, sampleData } from '../data-model.js';

export const id = 'yaml';
export const label = 'YAML';
export const kind = 'data';
export const highlight = 'yaml';
export const extension = 'yaml';

/* ------------------------------------------------------------------ leitura */

/** Uma linha significativa: indentação + conteúdo, sem comentário. */
function tokenizeLines(text) {
  const lines = [];
  const raw = text.replace(/\r\n?/g, '\n').split('\n');

  raw.forEach((line, number) => {
    const withoutComment = stripComment(line);
    if (!withoutComment.trim()) return;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    lines.push({ indent, content: withoutComment.trim(), number: number + 1, raw: line });
  });

  return lines;
}

/** Remove `# comentário`, respeitando `#` dentro de aspas. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    // "#" só inicia comentário quando precedido de espaço (ou início da linha).
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * @param {string} text
 * @returns {any} primeiro documento do YAML
 */
export function parseYaml(text) {
  if (!text.trim()) {
    throw new CodecError('core.yaml.empty', { hintCode: 'core.yaml.empty.hint' });
  }

  const unsupported = /^\s*[^#]*?(?:^|\s)(?:<<:|[&*][A-Za-z_])/m.exec(text);
  if (unsupported) {
    throw new CodecError('core.yaml.unsupported', { hintCode: 'core.yaml.unsupported.hint' });
  }

  const lines = tokenizeLines(text);
  if (lines.length === 0) {
    throw new CodecError('core.yaml.empty', { hintCode: 'core.yaml.empty.hint' });
  }

  // Vários documentos: convertemos o primeiro e avisamos na camada acima.
  let start = 0;
  if (lines[0].content === '---') start = 1;
  const end = lines.findIndex((line, index) => index > start && (line.content === '---' || line.content === '...'));
  const slice = lines.slice(start, end === -1 ? lines.length : end);

  if (slice.length === 0) {
    throw new CodecError('core.yaml.empty', { hintCode: 'core.yaml.empty.hint' });
  }

  const state = { lines: slice, index: 0 };
  const value = parseBlock(state, slice[0].indent);

  if (state.index < slice.length) {
    const line = slice[state.index];
    throw new CodecError('core.yaml.badIndent', {
      params: { line: line.number },
      hintCode: 'core.yaml.badIndent.hint',
    });
  }
  return value;
}

/** Lê um bloco (mapa ou sequência) no nível de indentação informado. */
function parseBlock(state, indent) {
  const line = state.lines[state.index];
  if (!line) return null;
  return line.content.startsWith('- ') || line.content === '-'
    ? parseSequence(state, indent)
    : parseMapping(state, indent);
}

function parseSequence(state, indent) {
  const items = [];

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new CodecError('core.yaml.badIndent', {
        params: { line: line.number },
        hintCode: 'core.yaml.badIndent.hint',
      });
    }
    if (!line.content.startsWith('-')) break;

    const inline = line.content.slice(1).trim();
    state.index += 1;

    if (!inline) {
      // "-" sozinho: o valor está no bloco indentado abaixo.
      items.push(parseNested(state, indent, null));
      continue;
    }

    // "- chave: valor" abre um mapa cuja indentação começa depois do traço.
    if (isMappingEntry(inline)) {
      const childIndent = line.indent + (line.content.length - line.content.slice(1).trimStart().length);
      state.lines.splice(state.index, 0, {
        indent: childIndent,
        content: inline,
        number: line.number,
        raw: line.raw,
      });
      items.push(parseMapping(state, childIndent));
      continue;
    }

    const blockScalar = readBlockScalar(state, inline, line.indent);
    items.push(blockScalar !== undefined ? blockScalar : parseScalar(inline));
  }

  return items;
}

function parseMapping(state, indent) {
  const result = {};

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new CodecError('core.yaml.badIndent', {
        params: { line: line.number },
        hintCode: 'core.yaml.badIndent.hint',
      });
    }
    if (line.content.startsWith('- ')) break;

    const separator = findKeySeparator(line.content);
    if (separator === -1) {
      throw new CodecError('core.yaml.expectedKey', {
        params: { line: line.number },
        hintCode: 'core.yaml.expectedKey.hint',
      });
    }

    const key = parseKey(line.content.slice(0, separator));
    const rest = line.content.slice(separator + 1).trim();
    state.index += 1;

    if (!rest) {
      result[key] = parseNested(state, indent, {});
      continue;
    }

    const blockScalar = readBlockScalar(state, rest, indent);
    result[key] = blockScalar !== undefined ? blockScalar : parseScalar(rest);
  }

  return result;
}

/** Lê o bloco indentado que pertence à linha anterior. */
function parseNested(state, indent, fallback) {
  const next = state.lines[state.index];
  if (!next || next.indent <= indent) return fallback;
  return parseBlock(state, next.indent);
}

/** `|` e `>` — texto literal ou dobrado nas linhas indentadas seguintes. */
function readBlockScalar(state, marker, indent) {
  const match = /^([|>])([+-]?)(\d*)$/.exec(marker.trim());
  if (!match) return undefined;

  const [, style, chomping] = match;
  const parts = [];
  while (state.index < state.lines.length && state.lines[state.index].indent > indent) {
    parts.push(state.lines[state.index].content);
    state.index += 1;
  }

  const text = style === '|' ? parts.join('\n') : parts.join(' ');
  return chomping === '-' ? text : `${text}\n`.replace(/\n+$/, chomping === '+' ? '\n' : '\n');
}

/** Índice dos dois-pontos que separam chave e valor (ignora `:` dentro de aspas). */
function findKeySeparator(content) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (quote) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ':' && depth === 0 && (i + 1 === content.length || /\s/.test(content[i + 1]))) {
      return i;
    }
  }
  return -1;
}

function isMappingEntry(content) {
  return findKeySeparator(content) !== -1;
}

function parseKey(raw) {
  const key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return unquote(key);
  }
  return key;
}

function unquote(text) {
  const body = text.slice(1, -1);
  return text[0] === '"'
    ? body.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : body.replace(/''/g, "'");
}

/** Converte um escalar YAML no valor JavaScript equivalente. */
export function parseScalar(raw) {
  const text = raw.trim();
  if (!text) return null;

  if ((text.startsWith('"') && text.endsWith('"') && text.length > 1) ||
      (text.startsWith("'") && text.endsWith("'") && text.length > 1)) {
    return unquote(text);
  }

  if (text.startsWith('{') || text.startsWith('[')) return parseFlow(text);

  if (text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(text)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(text)) return false;

  if (/^[+-]?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(text)) return Number.parseFloat(text);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text, 16);

  return text;
}

/** Coleções em fluxo: `{a: 1, b: 2}` e `[1, 2]`. */
function parseFlow(text) {
  const inner = text.slice(1, -1).trim();
  const isArray = text.startsWith('[');
  if (!inner) return isArray ? [] : {};

  const parts = splitFlow(inner);
  if (isArray) return parts.map((part) => parseScalar(part));

  const result = {};
  for (const part of parts) {
    const separator = findKeySeparator(part);
    if (separator === -1) continue;
    result[parseKey(part.slice(0, separator))] = parseScalar(part.slice(separator + 1));
  }
  return result;
}

function splitFlow(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === '\\' && quote === '"') {
        current += text[i + 1] ?? '';
        i += 1;
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/* ------------------------------------------------------------------ escrita */

const NEEDS_QUOTES = /^$|^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|:\s|\s#|^(true|false|null|yes|no|on|off|~)$/i;

/** Um escalar precisa de aspas para não ser reinterpretado na leitura? */
function quoteIfNeeded(value) {
  if (NEEDS_QUOTES.test(value) || /^[+-]?[\d.]+([eE][+-]?\d+)?$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function writeScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';

  const text = String(value);
  if (text.includes('\n')) {
    // Texto multilinha sai como bloco literal, que é o idiomático em YAML.
    const body = text.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n');
    return `|\n${body}`;
  }
  return quoteIfNeeded(text);
}

/**
 * Serializa um valor JavaScript em YAML.
 * @param {any} value
 * @param {{indent?: number}} [options]
 */
export function stringifyYaml(value, options = {}) {
  const step = options.indent ?? 2;
  return `${write(value, 0, step)}\n`.replace(/\n+$/, '\n');
}

function write(value, level, step) {
  const pad = ' '.repeat(level * step);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (isContainer(item) && !isEmptyContainer(item)) {
          const body = write(item, level + 1, step);
          // O primeiro nó do item sobe para a linha do traço.
          return `${pad}-${body.slice(pad.length + step - 1)}`;
        }
        return `${pad}- ${isContainer(item) ? (Array.isArray(item) ? '[]' : '{}') : writeScalar(item)}`;
      })
      .join('\n');
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, item]) => {
        const name = quoteIfNeeded(String(key));
        if (isContainer(item) && !isEmptyContainer(item)) {
          return `${pad}${name}:\n${write(item, level + 1, step)}`;
        }
        if (isContainer(item)) return `${pad}${name}: ${Array.isArray(item) ? '[]' : '{}'}`;
        const scalar = writeScalar(item);
        return scalar.startsWith('|')
          ? `${pad}${name}: ${scalar.replace(/\n {2}/g, `\n${pad}${' '.repeat(step)}`)}`
          : `${pad}${name}: ${scalar}`;
      })
      .join('\n');
  }

  return `${pad}${writeScalar(value)}`;
}

const isContainer = (value) => value !== null && typeof value === 'object';
const isEmptyContainer = (value) =>
  isContainer(value) && (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);

/* ------------------------------------------------------------- interface do formato */

export function parse(text, options = {}) {
  return inferIR(parseYaml(text), options);
}

/** Leitura crua, preservando os valores (usada de dados para dados). */
export function parseData(text) {
  return parseYaml(text);
}

/** Escrita crua dos valores recebidos. */
export function emitData(value, options = {}) {
  return stringifyYaml(value, options);
}

export function emit(ir, options = {}) {
  const { value, warnings } = sampleData(ir, options);
  return { output: stringifyYaml(value, options), warnings: [...ir.warnings, ...warnings] };
}
