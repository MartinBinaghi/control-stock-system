import { randomBytes } from 'node:crypto'
import path from 'node:path'
import express from 'express'
import type { Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import pg from 'pg'
import webpush from 'web-push'
import { hashPassword, verifyPassword } from './auth.ts'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'


try {
  process.loadEnvFile()
} catch {
  // sin .env: las variables ya vienen del entorno
}



const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 300, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
	standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
	ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive
  message: 'demasiadas peticiones, intente mas tarde'
})

const authLimiter = rateLimit ({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
  message: 'demasiadas peticiones, intente mas tarde'
})

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

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://api.pwnedpasswords.com'],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      workerSrc: ["'self'", 'blob:']
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  frameguard: { action: 'deny' }
}))

// Dev: CSP relajada para HMR
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:")
    next()
  })
}


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
app.use('api/', apiLimiter)
app.set('trust proxy',1)

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {}
    const u = (await pool.query('select * from users where email = $1', [String(email ?? '').toLowerCase()])).rows[0]
    // Verificar bloqueo ANTES de verificar password
    if (u.locked_until && u.locked_until > new Date()) {
      const mins = Math.ceil((u.locked_until.getTime() - Date.now()) / 60000)
      return res.status(429).json({ error: `Cuenta bloqueada. Intente en ${mins} minutos.` })
    }

    if (!verifyPassword(password, u.password_hash)) {
      await pool.query(`
        UPDATE users 
        SET failed_login_attempts = CASE 
              WHEN locked_until IS NOT NULL AND locked_until < NOW() 
              THEN 1 
              ELSE failed_login_attempts + 1 
            END,
            locked_until = CASE 
              WHEN locked_until IS NOT NULL AND locked_until < NOW() 
              THEN NULL
              WHEN failed_login_attempts + 1 >= 5 
              THEN NOW() + INTERVAL '15 minutes' 
              ELSE locked_until 
            END
        WHERE id = $1
      `, [u.id])

      return res.status(401).json({ error: 'Email o contraseña incorrectos' })
    }

    // Login exitoso: resetear
    await pool.query('update users set failed_login_attempts = 0, locked_until = null where id = $1', [u.id])

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
app.post('/api/signup', authLimiter, async (req, res) => {
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

app.post('/api/verify', authLimiter, async (req, res) => {
  const { rows } = await pool.query(
    `update users set verified = true, token = null where token = $1 and role = 'admin' returning id`,
    [String(req.body?.token ?? '')],
  )
  if (!rows[0]) return void res.status(400).json({ error: 'Link inválido o ya usado' })
  res.json({ ok: true })
})

// El trabajador invitado elige su contraseña desde el link del mail.
app.post('/api/accept-invite', authLimiter, async (req, res) => {
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

app.patch('/api/branches/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, address } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const r = await pool.query(
    'update branches set name = $1, address = $2 where id = $3 and owner_id = $4 returning *',
    [String(name).trim(), address || null, req.params.id, user.id],
  )
  if (!r.rows[0]) return void res.status(404).json({ error: 'Sucursal no encontrada' })
  res.json(r.rows[0])
}))

app.delete('/api/branches/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  try {
    const r = await pool.query('delete from branches where id = $1 and owner_id = $2 returning id', [req.params.id, user.id])
    if (!r.rows[0]) return void res.status(404).json({ error: 'Sucursal no encontrada' })
    res.json({ ok: true })
  } catch (e) {
    if ((e as { code?: string }).code === '23503')
      return void res.status(400).json({ error: 'No se puede eliminar: la sucursal tiene encargados, stock o movimientos asociados' })
    throw e
  }
}))

// ---------- Procesos (etapas de fabricación) ----------

app.get('/api/processes', authed(async (user, _req, res) => {
  res.json((await pool.query('select * from processes where owner_id = $1 order by name', [tenantOf(user)])).rows)
}))

app.post('/api/processes', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const r = await pool.query('insert into processes (owner_id, name) values ($1, $2) returning *', [user.id, String(name).trim()])
  res.json(r.rows[0])
}))

