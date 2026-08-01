/**
 * Gera os assets de imagem exigidos pela Chrome Web Store, em press/.
 *
 *   1. suba o servidor local:  npm run serve
 *   2. rode:                   node scripts/make-store-assets.mjs
 *
 * Usa o Chrome instalado em modo headless para capturar a própria interface —
 * as capturas mostram o app real, não uma maquete.
 *
 * Saída:
 *   press/en/screenshot-1..5.png     1280×800  (listagem em inglês)
 *   press/pt-BR/screenshot-1..5.png  1280×800  (listagem em português)
 *   press/tile-small.png              440×280  (obrigatório; serve aos dois idiomas)
 *   press/tile-marquee.png           1400×560  (opcional, usado em destaques)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'press');
const BASE = process.env.CODEC_PREVIEW_URL || 'http://localhost:4173';

const browser = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => existsSync(path));

if (!browser) {
  console.error('Nenhum navegador Chromium encontrado.');
  process.exit(1);
}

const TEXTS = {
  en: {
    invalidJson: `{
  "id": 1024,
  "customer": "Jane Souza",
  "email": "jane@example.com",
  "created_at": "2026-07-30T10:15:30Z",
  "tags": ["premium", "beta",],
  "address": {
    "city": "San Francisco",
    "state": "CA"
  },
  "active": true
}`,
    base64:
      'Codec Studio encodes Base64 without anything leaving your browser. 🔒\n\n' +
      'Real UTF-8: accents (ação), ç, emoji 🎉 and 日本語 survive the round trip — ' +
      'no mojibake like btoa() produces.\n\n' +
      'Standard or URL-safe alphabet, optional padding and MIME line wrapping at 76 columns.\n' +
      'Pasted something binary? The output becomes a readable hex dump with an ASCII column.',
  },
  'pt-BR': {
    invalidJson: `{
  "id": 1024,
  "cliente": "Ana Souza",
  "email": "ana@exemplo.com",
  "criado_em": "2026-07-30T10:15:30Z",
  "tags": ["premium", "beta",],
  "endereco": {
    "cidade": "São Paulo",
    "uf": "SP"
  },
  "ativo": true
}`,
    base64:
      'Codec Studio converte Base64 sem sair do seu navegador. 🔒\n\n' +
      'UTF-8 de verdade: acentuação, ç, emoji 🎉 e 日本語 sobrevivem à ida e à volta — ' +
      'nada de texto corrompido como acontece com btoa().\n\n' +
      'Alfabeto padrão ou URL-safe, padding opcional e quebra de linha em 76 colunas (MIME).\n' +
      'Colou algo binário? A saída vira um dump hexadecimal legível, com coluna ASCII.',
  },
};

const LANGUAGES = Object.keys(TEXTS);

/** Os cinco cenários da listagem, montados para um idioma. */
const shotsFor = (lang) => [
  {
    file: 'screenshot-1.png',
    size: [1280, 800],
    query: { tool: 'json-java', direction: 'json-to-java', style: 'record', theme: 'dark' },
  },
  {
    file: 'screenshot-2.png',
    size: [1280, 800],
    query: { tool: 'json-java', direction: 'java-to-json', theme: 'dark' },
  },
  {
    file: 'screenshot-3.png',
    size: [1280, 800],
    query: { tool: 'base64', direction: 'encode', theme: 'dark', wrap: 'true', text: TEXTS[lang].base64 },
  },
  {
    file: 'screenshot-4.png',
    size: [1280, 800],
    query: { tool: 'json-java', direction: 'json-to-java', style: 'pojo', theme: 'light' },
  },
  {
    file: 'screenshot-5.png',
    size: [1280, 800],
    query: { tool: 'json-java', direction: 'json-to-java', theme: 'dark', text: TEXTS[lang].invalidJson },
  },
];

// Cada idioma ganha o seu conjunto: a Chrome Web Store aceita capturas por locale.
const shots = [
  ...LANGUAGES.flatMap((lang) =>
    shotsFor(lang).map((shot) => ({
      ...shot,
      file: `${lang}/${shot.file}`,
      query: { ...shot.query, lang },
    }))),
  { file: 'tile-small.png', size: [440, 280], page: 'tile.html', query: { format: 'small' } },
  { file: 'tile-marquee.png', size: [1400, 560], page: 'tile.html', query: { format: 'marquee' } },
];

mkdirSync(outDir, { recursive: true });

// press/demo.html é derivado do app.html a cada execução, para as capturas nunca
// mostrarem uma interface defasada em relação ao que é publicado.
writeFileSync(
  join(outDir, 'demo.html'),
  readFileSync(join(root, 'app.html'), 'utf8')
    .replace('href="styles/', 'href="../styles/')
    .replace('href="icons/', 'href="../icons/')
    .replace('<title>Codec Studio</title>', '<title>Codec Studio — captura</title>')
    .replace(
      '<script type="module" src="src/ui/main.js"></script>',
      '<script type="module" src="./demo-setup.js"></script>\n' +
        '  <script type="module" src="../src/ui/main.js"></script>',
    ),
);

const profileRoot = join(tmpdir(), `codec-shots-${Date.now()}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera o PNG aparecer e parar de crescer — o Chrome escreve o arquivo bem antes de sair. */
async function waitForStableFile(path, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    await sleep(250);
    if (!existsSync(path)) continue;
    const { size } = statSync(path);
    if (size > 0 && size === lastSize) return true;
    lastSize = size;
  }
  return false;
}

/**
 * O headless grava a captura rapidamente, mas o processo costuma ficar pendurado
 * depois disso. Em vez de esperar o encerramento, aguardamos o arquivo e matamos
 * o processo — e rodamos todas as capturas em paralelo.
 */
async function capture(shot, index) {
  const params = new URLSearchParams(shot.query).toString();
  const url = `${BASE}/press/${shot.page || 'demo.html'}?${params}`;
  const target = join(outDir, shot.file);
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });

  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${shot.size[0]},${shot.size[1]}`,
      `--screenshot=${target}`,
      // Um perfil por captura: um diretório compartilhado deixa lock para trás.
      `--user-data-dir=${join(profileRoot, `p${index}`)}`,
      url,
    ],
    { stdio: 'ignore' },
  );

  const ok = await waitForStableFile(target);
  child.kill('SIGKILL');

  if (!ok) throw new Error(`Falha ao capturar ${shot.file}`);
  console.log(`press/${shot.file}  ${shot.size[0]}×${shot.size[1]}`);
}

await Promise.all(shots.map(capture));

rmSync(profileRoot, { recursive: true, force: true });
console.log('\nAssets prontos em press/. Confira antes de subir para a loja.');
