// Crea un admin ya verificado sin pasar por el email, o resetea la
// contraseña de cualquier usuario existente (upsert por email):
//   node server/create-user.ts <email> <password>
// El alta normal (admins por registro, encargados por invitación) es desde la app.
import pg from 'pg'
import { hashPassword } from './auth.ts'

try {
  process.loadEnvFile()
} catch {
  // sin .env
}

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Uso: node server/create-user.ts <email> <password>')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query(
  `insert into users (email, password_hash, name, role, verified) values ($1, $2, $3, 'admin', true)
   on conflict (email) do update
     set password_hash = excluded.password_hash, verified = true
   returning id, email, name, role, branch_id`,
  [email, hashPassword(password), email.split('@')[0]],
)
console.log('Usuario listo:', rows[0])
await pool.end()