app.patch('/api/processes/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const r = await pool.query(
    'update processes set name = $1 where id = $2 and owner_id = $3 returning *',
    [String(name).trim(), req.params.id, user.id],
  )
  if (!r.rows[0]) return void res.status(404).json({ error: 'Proceso no encontrado' })
  res.json(r.rows[0])
}))

app.delete('/api/processes/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  try {
    const r = await pool.query('delete from processes where id = $1 and owner_id = $2 returning id', [req.params.id, user.id])
    if (!r.rows[0]) return void res.status(404).json({ error: 'Proceso no encontrado' })
    res.json({ ok: true })
  } catch (e) {
    if ((e as { code?: string }).code === '23503')
      return void res.status(400).json({ error: 'No se puede eliminar: hay productos asignados a este proceso' })
    throw e
  }
}))

app.get('/api/products', authed(async (user, _req, res) => {
  res.json((await pool.query(
    `select p.*, coalesce(
       (select json_agg(json_build_object('ingredient_id', r.ingredient_id, 'quantity', r.quantity))
        from product_recipes r where r.product_id = p.id),
       '[]'
     ) as recipe
     from products p where p.owner_id = $1 and p.active order by p.name`,
    [tenantOf(user)],
  )).rows)
}))

// Receta de un producto fabricado: reemplaza todos sus insumos. Los insumos
// deben pertenecer a un proceso distinto al del propio producto (ver
// comentario en schema.sql). Nada de esto aplica si es materia prima: se
// borra cualquier receta vieja y listo, no puede quedar guardada a mitad.
async function saveRecipe(
  client: pg.PoolClient, productId: string, processId: string | null, isRawMaterial: boolean,
  recipe: { ingredient_id: string; quantity: number }[], ownerId: string,
) {
  await client.query('delete from product_recipes where product_id = $1', [productId])
  if (isRawMaterial || recipe.length === 0) return
  const ingredientIds = [...new Set(recipe.map((r) => r.ingredient_id))]
  if (ingredientIds.length !== recipe.length)
    throw new Error('No se puede repetir el mismo insumo en una receta')
  const valid = await client.query(
    `select id from products where id = any($1::uuid[]) and owner_id = $2 and process_id is not null and process_id is distinct from $3`,
    [ingredientIds, ownerId, processId],
  )
  if (valid.rows.length !== ingredientIds.length)
    throw new Error('Los insumos deben pertenecer a un proceso distinto al del producto')
  for (const item of recipe) {
    await client.query(
      'insert into product_recipes (product_id, ingredient_id, quantity) values ($1, $2, $3)',
      [productId, item.ingredient_id, item.quantity],
    )
  }
}

app.post('/api/products', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, category, unit, min_stock_threshold, process_id, is_raw_material, recipe } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const isRaw = is_raw_material !== false
  if (!isRaw && !process_id) return void res.status(400).json({ error: 'Un producto fabricado debe pertenecer a un proceso' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    const product = (await client.query(
      `insert into products (owner_id, name, category, unit, min_stock_threshold, process_id, is_raw_material)
       values ($1, $2, $3, coalesce(nullif($4, ''), 'unidad'), coalesce($5, 0), $6, $7) returning *`,
      [user.id, String(name).trim(), category || null, unit, min_stock_threshold, process_id || null, isRaw],
    )).rows[0]
    await saveRecipe(client, product.id, process_id || null, isRaw, Array.isArray(recipe) ? recipe : [], user.id)
    await client.query('commit')
    res.json(product)
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}))

app.patch('/api/products/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { name, category, unit, min_stock_threshold, process_id, is_raw_material, recipe } = req.body ?? {}
  if (!String(name ?? '').trim()) return void res.status(400).json({ error: 'Falta el nombre' })
  const isRaw = is_raw_material !== false
  if (!isRaw && !process_id) return void res.status(400).json({ error: 'Un producto fabricado debe pertenecer a un proceso' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    const product = (await client.query(
      `update products set name = $1, category = $2, unit = coalesce(nullif($3, ''), 'unidad'), min_stock_threshold = coalesce($4, 0),
         process_id = $5, is_raw_material = $6
       where id = $7 and owner_id = $8 returning *`,
      [String(name).trim(), category || null, unit, min_stock_threshold, process_id || null, isRaw, req.params.id, user.id],
    )).rows[0]
    if (!product) { await client.query('rollback'); return void res.status(404).json({ error: 'Producto no encontrado' }) }
    await saveRecipe(client, product.id, process_id || null, isRaw, Array.isArray(recipe) ? recipe : [], user.id)
    await client.query('commit')
    res.json(product)
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}))

