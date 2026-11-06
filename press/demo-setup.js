/**
 * Preparo de cenário para as capturas da loja (não faz parte da extensão).
 *
 * Roda ANTES do main.js — módulos executam na ordem em que aparecem no HTML — então
 * grava as preferências que o app vai ler no boot. O restante acontece no
 * DOMContentLoaded: como main.js também é um módulo, ele já inicializou nesse ponto.
 * Carregar um arquivo é assíncrono, então a página avisa em `window.__demoReady`
 * quando pode ser capturada.
 *
 * Parâmetros: ?from=&to=&theme=&lang=&style=&text=&file=&fileName=
 */

const params = new URLSearchParams(location.search);
const to = params.get('to') || 'java';

const prefs = {
  theme: params.get('theme') || 'dark',
  language: params.get('lang') || 'en',
  from: params.get('from') || 'json',
  to,
  options: params.get('style') ? { [to]: { style: params.get('style') } } : {},
};
localStorage.setItem('codec-studio:prefs:v1', JSON.stringify(prefs));

// Congela animações: sem isso a captura pode pegar a aurora ou a revelação do
// resultado a meio quadro.
const freeze = document.createElement('style');
freeze.textContent = `
  *, *::before, *::after { animation: none !important; transition: none !important; }
  /* Só a máscara de revelação do resultado sai; o resto faz parte do visual. */
  .editor--output { mask-image: none !important; }
  .toast { display: none !important; }
`;

const nextFrame = () => new Promise((done) => setTimeout(done, 50));

async function loadDemoFile(path, name) {
  const blob = await (await fetch(path)).blob();
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], name, { type: blob.type }));
  const input = document.querySelector('#file-input');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change'));
  while (!document.querySelector('#output').textContent) await nextFrame();
}

document.addEventListener('DOMContentLoaded', async () => {
  document.head.append(freeze);

  const text = params.get('text');
  if (params.get('file')) {
    await loadDemoFile(params.get('file'), params.get('fileName') || 'file');
  } else if (text !== null) {
    document.querySelector('#input').value = text;
    document.querySelector('[data-action="convert"]').click(); // converte de forma síncrona
  } else {
    document.querySelector('[data-action="sample"]').click();
  }

  await Promise.all([...document.images].filter((image) => !image.hidden).map((image) => image.decode().catch(() => {})));

  document.querySelector('#output').classList.remove('is-revealing');
  document.querySelector('#output-panel').classList.remove('is-converting');
  document.activeElement?.blur(); // o cursor piscando apareceria na captura

  // A medição seria de uma execução de demonstração: melhor vazio do que um número sem sentido.
  document.querySelector('#timing').textContent = '';
  window.__demoReady = true;
});
