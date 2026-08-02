import { randomBytes } from 'node:crypto'
import path from 'node:path'
import express from 'express'
import type { Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import pg from 'pg'
import webpush from 'web-push'
import { hashPassword, verifyPassword } from './auth.ts'

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
    process.env.VAPID_SUBJECT ?? 'mailto:admin@stockcito.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
}

// ---------- Email (verificación de cuenta e invitaciones) ----------
// SMTP configurable por .env (cualquier proveedor). Sin SMTP_HOST, el link
// se imprime en consola — suficiente para desarrollo.

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const smtp = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null

async function sendMail(to: string, subject: string, text: string) {
  if (!smtp) return void console.log(`[mail no configurado] Para: ${to} — ${subject}\n${text}`)
  await smtp.sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, to, subject, text })
}

type User = {
  id: string
  email: string
  name: string
  role: 'admin' | 'encargado'
  owner_id: string | null
  branch_id: string | null
}

// El "tenant" es el id del admin dueño: los datos de cada negocio quedan
// aislados filtrando todo por él (directo o vía sus sucursales).
const tenantOf = (u: User) => (u.role === 'admin' ? u.id : u.owner_id!)
const tenantBranches = (n = 1) => `select id from branches where owner_id = $${n}`

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
      user = (await pool.query('select id, email, name, role, owner_id, branch_id from users where id = $1', [payload.sub])).rows[0]
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
    const u = (await pool.query('select * from users where email = $1', [String(email ?? '').toLowerCase()])).rows[0]
    if (!u?.password_hash || !verifyPassword(String(password ?? ''), u.password_hash))
      return void res.status(401).json({ error: 'Email o contraseña incorrectos' })
    if (!u.verified)
      return void res.status(401).json({ error: 'Cuenta sin verificar: revisá tu email' })
    // sesión larga a propósito (dispositivo del local)
    const token = jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '90d' })
    res.json({ token, profile: { id: u.id, email: u.email, name: u.name, role: u.role, branch_id: u.branch_id } })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Error del servidor' })
  }
})

// Registro autoservicio: crea un admin sin verificar y manda el link por mail.
// Si el email ya existe sin verificar, re-registra (reenvía el link).
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {}
    if (!/^\S+@\S+\.\S+$/.test(String(email ?? '')))
      return void res.status(400).json({ error: 'Email inválido' })
    if (!String(name ?? '').trim() || String(password ?? '').length < 6)
      return void res.status(400).json({ error: 'Falta el nombre o la contraseña es muy corta (mínimo 6)' })
    const token = randomBytes(32).toString('hex')
    const { rows } = await pool.query(
      `insert into users (email, password_hash, name, role, token) values ($1, $2, $3, 'admin', $4)
       on conflict (email) do update
         set password_hash = excluded.password_hash, name = excluded.name, token = excluded.token
         where users.verified = false and users.role = 'admin'
       returning id`,
      [String(email).toLowerCase(), hashPassword(String(password)), String(name).trim(), token],
    )
    if (!rows[0]) return void res.status(400).json({ error: 'Ese email ya está registrado' })
    await sendMail(email, 'Verificá tu cuenta — Control de Stock',
      `Hola ${name}:\n\nPara activar tu cuenta entrá a:\n${APP_URL}/?verify=${token}\n\nSi no creaste esta cuenta, ignorá este mail.`)
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Error del servidor' })
  }
})

app.post('/api/verify', async (req, res) => {
  const { rows } = await pool.query(
    `update users set verified = true, token = null where token = $1 and role = 'admin' returning id`,
    [String(req.body?.token ?? '')],
  )
  if (!rows[0]) return void res.status(400).json({ error: 'Link inválido o ya usado' })
  res.json({ ok: true })
})

// El trabajador invitado elige su contraseña desde el link del mail.
app.post('/api/accept-invite', async (req, res) => {
  const { token, password } = req.body ?? {}
  if (String(password ?? '').length < 6)
    return void res.status(400).json({ error: 'Contraseña muy corta (mínimo 6)' })
  const { rows } = await pool.query(
    `update users set password_hash = $2, verified = true, token = null
     where token = $1 and role = 'encargado' returning id`,
    [String(token ?? ''), hashPassword(String(password))],
  )
  if (!rows[0]) return void res.status(400).json({ error: 'Invitación inválida o ya usada' })
  res.json({ ok: true })
})

app.get('/api/me', authed(async (user, _req, res) => {
  res.json(user)
}))

// ---------- Datos ----------

app.get('/api/branches', authed(async (user, _req, res) => {
  res.json((await pool.query('select * from branches where owner_id = $1 order by name', [tenantOf(user)])).rows)
}))