app.delete('/api/products/:id', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  // soft-delete: no hay FK que lo impida sola, hay que chequear a mano si
  // sigue siendo insumo de alguna receta activa antes de ocultarlo
  const dependents = await pool.query(
    `select p.name from product_recipes r join products p on p.id = r.product_id
     where r.ingredient_id = $1 and p.owner_id = $2 and p.active`,
    [req.params.id, user.id],
  )
  if (dependents.rows.length > 0)
    return void res.status(400).json({
      error: `No se puede eliminar: es insumo de la receta de ${dependents.rows.map((d) => d.name).join(', ')}`,
    })
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

// Reenvía la invitación (o resetea la contraseña de uno ya verificado: el
// link de invite le permite elegir una contraseña nueva igual).
app.post('/api/team/:id/resend', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const token = randomBytes(32).toString('hex')
  const r = await pool.query(
    `update users set token = $1 from branches
     where users.id = $2 and users.owner_id = $3 and branches.id = users.branch_id
     returning users.email, users.name, branches.name as branch_name`,
    [token, req.params.id, user.id],
  )
  if (!r.rows[0]) return void res.status(404).json({ error: 'Encargado no encontrado' })
  const { email, name, branch_name } = r.rows[0]
  await sendMail(email, `Invitación a ${branch_name} — Control de Stock`,
    `Hola ${name}:\n\n${user.name} te reenvió la invitación a ${branch_name}. Para elegir tu contraseña entrá a:\n${APP_URL}/?invite=${token}`)
  res.json({ ok: true })
}))

app.get('/api/inventory', authed(async (user, req, res) => {
  const q = 'select branch_id, product_id, current_stock from inventory'
  if (user.role !== 'admin') return void res.json((await pool.query(q + ' where branch_id = $1', [user.branch_id])).rows)
  const { branch } = req.query
  const r = branch
    ? await pool.query(`${q} where branch_id = $1 and branch_id in (${tenantBranches(2)})`, [branch, user.id])
    : await pool.query(`${q} where branch_id in (${tenantBranches()})`, [user.id])
  res.json(r.rows)
}))

app.get('/api/alerts', authed(async (user, _req, res) => {
  const q = 'select * from alerts where resolved = false'
  const r = user.role === 'admin'
    ? await pool.query(`${q} and branch_id in (${tenantBranches()}) order by created_at desc`, [user.id])
    : await pool.query(q + ' and branch_id = $1 order by created_at desc', [user.branch_id])
  res.json(r.rows)
}))

