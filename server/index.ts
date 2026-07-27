import path from 'node:path'
import express from 'express'
import type { Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import webpush from 'web-push'
import { verifyPassword } from './auth.ts'

try {
  process.loadEnvFile()
} catch {
  // sin .env: las variables ya vienen del entorno
}

const { DATABASE_URL, JWT_SECRET, PORT = '3001' } = process.env
if (!DATABASE_URL || !JWT_SECRET) {
  console.error('Faltan DATABASE_URL o JWT_SECRET (ver .env.example)')
  process.exit(1)
}

pg.types.setTypeParser(1700, parseFloat) // numeric → number (pg lo devuelve como string)
const pool = new pg.Pool({ connectionString: DATABASE_URL })
pool.on('error', console.error) // sin esto, un error de un cliente idle tumba el proceso

const pushEnabled = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
if (pushEnabled) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@dipolo.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
}

type User = { id: string; email: string; role: 'admin' | 'encargado'; branch_id: string | null }

const app = express()
app.use(express.json())

// Autenticación + manejo de errores en un solo wrapper. El token va en
// Authorization: Bearer (o ?token= para EventSource, que no admite headers).
// El usuario se relee de la DB en cada request: cambios de rol/sucursal
// aplican al instante sin invalidar tokens.
function authed(fn: (user: User, req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? String(req.query.token ?? '')
    let user: User | undefined
    try {
      const payload = jwt.verify(token, JWT_SECRET!) as { sub?: string }
      user = (await pool.query('select id, email, role, branch_id from users where id = $1', [payload.sub])).rows[0]
    } catch {
      // token inválido o vencido
    }
    if (!user) return void res.status(401).json({ error: 'No autorizado' })
    try {
      await fn(user, req, res)
    } catch (e) {
      console.error(e)
      res.status(400).json({ error: e instanceof Error ? e.message : 'Error' })
    }
  }
}

// ---------- Auth ----------

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {}
    const u = (await pool.query('select * from users where email = $1', [email])).rows[0]
    if (!u || !verifyPassword(String(password ?? ''), u.password_hash))
      return void res.status(401).json({ error: 'Email o contraseña incorrectos' })
    // login compartido por sucursal: sesión larga a propósito
    const token = jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '90d' })
    res.json({ token, profile: { id: u.id, email: u.email, role: u.role, branch_id: u.branch_id } })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Error del servidor' })
  }
})

app.get('/api/me', authed(async (user, _req, res) => {
  res.json(user)
}))

// ---------- Datos ----------

app.get('/api/branches', authed(async (_user, _req, res) => {
  res.json((await pool.query('select * from branches order by name')).rows)
}))

app.get('/api/products', authed(async (_user, _req, res) => {
  res.json((await pool.query('select * from products order by name')).rows)
}))

app.get('/api/inventory', authed(async (user, _req, res) => {
  const q = 'select branch_id, product_id, current_stock from inventory'
  const r = user.role === 'admin'
    ? await pool.query(q)
    : await pool.query(q + ' where branch_id = $1', [user.branch_id])
  res.json(r.rows)
}))

app.get('/api/alerts', authed(async (user, _req, res) => {
  const q = 'select * from alerts where resolved = false'
  const r = user.role === 'admin'
    ? await pool.query(q + ' order by created_at desc')
    : await pool.query(q + ' and branch_id = $1 order by created_at desc', [user.branch_id])
  res.json(r.rows)
}))

app.patch('/api/alerts/:id/resolve', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  await pool.query('update alerts set resolved = true where id = $1', [req.params.id])
  res.json({ ok: true })
}))