app.post('/api/branches', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, address } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const r = await pool.query('insert into branches (owner_id, name, address) values ($1, $2, $3) returning *', [
    user.id, String(name).trim(), address || null,
  ])
  res.json(r.rows[0])
}))

app.get('/api/products', authed(async (user, _req, res) => {
  res.json((await pool.query('select * from products where owner_id = $1 and active order by name', [tenantOf(user)])).rows)
}))

app.post('/api/products', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, category, unit, min_stock_threshold } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const r = await pool.query(
    `insert into products (owner_id, name, category, unit, min_stock_threshold)
     values ($1, $2, $3, coalesce(nullif($4, ''), 'unidad'), coalesce($5, 0)) returning *`,
    [user.id, String(name).trim(), category || null, unit, min_stock_threshold],
  )
  res.json(r.rows[0])
}))

app.patch('/api/products/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, category, unit, min_stock_threshold } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const r = await pool.query(
    `update products set name = $1, category = $2, unit = coalesce(nullif($3, ''), 'unidad'), min_stock_threshold = coalesce($4, 0)
     where id = $5 and owner_id = $6 returning *`,
    [String(name).trim(), category || null, unit, min_stock_threshold, req.params.id, user.id],
  )
  if (!r.rows[0]) return void res.status(404).json({ error: 'Producto no encontrado' })
  res.json(r.rows[0])
}))

app.delete('/api/products/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const r = await pool.query(
    'update products set active = false where id = $1 and owner_id = $2 returning id',
    [req.params.id, user.id],
  )
  if (!r.rows[0]) return void res.status(404).json({ error: 'Producto no encontrado' })
  res.json({ ok: true })
}))

// ---------- Equipo (trabajadores del admin) ----------

app.get('/api/team', authed(async (user, _req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  res.json((await pool.query(
    'select id, email, name, branch_id, verified from users where owner_id = $1 order by name', [user.id],
  )).rows)
}))

// Invita un trabajador a una sucursal: crea la cuenta pendiente y manda el
// link por mail para que elija su contraseña.
app.post('/api/invite', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, email, branch_id } = req.body ?? {}
  if (!/^\S+@\S+\.\S+$/.test(String(email ?? '')) || !String(name ?? '').trim())
    return void res.status(400).json({ error: 'Falta el nombre o el email es inválido' })
  const branch = (await pool.query('select name from branches where id = $1 and owner_id = $2', [branch_id, user.id])).rows[0]
  if (!branch) return void res.status(400).json({ error: 'Sucursal inválida' })
  const token = randomBytes(32).toString('hex')
  const r = await pool.query(
    `insert into users (email, name, role, owner_id, branch_id, token)
     values ($1, $2, 'encargado', $3, $4, $5) returning id, email, name, branch_id, verified`,
    [String(email).toLowerCase(), String(name).trim(), user.id, branch_id, token],
  ).catch(() => null)
  if (!r) return void res.status(400).json({ error: 'Ese email ya está registrado' })
  await sendMail(email, `Invitación a ${branch.name} — Control de Stock`,
    `Hola ${name}:\n\n${user.name} te invitó a trabajar en ${branch.name}. Para crear tu contraseña entrá a:\n${APP_URL}/?invite=${token}`)
  res.json(r.rows[0])
}))

app.delete('/api/team/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  await pool.query('delete from users where id = $1 and owner_id = $2', [req.params.id, user.id])
  res.json({ ok: true })
}))

app.get('/api/inventory', authed(async (user, _req, res) => {
  const q = 'select branch_id, product_id, current_stock from inventory'
  const r = user.role === 'admin'
    ? await pool.query(`${q} where branch_id in (${tenantBranches()})`, [user.id])
    : await pool.query(q + ' where branch_id = $1', [user.branch_id])
  res.json(r.rows)
}))

app.get('/api/alerts', authed(async (user, _req, res) => {
  const q = 'select * from alerts where resolved = false'
  const r = user.role === 'admin'
    ? await pool.query(`${q} and branch_id in (${tenantBranches()}) order by created_at desc`, [user.id])
    : await pool.query(q + ' and branch_id = $1 order by created_at desc', [user.branch_id])
  res.json(r.rows)
}))

app.patch('/api/alerts/:id/resolve', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  await pool.query(`update alerts set resolved = true where id = $1 and branch_id in (${tenantBranches(2)})`, [
    req.params.id, user.id,
  ])
  res.json({ ok: true })
}))

