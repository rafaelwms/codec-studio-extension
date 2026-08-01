/**
 * Idiomas da interface.
 *
 * Os catálogos são importados como módulos ES — e não lidos de `_locales/` via fetch —
 * por duas razões: a CSP da extensão declara `connect-src 'none'`, e assim a mesma
 * interface funciona fora do contexto de extensão (servidor local, capturas, testes).
 *
 * `_locales/` continua existindo, mas só para o que a Chrome Web Store lê do manifesto
 * (nome e descrição da extensão).
 */

import { msg, setCatalogue } from '../core/messages.js';
import en from '../locales/en.js';
import ptBR from '../locales/pt-BR.js';

const CATALOGUES = { en, 'pt-BR': ptBR };

/** Ordem usada pelo botão que alterna o idioma. */
export const LANGUAGES = ['en', 'pt-BR'];

let current = 'en';

/** Idioma do navegador, com queda para inglês. */
export function detectLanguage() {
  const tags = [];
  const uiLanguage = globalThis.chrome?.i18n?.getUILanguage?.();
  if (uiLanguage) tags.push(uiLanguage);
  if (navigator.languages?.length) tags.push(...navigator.languages);
  else if (navigator.language) tags.push(navigator.language);

  for (const tag of tags) {
    if (/^pt\b/i.test(tag)) return 'pt-BR';
    if (/^en\b/i.test(tag)) return 'en';
  }
  return 'en';
}

/** Instala um idioma na interface e no núcleo de conversão. */
export function setLanguage(language) {
  current = CATALOGUES[language] ? language : 'en';
  setCatalogue(CATALOGUES[current]);
  document.documentElement.lang = current;
  return current;
}

export function getLanguage() {
  return current;
}

/** Tradução de uma chave (mesmo mecanismo usado pelo núcleo). */
export const t = msg;

/* ------------------------------------------------------------------ formatos */

let numberFormat = new Intl.NumberFormat('en');
let msFormat = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function refreshFormats() {
  numberFormat = new Intl.NumberFormat(current);
  msFormat = new Intl.NumberFormat(current, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatNumber(value) {
  return numberFormat.format(value);
}

export function formatMs(value) {
  return t('ui.metrics.ms', { value: msFormat.format(value) });
}

/** "3 caracteres" / "1 character" — escolhe singular ou plural pela contagem. */
export function plural(count, unit) {
  return `${formatNumber(count)} ${t(`ui.unit.${unit}.${count === 1 ? 'one' : 'other'}`)}`;
}

/* ---------------------------------------------------------------- hidratação */

const ATTRIBUTE_BINDINGS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
];

/**
 * Preenche o HTML estático com o idioma ativo. Roda no boot e a cada troca de idioma.
 * Usa textContent/setAttribute — nunca innerHTML.
 */
export function applyTranslations(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const [attribute, target] of ATTRIBUTE_BINDINGS) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      element.setAttribute(target, t(element.getAttribute(attribute)));
    }
  }
}
