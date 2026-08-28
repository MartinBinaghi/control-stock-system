import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

try {
  process.loadEnvFile()
} catch {}

const { DATABASE_URL } = process.env
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL en .env')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: DATABASE_URL })

async function ensureMigrationsTable() {
  await pool.query(`
    create table if not exists _migrations (
      id serial primary key,
      name text not null unique,
      applied_at timestamptz not null default now()
    )
  `)
}

async function getApplied() {
  const { rows } = await pool.query('select name from _migrations order by id')
  return new Set(rows.map(r => r.name))
}

async function run() {
  await ensureMigrationsTable()
  const applied = await getApplied()

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
  const files = (await fs.readdir(dir))
    .filter(f => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('No hay migraciones para ejecutar')
    await pool.end()
    return
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`⊘ ${file} (ya aplicado)`)
      continue
    }
    console.log(`▶ ${file}`)
    const sql = await fs.readFile(path.join(dir, file), 'utf-8')
    await pool.query('begin')
    try {
      await pool.query(sql)
      await pool.query('insert into _migrations (name) values ($1)', [file])
      await pool.query('commit')
      console.log(`✓ ${file}`)
    } catch (e) {
      await pool.query('rollback')
      console.error(`✗ ${file} falló:`, e)
      await pool.end()
      process.exit(1)
    }
  }
  console.log('Migraciones completadas')
  await pool.end()
}

run().catch(e => { console.error(e); process.exit(1) })