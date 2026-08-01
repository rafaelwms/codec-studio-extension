/**
 * Preparo de cenário para as capturas da loja (não faz parte da extensão).
 *
 * Roda ANTES do main.js — módulos executam na ordem em que aparecem no HTML — então
 * grava as preferências que o app vai ler no boot. O restante acontece no
 * DOMContentLoaded: como main.js também é um módulo, ele já inicializou nesse ponto,
 * e o headless só captura depois do evento `load`. Tudo síncrono, sem timers, para a
 * captura nunca pegar a interface a meio caminho.
 *
 * Parâmetros: ?tool=&theme=&direction=&style=&values=&sample=no&text=
 */

const params = new URLSearchParams(location.search);
const tool = params.get('tool') || 'base64';

const prefs = { theme: params.get('theme') || 'dark', tool };
if (params.get('lang')) prefs.language = params.get('lang');
const toolPrefs = {};
for (const key of ['direction', 'style', 'values', 'alphabet']) {
  const value = params.get(key);
  if (value) toolPrefs[key] = value;
}
for (const key of ['padding', 'wrap', 'strict', 'jackson', 'primitives', 'dateTypes', 'separateFiles']) {
  const value = params.get(key);
  if (value !== null) toolPrefs[key] = value === 'true';
}
if (Object.keys(toolPrefs).length) prefs[tool] = toolPrefs;

localStorage.setItem('codec-studio:prefs:v1', JSON.stringify(prefs));

// Congela animações: sem isso a captura pode pegar a aurora ou a revelação do
// resultado a meio quadro (e o relógio virtual do headless nunca fica ocioso).
const freeze = document.createElement('style');
freeze.textContent = `
  *, *::before, *::after { animation: none !important; transition: none !important; }
  /* Só a máscara de revelação do resultado sai; as demais (grade de fundo, fade da
     barra de opções) fazem parte do visual e devem aparecer na captura. */
  .editor--output { mask-image: none !important; }
`;

document.addEventListener('DOMContentLoaded', () => {
  const text = params.get('text');

  if (text !== null) {
    document.querySelector('#input').value = text;
    document.querySelector('[data-action="convert"]').click(); // converte de forma síncrona
  } else if (params.get('sample') !== 'no') {
    document.querySelector('[data-action="sample"]').click();
  }

  document.head.append(freeze);
  document.querySelector('#output').classList.remove('is-revealing');
  document.querySelector('#output-panel').classList.remove('is-converting');
  document.activeElement?.blur(); // o cursor piscando apareceria na captura

  // O headless usa relógio virtual e mede 0,00 ms: melhor vazio do que um número irreal.
  document.querySelector('#timing').textContent = '';
});
