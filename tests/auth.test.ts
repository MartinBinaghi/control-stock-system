// Correr con: node tests/auth.test.ts  (Node 22+ con type stripping)
import assert from 'node:assert'
import { hashPassword, verifyPassword } from '../server/auth.ts'

const h = hashPassword('secreta123')
assert.ok(verifyPassword('secreta123', h))
assert.ok(!verifyPassword('otra', h))
assert.ok(!verifyPassword('secreta123', 'basura-sin-formato'))
assert.notStrictEqual(hashPassword('secreta123'), h) // salt aleatoria por hash
console.log('auth OK')