// La API solo INSERTA movimientos; el trigger de Postgres actualiza inventory
// y genera alertas. Sin update/delete: auditoría. Cada movimiento queda
// firmado con el nombre del usuario logueado (manager_name).
app.post('/api/movements', authed(async (user, req, res) => {
  const { product_id, type, quantity, reason, branch_id } = req.body ?? {}
  const branch = user.role === 'admin' ? branch_id : user.branch_id // encargado: siempre su sucursal
  const r = await pool.query(
    `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, reason)
     select $1::uuid, $2::uuid, $3::text, $4::numeric, $5::text, $6::text
     where $1 in (${tenantBranches(7)}) returning *`,
    [branch, product_id, type, quantity, user.name, reason ?? null, tenantOf(user)],
  )
  if (!r.rows[0]) return void res.status(400).json({ error: 'Sucursal inválida' })
  res.json(r.rows[0])
}))

app.get('/api/movements', authed(async (user, req, res) => {
  const { branch, product, from, to } = req.query
  const cond: string[] = []
  const params: unknown[] = []

  if (user.role === 'admin') {
    cond.push(`branch_id in (${tenantBranches()})`)
    params.push(user.id)
  } else {
    // Encargado: solo su sucursal
    cond.push('branch_id = $1')
    params.push(user.branch_id)
  }

  if (branch) {
    // Admin puede filtrar por sucursal específica; encargado ignora este filtro
    if (user.role === 'admin') {
      params.push(branch)
      cond.push(`branch_id = $${params.length}`)
    }
  }
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
  const { pdf_name, items, branch_id } = req.body ?? {}
  const manager_name = user.name
  const branch = user.role === 'admin' ? branch_id : user.branch_id
  if (!Array.isArray(items) || items.length === 0)
    return void res.status(400).json({ error: 'Sin ítems' })
  const owns = (await pool.query(`select 1 from branches where id = $1 and owner_id = $2`, [branch, tenantOf(user)])).rows[0]
  if (!owns) return void res.status(400).json({ error: 'Sucursal inválida' })
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


// Historial de remitos (admin: todas sus sucursales; encargado: solo la suya)
app.get('/api/remitos', authed(async (user, _req, res) => {
  let q = `
    select r.*, b.name as branch_name
    from remitos r
    join branches b on b.id = r.branch_id
  `
  const params: unknown[] = []
  if (user.role === 'admin') {
    q += ` where r.branch_id in (${tenantBranches()})`
    params.push(user.id)
  } else {
    q += ' where r.branch_id = $1'
    params.push(user.branch_id)
  }
  q += ' order by r.created_at desc limit 100'
  const r = await pool.query(q, params)
  res.json(r.rows)
}))

// Items de un remito
app.get('/api/remitos/:id/items', authed(async (user, req, res) => {
  const remito = (await pool.query('select branch_id from remitos where id = $1', [req.params.id])).rows[0]
  if (!remito) return void res.status(404).json({ error: 'Remito no encontrado' })
  const owns = user.role === 'admin'
    ? (await pool.query('select 1 from branches where id = $1 and owner_id = $2', [remito.branch_id, user.id])).rows[0]
    : remito.branch_id === user.branch_id
  if (!owns) return void res.status(403).json({ error: 'No autorizado' })

  const items = await pool.query(
    `select ri.*, p.name as product_name, p.unit
     from remito_items ri
     join products p on p.id = ri.product_id
     where ri.remito_id = $1`,
    [req.params.id],
  )
  res.json(items.rows)
}))


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

const sseClients = new Map<Response, string>() // res → id del admin dueño

app.get('/api/events', authed(async (user, _req, res) => {
  if (user.role !== 'admin') return void res.status(403).end()
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write('\n')
  sseClients.set(res, user.id)
  res.on('close', () => sseClients.delete(res))
}))

setInterval(() => {
  for (const c of sseClients.keys()) c.write(': ping\n\n')
}, 30_000)

async function sendPush(alert: { type: string; message: string }, owner: string) {
  const title = alert.type === 'stock_critico' ? '⚠️ Stock crítico' : '📦 Desvío de remito'
  const { rows } = await pool.query(
    `select ps.id, ps.subscription from push_subscriptions ps
     join users u on u.id = ps.user_id where u.id = $1 or u.owner_id = $1`,
    [owner],
  )
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
  listener.on('notification', async (msg) => {
    try {
      // cada alerta va solo al negocio dueño de la sucursal
      const alert = JSON.parse(msg.payload ?? '{}') as { branch_id?: string; type: string; message: string }
      const owner: string | undefined = (
        await pool.query('select owner_id from branches where id = $1', [alert.branch_id])
      ).rows[0]?.owner_id
      if (!owner) return
      for (const [c, tenant] of sseClients) if (tenant === owner) c.write(`data: ${msg.payload}\n\n`)
      if (pushEnabled) await sendPush(alert, owner)
    } catch (e) {
      console.error(e)
    }
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
