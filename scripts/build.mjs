/**
 * Empacota a extensão em dist/ e gera o .zip pronto para a Chrome Web Store /
 * Edge Add-ons. Copia apenas o que roda no navegador — testes, scripts e o
 * package.json ficam de fora.
 *
 *   node scripts/build.mjs
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const bundleName = `codec-studio-${manifest.version}.zip`;

const SHIPPED = ['manifest.json', 'app.html', 'src', 'styles', 'icons', '_locales'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of SHIPPED) {
  cpSync(join(root, entry), join(dist, entry), {
    recursive: true,
    filter: (source) => !source.endsWith('.DS_Store'),
  });
}

// O SVG-fonte não precisa ir para a loja; os PNGs bastam.
rmSync(join(dist, 'icons', 'icon.svg'), { force: true });

rmSync(join(root, bundleName), { force: true });
execFileSync('zip', ['-r', '-X', '-q', join(root, bundleName), '.'], { cwd: dist });

const size = statSync(join(root, bundleName)).size;
console.log(`dist/ pronto e ${bundleName} gerado (${(size / 1024).toFixed(1)} KB).`);
console.log('Carregue dist/ em chrome://extensions ou edge://extensions com "Carregar sem compactação".');
