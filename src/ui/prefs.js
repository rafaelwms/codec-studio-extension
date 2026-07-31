/**
 * Preferências locais.
 *
 * Guardamos apenas *configurações* (tema, ferramenta ativa, opções de conversão).
 * O conteúdo digitado nunca é persistido — nem em disco, nem em memória entre
 * sessões. Usamos localStorage (disponível em páginas de extensão) em vez de
 * chrome.storage justamente para não precisar da permissão "storage".
 */

const KEY = 'codec-studio:prefs:v1';

const FALLBACK = new Map(); // usado se o localStorage estiver bloqueado

function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return FALLBACK.get(KEY) || null;
  }
}

function writeStore(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    FALLBACK.set(KEY, value);
  }
}

/** Mescla os padrões com o que estiver salvo (ignorando chaves desconhecidas). */
export function loadPrefs(defaults) {
  const saved = readStore();
  if (!saved || typeof saved !== 'object') return structuredClone(defaults);

  const merged = structuredClone(defaults);
  for (const [key, value] of Object.entries(saved)) {
    if (!(key in merged)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof merged[key] === 'object') {
      Object.assign(merged[key], filterKnown(merged[key], value));
    } else if (typeof value === typeof merged[key]) {
      merged[key] = value;
    }
  }
  return merged;
}

function filterKnown(reference, incoming) {
  const result = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key in reference && typeof value === typeof reference[key]) result[key] = value;
  }
  return result;
}

export function savePrefs(prefs) {
  writeStore(prefs);
}
