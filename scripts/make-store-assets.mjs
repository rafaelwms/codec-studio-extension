/**
 * Gera os assets de imagem exigidos pela Chrome Web Store, em press/.
 *
 *   1. suba o servidor local:  npm run serve
 *   2. rode:                   node scripts/make-store-assets.mjs
 *
 * Usa o Chrome instalado em modo headless, pelo DevTools Protocol, para capturar a
 * própria interface — as capturas mostram o app real, não uma maquete.
 *
 * Saída:
 *   press/en/screenshot-1..5.png     1280×800  (listagem em inglês)
 *   press/pt-BR/screenshot-1..5.png  1280×800  (listagem em português)
 *   press/tile-small.png              440×280  (obrigatório; serve aos dois idiomas)
 *   press/tile-marquee.png           1400×560  (opcional, usado em destaques)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  },
};

const LANGUAGES = Object.keys(TEXTS);

/** Os cinco cenários da listagem, montados para um idioma. */
const shotsFor = (lang) => [
  {
    file: 'screenshot-1.png',
    size: [1280, 800],
    query: { from: 'json', to: 'java', style: 'record', theme: 'dark' },
  },
  {
    file: 'screenshot-2.png',
    size: [1280, 800],
    query: { from: 'base64', to: 'file', theme: 'dark' },
  },
  {
    file: 'screenshot-3.png',
    size: [1280, 800],
    query: { from: 'file', to: 'base64', theme: 'dark', file: '../icons/icon128.png', fileName: 'logo.png' },
  },
  {
    file: 'screenshot-4.png',
    size: [1280, 800],
    query: { from: 'java', to: 'typescript', theme: 'light' },
  },
  {
    file: 'screenshot-5.png',
    size: [1280, 800],
    query: { from: 'json', to: 'java', theme: 'dark', text: TEXTS[lang].invalidJson },
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
    .replace('src="icons/', 'src="../icons/')
    .replace('<title>Codec Studio</title>', '<title>Codec Studio — captura</title>')
    .replace(
      '<script type="module" src="src/ui/main.js"></script>',
      '<script type="module" src="./demo-setup.js"></script>\n' +
        '  <script type="module" src="../src/ui/main.js"></script>',
    ),
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForEndpoint(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome ainda subindo: tenta de novo.
    }
    await sleep(150);
  }
  throw new Error('Chrome não abriu a porta de debug a tempo.');
}

/** Cliente mínimo do DevTools Protocol, sobre o WebSocket nativo do Node. */
function createClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', () => done());
    socket.addEventListener('error', fail);
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      return new Promise((done) => {
        pending.set(id, done);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

/** A captura só sai quando a página diz que terminou: carregar um arquivo é assíncrono. */
async function capture(client, shot) {
  const page = shot.page || 'demo.html';
  const url = `${BASE}/press/${page}?${new URLSearchParams(shot.query)}`;
  const target = join(outDir, shot.file);
  mkdirSync(dirname(target), { recursive: true });

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: shot.size[0], height: shot.size[1], deviceScaleFactor: 1, mobile: false,
  });
  await client.send('Page.navigate', { url });
  await sleep(200);

  const expression = shot.page ? 'document.readyState === "complete"' : 'window.__demoReady === true';
  const deadline = Date.now() + 20_000;
  for (;;) {
    const result = await client.send('Runtime.evaluate', { expression });
    if (result.result?.value === true) break;
    if (Date.now() > deadline) throw new Error(`Falha ao capturar ${shot.file}`);
    await sleep(100);
  }
  await sleep(300); // primeira pintura com a fonte e a imagem já aplicadas

  const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(target, Buffer.from(data, 'base64'));
  console.log(`press/${shot.file}  ${shot.size[0]}×${shot.size[1]}`);
}

const profile = join(tmpdir(), `codec-shots-${Date.now()}`);
const port = 9222 + Math.floor(Math.random() * 100); // evita colidir com outra instância
const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-component-update',
  '--disable-background-networking',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
], { stdio: 'ignore' });

try {
  await waitForEndpoint(port);
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const client = createClient(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await client.send('Page.enable');
  for (const shot of shots) await capture(client, shot);
  client.close();
} finally {
  child.kill('SIGKILL');
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}

console.log('\nAssets prontos em press/. Confira antes de subir para a loja.');
