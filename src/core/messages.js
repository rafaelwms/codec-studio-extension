/**
 * Mensagens localizáveis do núcleo de conversão.
 *
 * O core não conhece a interface: ele apenas pede um texto por código. Por padrão
 * responde em inglês (catálogo importado estaticamente, sem fetch — o que também
 * satisfaz a CSP `connect-src 'none'` da extensão); a interface instala outro
 * catálogo quando o usuário escolhe português.
 */

import en from '../locales/en.js';

let catalogue = en;

/** Troca o catálogo ativo. A interface chama isto ao mudar de idioma. */
export function setCatalogue(next) {
  catalogue = next && typeof next === 'object' ? next : en;
}

export function getCatalogue() {
  return catalogue;
}

/**
 * Resolve um código de mensagem, interpolando {placeholders}.
 * Se o código não existir no catálogo ativo, cai no inglês; se nem lá existir,
 * devolve o próprio código — assim uma chave esquecida aparece de forma óbvia
 * em vez de virar texto vazio.
 *
 * @param {string} code
 * @param {Record<string, string|number>} [params]
 */
export function msg(code, params) {
  const template = catalogue[code] ?? en[code] ?? code;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    (key in params ? String(params[key]) : match));
}
