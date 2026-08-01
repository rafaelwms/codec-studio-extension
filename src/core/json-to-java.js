/**
 * JSON → Java.
 *
 * Desde a 2.0 esta conversão é apenas um caminho entre muitos: o trabalho real
 * está em `formats/json.js` (texto → modelo) e `formats/java.js` (modelo → texto).
 * A função continua exportada porque é a API que a suíte de testes e as versões
 * anteriores usavam.
 */

import * as javaFormat from './formats/java.js';
import * as jsonFormat from './formats/json.js';

/**
 * @param {string} jsonText
 * @param {object} [options]
 * @returns {{output: string, warnings: string[], classCount: number}}
 */
export function jsonToJava(jsonText, options = {}) {
  const ir = jsonFormat.parse(jsonText, {
    rootName: options.rootClassName || 'Root',
    detectDateTime: options.detectDateTime !== false,
  });
  const { output, warnings } = javaFormat.emit(ir, options);
  return { output, warnings, classCount: ir.types.length };
}
