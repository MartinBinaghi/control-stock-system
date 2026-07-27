import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Formato guardado: "<salt-hex>:<hash-hex>" (scrypt, stdlib — sin bcrypt)

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return salt + ':' + scryptSync(password, salt, 64).toString('hex')
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  if (expected.length !== 64) return false
  return timingSafeEqual(scryptSync(password, salt, 64), expected)
}
