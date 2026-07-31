/**
 * Gera os PNGs do ícone (16/32/48/128) sem nenhuma dependência externa.
 *
 * Em vez de chamar um navegador para rasterizar SVG, desenhamos o ícone
 * diretamente: o traçado é composto por retângulo arredondado + "cápsulas"
 * (segmentos com pontas redondas), avaliados por distância com supersampling 4×
 * para antialiasing. O PNG é escrito à mão (IHDR/IDAT/IEND + CRC32) usando
 * apenas o zlib do próprio Node.
 *
 * O icons/icon.svg continua sendo a fonte visual de referência — este script
 * reproduz a mesma geometria em coordenadas de 128×128.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];
const SS = 4; // fator de supersampling

/* ------------------------------------------------------------- geometria -- */

const CARD = { x: 4, y: 4, w: 120, h: 120, r: 30 };

// Traços do glifo "⇄" (mesmas coordenadas do icon.svg), com espessura 9.
const STROKES = [
  [34, 50, 84, 50],
  [72, 38, 84, 50],
  [84, 50, 72, 62],
  [94, 78, 44, 78],
  [56, 66, 44, 78],
  [44, 78, 56, 90],
];
const STROKE_WIDTH = 9;
const INK = [10, 22, 38];      // #0a1626
const INK_ALPHA = 0.92;

// Gradiente do fundo: ciano → azul → violeta na diagonal.
const GRADIENT = [
  { at: 0.0, color: [62, 240, 212] },
  { at: 0.55, color: [56, 182, 240] },
  { at: 1.0, color: [123, 140, 255] },
];

/** Distância assinada até um retângulo arredondado. */
function distanceToCard(px, py) {
  const cx = CARD.x + CARD.w / 2;
  const cy = CARD.y + CARD.h / 2;
  const dx = Math.abs(px - cx) - (CARD.w / 2 - CARD.r);
  const dy = Math.abs(py - cy) - (CARD.h / 2 - CARD.r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - CARD.r;
}

/** Distância até um segmento de reta (para as cápsulas do traçado). */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function gradientColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRADIENT.length; i += 1) {
    const previous = GRADIENT[i - 1];
    const current = GRADIENT[i];
    if (clamped <= current.at) {
      const local = (clamped - previous.at) / (current.at - previous.at);
      return previous.color.map((channel, index) =>
        Math.round(channel + (current.color[index] - channel) * local));
    }
  }
  return GRADIENT.at(-1).color;
}

/** Cor final (RGBA 0–255) do ponto (x, y) em coordenadas de 128×128. */
function samplePixel(x, y) {
  const inCard = distanceToCard(x, y) <= 0;
  if (!inCard) return [0, 0, 0, 0];

  // Gradiente diagonal + brilho superior (equivalente ao "sheen" do SVG).
  const [r, g, b] = gradientColor((x - CARD.x + (y - CARD.y)) / (CARD.w + CARD.h));
  const sheen = Math.max(0, 0.34 * (1 - (y - CARD.y) / (CARD.h * 0.6)));
  let color = [
    Math.round(r + (255 - r) * sheen),
    Math.round(g + (255 - g) * sheen),
    Math.round(b + (255 - b) * sheen),
  ];

  const onStroke = STROKES.some(
    ([x1, y1, x2, y2]) => distanceToSegment(x, y, x1, y1, x2, y2) <= STROKE_WIDTH / 2,
  );
  if (onStroke) {
    color = color.map((channel, index) => Math.round(channel * (1 - INK_ALPHA) + INK[index] * INK_ALPHA));
  }

  return [...color, 255];
}

/** Renderiza com supersampling e devolve os pixels RGBA do tamanho pedido. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 128 / size;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          const [sr, sg, sb, sa] = samplePixel(x, y);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += alpha;
        }
      }

      const samples = SS * SS;
      const offset = (py * size + px) * 4;
      if (a === 0) continue;
      pixels[offset] = Math.round(r / a);
      pixels[offset + 1] = Math.round(g / a);
      pixels[offset + 2] = Math.round(b / a);
      pixels[offset + 3] = Math.round((a / samples) * 255);
    }
  }

  return pixels;
}

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // bits por canal
  header[9] = 6;  // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // filtro adaptativo
  header[12] = 0; // sem entrelaçamento

  // Cada scanline é prefixada pelo byte de filtro (0 = None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const target = y * (size * 4 + 1);
    raw[target] = 0;
    pixels.copy(raw, target + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- saída -- */

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of SIZES) {
  const file = join(root, 'icons', `icon${size}.png`);
  writeFileSync(file, encodePng(render(size), size));
  console.log(`icons/icon${size}.png (${size}×${size})`);
}
console.log('Ícones gerados.');
