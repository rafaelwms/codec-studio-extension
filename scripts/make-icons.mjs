/**
 * Rasteriza icons/icon.svg nos tamanhos exigidos pelo manifesto.
 *
 *   node scripts/make-icons.mjs
 *
 * Usa o Chrome/Edge já instalado em modo headless — o SVG é a fonte da verdade,
 * então basta editá-lo e rodar de novo. Não há download nem dependência de npm.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const browser = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => existsSync(path));

if (!browser) {
  console.error('Nenhum navegador Chromium encontrado para rasterizar o ícone.');
  process.exit(1);
}

const svg = readFileSync(join(root, 'icons', 'icon.svg'), 'utf8');
const workDir = join(tmpdir(), `codec-icons-${Date.now()}`);
mkdirSync(workDir, { recursive: true });
mkdirSync(join(root, 'icons'), { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** O headless grava o PNG bem antes de encerrar; esperamos o arquivo estabilizar. */
async function waitForStableFile(path, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    await sleep(200);
    if (!existsSync(path)) continue;
    const { size } = statSync(path);
    if (size > 0 && size === lastSize) return true;
    lastSize = size;
  }
  return false;
}

async function render(size, index) {
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;}
    svg{display:block;width:${size}px;height:${size}px;}
  </style></head><body>${svg}</body></html>`;

  const pagePath = join(workDir, `icon-${size}.html`);
  writeFileSync(pagePath, page);

  const target = join(root, 'icons', `icon${size}.png`);
  rmSync(target, { force: true });

  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`,
    `--screenshot=${target}`,
    `--user-data-dir=${join(workDir, `profile-${index}`)}`,
    pagePath,
  ], { stdio: 'ignore' });

  const ok = await waitForStableFile(target);
  child.kill('SIGKILL');

  if (!ok) throw new Error(`Falha ao gerar o ícone de ${size}px.`);
  console.log(`icons/icon${size}.png (${size}×${size})`);
}

await Promise.all(SIZES.map(render));

rmSync(workDir, { recursive: true, force: true });
console.log('Ícones gerados a partir de icons/icon.svg.');
