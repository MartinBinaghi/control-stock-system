// Correr con: node tests/parseRemito.test.ts  (Node 22+ con type stripping)
import assert from 'node:assert'
import { parseRemito, normalize } from '../src/lib/parseRemito.ts'

const text = `
REMITO N° 0001-00012345
Producto            Cantidad
Ravioles de ricota    12
Ñoquis de papa    5,5
Salsa fileto  8
TOTAL    25
`
const items = parseRemito(text)
assert.deepStrictEqual(items, [
  { rawName: 'Ravioles de ricota', expectedQty: 12 },
  { rawName: 'Ñoquis de papa', expectedQty: 5.5 },
  { rawName: 'Salsa fileto', expectedQty: 8 },
])
// normalize quita diacríticos a propósito: matching insensible a acentos
assert.strictEqual(normalize('  Ñoquis  de PAPA '), 'noquis de papa')
assert.strictEqual(normalize('Ñoquis de papa'), normalize('noquis de papa'))
assert.strictEqual(normalize('Salsa Fileto'), normalize('salsa  fileto'))
console.log('parseRemito OK:', items.length, 'items')