app.post('/api/alerts', authed(async (user, req, res) => {
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Solo admin' })
  const { branch_id, product_id, type, message } = req.body ?? {}
  if (!['stock_critico', 'desvio_remito'].includes(type) || !String(message ?? '').trim())
    return void res.status(400).json({ error: 'Faltan datos' })
  const r = await pool.query(
    `insert into alerts (branch_id, product_id, type, message)
     select $1::uuid, $2::uuid, $3::text, $4::text
     where $1 in (${tenantBranches(5)}) returning *`,
    [branch_id, product_id, type, String(message).trim(), user.id],
  )
  if (!r.rows[0]) return void res.status(400).json({ error: 'Sucursal inválida' })
  res.json(r.rows[0])
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

// Producir un lote de un producto fabricado: descuenta los insumos de su
// receta y da de alta el producto terminado, en una sola transacción. Si
// falta stock de algún insumo no se permite sin confirmación explícita
// (force) — y si se confirma igual, queda en negativo más una alerta
// 'insumo_negativo' para que se revise después (la alerta de stock_critico
// genérica también puede saltar sola, vía el trigger de siempre).
app.post('/api/production', authed(async (user, req, res) => {
  const { product_id, quantity, branch_id, force } = req.body ?? {}
  const branch = user.role === 'admin' ? branch_id : user.branch_id
  const qty = Number(quantity)
  if (!qty || qty <= 0) return void res.status(400).json({ error: 'Cantidad inválida' })
  const r2 = (n: number) => +n.toFixed(2)

  const owns = (await pool.query('select 1 from branches where id = $1 and owner_id = $2', [branch, tenantOf(user)])).rows[0]
  if (!owns) return void res.status(400).json({ error: 'Sucursal inválida' })

  const product = (await pool.query(
    'select id, name, is_raw_material from products where id = $1 and owner_id = $2',
    [product_id, tenantOf(user)],
  )).rows[0]
  if (!product) return void res.status(400).json({ error: 'Producto inválido' })
  if (product.is_raw_material) return void res.status(400).json({ error: 'Es materia prima: no tiene receta para producir' })

  const recipe = (await pool.query(
    `select r.ingredient_id, r.quantity, p.name, p.unit,
       coalesce((select current_stock from inventory where branch_id = $2 and product_id = r.ingredient_id), 0) as available
     from product_recipes r join products p on p.id = r.ingredient_id
     where r.product_id = $1`,
    [product_id, branch],
  )).rows as { ingredient_id: string; quantity: number; name: string; unit: string; available: number }[]
  if (recipe.length === 0) return void res.status(400).json({ error: 'Este producto no tiene receta definida' })

  const shortages = recipe
    .map((i) => ({ ...i, required: i.quantity * qty }))
    .filter((i) => i.required > i.available)
  if (shortages.length > 0 && !force) {
    const detail = shortages.map((s) => `${s.name} (disponible ${r2(s.available)} ${s.unit}, necesita ${r2(s.required)} ${s.unit})`).join(', ')
    return void res.status(409).json({ error: `Faltan insumos: ${detail}` })
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into stock_movements (branch_id, product_id, type, quantity, manager_name) values ($1, $2, 'produccion', $3, $4)`,
      [branch, product_id, qty, user.name],
    )
    for (const i of recipe) {
      await client.query(
        `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, reason)
         values ($1, $2, 'consumo_produccion', $3, $4, $5)`,
        [branch, i.ingredient_id, i.quantity * qty, user.name, `Producción de ${qty} ${product.name}`],
      )
    }
    for (const s of shortages) {
      await client.query(
        `insert into alerts (branch_id, product_id, type, message) values ($1, $2, 'insumo_negativo', $3)`,
        [branch, s.ingredient_id,
          `Producción de ${qty} ${product.name} consumió más ${s.name} del disponible: quedó en ${r2(s.available - s.required)} ${s.unit}. Revisar la receta o el stock cargado.`],
      )
    }
    await client.query('commit')
    res.json({ ok: true })
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
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
  res.on('error', (e) => {
    console.error('SSE client error:', e)
    sseClients.delete(res)
  })
}))

setInterval(() => {
  for (const [c] of sseClients) {
    try {
      c.write(': ping\n\n')
    } catch (e) {
      console.error('SSE ping error:', e)
      sseClients.delete(c)
    }
  }
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

let listenClient: pg.Client | null = null

async function listenAlerts() {
  if (listenClient) {
    try { await listenClient.end() } catch { /* ya estaba cerrado */ }
    listenClient = null
  }
  const listener = new pg.Client({ connectionString: DATABASE_URL })
  listenClient = listener
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
      for (const [c, tenant] of sseClients) {
        if (tenant !== owner) continue
        try {
          c.write(`data: ${msg.payload}\n\n`)
        } catch (e) {
          console.error('SSE notify error:', e)
          sseClients.delete(c)
        }
      }
      if (pushEnabled) await sendPush(alert, owner)
    } catch (e) {
      console.error(e)
    }
  })
  listener.on('error', (e) => {
    console.error('LISTEN client error:', e)
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
