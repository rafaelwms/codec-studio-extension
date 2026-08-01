/**
 * Registro de formatos.
 *
 * Cada módulo exporta a mesma interface — `id`, `label`, `kind`, `parse`, `emit` —
 * então acrescentar uma linguagem nova é acrescentar um arquivo aqui: todas as
 * conversões de e para ela passam a existir sem tocar em mais nada.
 */

import * as csharp from './csharp.js';
import * as dart from './dart.js';
import * as go from './go.js';
import * as java from './java.js';
import * as json from './json.js';
import * as swift from './swift.js';
import * as typescript from './typescript.js';
import * as yaml from './yaml.js';

/** Ordem de exibição na interface: formatos de dados primeiro. */
export const FORMATS = [json, yaml, java, csharp, typescript, dart, swift, go];

const BY_ID = new Map(FORMATS.map((format) => [format.id, format]));

export function getFormat(id) {
  return BY_ID.get(id) || null;
}

export const FORMAT_IDS = FORMATS.map((format) => format.id);

/** Formatos que carregam dados (aceitam qualquer documento, inclusive escalares). */
export const DATA_FORMATS = FORMATS.filter((format) => format.kind === 'data').map((format) => format.id);

/** Formatos que declaram tipos (precisam de um objeto para descrever). */
export const LANG_FORMATS = FORMATS.filter((format) => format.kind === 'lang').map((format) => format.id);
