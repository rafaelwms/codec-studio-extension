/**
 * Gera a variante "site" do Codec Studio: o mesmo código da extensão, mas com
 * `app.html` renomeado para `index.html` e sem os artefatos que só fazem sentido
 * dentro do pacote de extensão (`manifest.json`, `_locales/`) — nada em runtime
 * lê esses dois arquivos (os catálogos de idioma são módulos ES importados
 * estaticamente, não `fetch`), então ficam de fora sem perda nenhuma.
 *
 * Usado pelo Dockerfile para montar a imagem servida em
 * https://codec-studio.rafaelwms.com — mesmo código, hospedagem diferente.
 *
 *   node scripts/build-web.mjs
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-web');

const SHIPPED = ['src', 'styles', 'icons'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const entry of SHIPPED) {
  cpSync(join(root, entry), join(outDir, entry), {
    recursive: true,
    filter: (source) => !source.endsWith('.DS_Store'),
  });
}

// A fonte vetorial do ícone não precisa ir para o servidor; os PNGs bastam.
rmSync(join(outDir, 'icons', 'icon.svg'), { force: true });

// Mesma página; só o nome muda para o que um servidor HTTP espera por padrão.
writeFileSync(join(outDir, 'index.html'), readFileSync(join(root, 'app.html'), 'utf8'));

console.log('dist-web/ pronto — index.html + assets, sem manifest.json nem _locales.');