// La API solo INSERTA movimientos; el trigger de Postgres actualiza inventory
// y genera alertas. Sin update/delete: auditoría. Validación de type/quantity/
// manager_name: los CHECK del schema (error → 400).
app.post('/api/movements', authed(async (user, req, res) => {
  const { product_id, type, quantity, manager_name, reason, branch_id } = req.body ?? {}
  const branch = user.role === 'admin' ? branch_id : user.branch_id // encargado: siempre su sucursal
  const r = await pool.query(
    `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, reason)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [branch, product_id, type, quantity, manager_name, reason ?? null],
  )
  res.json(r.rows[0])
}))

app.get('/api/movements', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { branch, product, from, to } = req.query
  const cond: string[] = []
  const params: unknown[] = []
  if (branch) { params.push(branch); cond.push(`branch_id = $${params.length}`) }
  if (product) { params.push(product); cond.push(`product_id = $${params.length}`) }
  if (from) { params.push(from); cond.push(`created_at >= $${params.length}`) }
  if (to) { params.push(to + 'T23:59:59'); cond.push(`created_at <= $${params.length}`) }
  const where = cond.length ? ' where ' + cond.join(' and ') : ''
  const r = await pool.query(`select * from stock_movements${where} order by created_at desc limit 200`, params)
  res.json(r.rows)
}))

// Remito completo en una transacción: remito + items + movimientos (con el
// conteo físico real) + alertas de desvío. O entra todo o no entra nada.
app.post('/api/remitos', authed(async (user, req, res) => {
  const { pdf_name, manager_name, items, branch_id } = req.body ?? {}
  const branch = user.role === 'admin' ? branch_id : user.branch_id
  if (!Array.isArray(items) || items.length === 0)
    return void res.status(400).json({ error: 'Sin ítems' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    const discrepancies = items.filter((i) => Number(i.actual_qty) !== Number(i.expected_qty))
    const remito = (await client.query(
      'insert into remitos (branch_id, pdf_name, status, manager_name) values ($1, $2, $3, $4) returning *',
      [branch, pdf_name, discrepancies.length ? 'con_incongruencia' : 'correcto', manager_name],
    )).rows[0]
    // ponytail: queries en loop — con <100 ítems por remito alcanza de sobra
    for (const i of items) {
      await client.query(
        'insert into remito_items (remito_id, product_id, expected_qty, actual_qty, discrepancy_qty) values ($1, $2, $3, $4, $5)',
        [remito.id, i.product_id, i.expected_qty, i.actual_qty, Number(i.actual_qty) - Number(i.expected_qty)],
      )
      if (Number(i.actual_qty) > 0)
        await client.query(
          `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, reason)
           values ($1, $2, 'remito_fabrica', $3, $4, $5)`,
          [branch, i.product_id, i.actual_qty, manager_name, pdf_name],
        )
    }
    for (const d of discrepancies) {
      const pname = (await client.query('select name from products where id = $1', [d.product_id])).rows[0]?.name ?? '?'
      await client.query(
        `insert into alerts (branch_id, product_id, type, message) values ($1, $2, 'desvio_remito', $3)`,
        [branch, d.product_id, `Desvío en remito ${pdf_name}: ${pname} esperado ${d.expected_qty}, físico ${d.actual_qty}`],
      )
    }
    await client.query('commit')
    res.json(remito)
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}))

// ---------- Push ----------

app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY ?? null })
})

app.post('/api/push-subscriptions', authed(async (user, req, res) => {
  await pool.query('insert into push_subscriptions (user_id, subscription) values ($1, $2)', [
    user.id,
    req.body.subscription,
  ])
  res.json({ ok: true })
}))

// ---------- Alertas en vivo: Postgres NOTIFY → SSE + Web Push ----------

const sseClients = new Set<Response>()

app.get('/api/events', authed(async (user, _req, res) => {
  if (user.role !== 'admin') return void res.status(403).end()
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write('\n')
  sseClients.add(res)
  res.on('close', () => sseClients.delete(res))
}))

setInterval(() => {
  for (const c of sseClients) c.write(': ping\n\n')
}, 30_000)

async function sendPush(alert: { type: string; message: string }) {
  const title = alert.type === 'stock_critico' ? '⚠️ Stock crítico' : '📦 Desvío de remito'
  const { rows } = await pool.query('select id, subscription from push_subscriptions')
  // ponytail: se envía a todas las suscripciones — a esta escala todos los
  // suscriptos son admins. Filtrar por rol si algún día se suscriben encargados.
  await Promise.allSettled(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(r.subscription, JSON.stringify({ title, body: alert.message }))
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410)
          await pool.query('delete from push_subscriptions where id = $1', [r.id])
      }
    }),
  )
}

async function listenAlerts() {
  const listener = new pg.Client({ connectionString: DATABASE_URL })
  await listener.connect()
  await listener.query('listen alerts')
  listener.on('notification', (msg) => {
    for (const c of sseClients) c.write(`data: ${msg.payload}\n\n`)
    if (pushEnabled) sendPush(JSON.parse(msg.payload ?? '{}')).catch(console.error)
  })
  listener.on('error', () => {
    listener.end().catch(() => {})
    setTimeout(() => listenAlerts().catch(console.error), 5000) // reconexión simple
  })
}

// ---------- Frontend estático (producción: npm run build → dist/) ----------

app.use(express.static('dist'))
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return void res.status(404).json({ error: 'No existe' })
  res.sendFile(path.resolve('dist/index.html'), (err) => {
    if (err) res.status(404).send('Falta el build del frontend (npm run build)')
  })
})

app.listen(Number(PORT), () => console.log(`API en http://localhost:${PORT}`))
listenAlerts().catch((e) => console.error('LISTEN alerts falló:', e))
