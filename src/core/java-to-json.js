/**
 * Java → JSON.
 *
 * Wrapper fino sobre `formats/java.js` (texto → modelo) e `formats/json.js`
 * (modelo → texto), mantido pela mesma razão que `json-to-java.js`.
 */

import * as javaFormat from './formats/java.js';
import * as jsonFormat from './formats/json.js';

/**
 * @param {string} source código Java
 * @param {object} [options]
 * @returns {{output: string, warnings: string[], rootName: string, types: string[]}}
 */
export function javaToJson(source, options = {}) {
  const ir = javaFormat.parse(source, options);
  const { output, warnings } = jsonFormat.emit(ir, options);
  return {
    output,
    warnings,
    rootName: ir.rootName,
    types: ir.types.map((type) => type.name),
  };
}
