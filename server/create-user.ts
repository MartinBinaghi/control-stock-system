// Crea o actualiza un usuario (upsert por email — sirve para resetear contraseñas):
//   node server/create-user.ts <email> <password> <admin|encargado> [branch_id]
import pg from 'pg'
import { hashPassword } from './auth.ts'

try {
  process.loadEnvFile()
} catch {
  // sin .env
}

const [email, password, role, branchId] = process.argv.slice(2)
if (!email || !password || (role !== 'admin' && role !== 'encargado')) {
  console.error('Uso: node server/create-user.ts <email> <password> <admin|encargado> [branch_id]')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query(
  `insert into users (email, password_hash, role, branch_id) values ($1, $2, $3, $4)
   on conflict (email) do update
     set password_hash = excluded.password_hash, role = excluded.role, branch_id = excluded.branch_id
   returning id, email, role, branch_id`,
  [email, hashPassword(password), role, branchId ?? null],
)
console.log('Usuario listo:', rows[0])
await pool.end()
