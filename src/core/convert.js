/**
 * Orquestrador de conversões.
 *
 * Toda conversão é a mesma coisa: ler o formato de origem para o modelo e
 * escrever o modelo no formato de destino. Não existe código por par.
 */

import { CodecError } from './base64.js';
import { getFormat } from './formats/index.js';

/**
 * @param {string} text
 * @param {string} fromId
 * @param {string} toId
 * @param {object} [options] opções de leitura e de escrita, num objeto só
 * @returns {{output: string, warnings: string[], ir: import('./ir.js').IR}}
 */
export function convert(text, fromId, toId, options = {}) {
  const from = getFormat(fromId);
  const to = getFormat(toId);

  if (!from || !to) {
    throw new CodecError('core.convert.unknownFormat', {
      params: { name: from ? toId : fromId },
      hintCode: 'core.convert.unknownFormat.hint',
    });
  }

  // Entre dois formatos de dados, o que o usuário quer é o *documento dele* no
  // outro formato — não um exemplo derivado da estrutura. Só quando há uma
  // linguagem envolvida é que faz sentido inferir tipos.
  if (from.kind === 'data' && to.kind === 'data') {
    return { output: to.emitData(from.parseData(text), options), warnings: [], ir: null };
  }

  const ir = from.parse(text, options);

  // O nome da raiz é escolha do usuário quando a origem não traz um (JSON/YAML
  // não nomeiam tipos); quando a origem é uma linguagem, o nome já veio de lá.
  if (from.kind === 'data' && options.rootName && ir.rootName) {
    renameRoot(ir, options.rootName);
  }

  const { output, warnings } = to.emit(ir, options);
  return { output, warnings, ir };
}

function renameRoot(ir, requested) {
  const target = ir.types.find((type) => type.name === ir.rootName);
  if (!target || target.name === requested) return;
  if (ir.types.some((type) => type.name === requested)) return; // nome já ocupado

  const previous = target.name;
  target.name = requested;
  ir.rootName = requested;

  for (const type of ir.types) {
    for (const field of type.fields) retarget(field.type, previous, requested);
  }
}

function retarget(type, from, to) {
  if (!type) return;
  if (type.kind === 'ref' && type.name === from) type.name = to;
  else if (type.kind === 'list' || type.kind === 'map') retarget(type.of, from, to);
}

/** Os dois formatos são iguais? Útil para a interface desabilitar o par. */
export const isSameFormat = (fromId, toId) => fromId === toId;
