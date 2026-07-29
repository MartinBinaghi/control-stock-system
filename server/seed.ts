// Datos de prueba: node server/seed.ts <email-del-admin>
// Crea sucursales, productos, encargados (contraseña: 1234) y dos semanas de
// movimientos bajo ese admin. El trigger arma inventory y las alertas solo.
import pg from 'pg'
import { hashPassword } from './auth.ts'

try { process.loadEnvFile() } catch { /* sin .env */ }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const email = process.argv[2]
if (!email) {
  console.error('Uso: node server/seed.ts <email-del-admin>')
  process.exit(1)
}

const admin = (await pool.query('select id from users where email = $1', [email])).rows[0]
if (!admin) {
  console.error(`No existe el usuario ${email} — crearlo antes con create-user.ts`)
  process.exit(1)
}
const owner = admin.id

if ((await pool.query('select 1 from branches where owner_id = $1 limit 1', [owner])).rowCount) {
  console.error('Ese admin ya tiene sucursales — no re-seedeo para no duplicar.')
  process.exit(1)
}

const BRANCHES = [
  ['Sucursal Centro', 'Av. San Martín 1250'],
  ['Sucursal Norte', 'Belgrano 480'],
  ['Sucursal Sur', 'Av. Mitre 2301'],
]

// [nombre, categoría, unidad, stock mínimo]
const PRODUCTS: [string, string, string, number][] = [
  ['Ravioles de ricota', 'Pastas rellenas', 'plancha', 10],
  ['Ravioles de carne', 'Pastas rellenas', 'plancha', 10],
  ['Sorrentinos jamón y queso', 'Pastas rellenas', 'plancha', 8],
  ['Ñoquis de papa', 'Pastas frescas', 'kg', 5],
  ['Tallarines al huevo', 'Pastas frescas', 'kg', 5],
  ['Canelones de verdura', 'Pastas rellenas', 'docena', 4],
  ['Salsa fileto', 'Salsas', 'unidad', 6],
  ['Salsa bolognesa', 'Salsas', 'unidad', 6],
  ['Tapas de empanadas', 'Otros', 'docena', 10],
]

// [nombre, email] — uno por sucursal, en orden
const WORKERS = [
  ['Lucía Fernández', 'lucia@dipolo.com'],
  ['Carlos Medina', 'carlos@dipolo.com'],
  ['Sofía Ruiz', 'sofia@dipolo.com'],
]

const MERMAS = ['vencimiento', 'cadena_frio', 'rotura', 'otro']
const rand = (n: number) => Math.floor(Math.random() * n)

const branchIds: string[] = []
for (const [name, address] of BRANCHES) {
  const r = await pool.query(
    'insert into branches (owner_id, name, address) values ($1, $2, $3) returning id',
    [owner, name, address],
  )
  branchIds.push(r.rows[0].id)
}

const productIds: string[] = []
for (const [name, category, unit, min] of PRODUCTS) {
  const r = await pool.query(
    'insert into products (owner_id, name, category, unit, min_stock_threshold) values ($1, $2, $3, $4, $5) returning id',
    [owner, name, category, unit, min],
  )
  productIds.push(r.rows[0].id)
}

const workerNames: string[] = []
for (let i = 0; i < WORKERS.length; i++) {
  const [name, wEmail] = WORKERS[i]!
  await pool.query(
    `insert into users (email, password_hash, name, role, owner_id, branch_id, verified)
     values ($1, $2, $3, 'encargado', $4, $5, true)`,
    [wEmail, hashPassword('1234'), name, owner, branchIds[i]],
  )
  workerNames.push(name!)
}

// Dos semanas de historia: ingresos grandes primero, luego egresos y mermas.
// created_at explícito para que los filtros por fecha del dashboard muestren algo.
let movements = 0
for (let b = 0; b < branchIds.length; b++) {
  for (let p = 0; p < productIds.length; p++) {
    const ingreso = 20 + rand(30)
    await pool.query(
      `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, created_at)
       values ($1, $2, 'remito_fabrica', $3, $4, now() - interval '14 days')`,
      [branchIds[b], productIds[p], ingreso, workerNames[b]],
    )
    movements++
    // egresos manuales repartidos en los últimos 13 días
    for (let d = 13; d > 0; d -= 2 + rand(3)) {
      await pool.query(
        `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, created_at)
         values ($1, $2, 'egreso_manual', $3, $4, now() - ($5 || ' days')::interval)`,
        [branchIds[b], productIds[p], 1 + rand(5), workerNames[b], d],
      )
      movements++
    }
    // alguna merma ocasional
    if (rand(3) === 0) {
      await pool.query(
        `insert into stock_movements (branch_id, product_id, type, quantity, manager_name, reason, created_at)
         values ($1, $2, 'merma', $3, $4, $5, now() - ($6 || ' days')::interval)`,
        [branchIds[b], productIds[p], 1 + rand(3), workerNames[b], MERMAS[rand(MERMAS.length)], 1 + rand(10)],
      )
      movements++
    }
  }
}

// Forzar un caso de stock crítico visible en el panel: vaciar casi todo un
// producto en la primera sucursal (dispara la alerta vía trigger).
const low = (await pool.query(
  'select current_stock from inventory where branch_id = $1 and product_id = $2',
  [branchIds[0], productIds[0]],
)).rows[0].current_stock
if (low > 2) {
  await pool.query(
    `insert into stock_movements (branch_id, product_id, type, quantity, manager_name)
     values ($1, $2, 'egreso_manual', $3, $4)`,
    [branchIds[0], productIds[0], low - 2, workerNames[0]],
  )
  movements++
}

// Un remito con incongruencia para el historial + su alerta de desvío.
const remito = (await pool.query(
  `insert into remitos (branch_id, pdf_name, status, manager_name, created_at)
   values ($1, 'remito-0042.pdf', 'con_incongruencia', $2, now() - interval '3 days') returning id`,
  [branchIds[1], workerNames[1]],
)).rows[0]
await pool.query(
  `insert into remito_items (remito_id, product_id, expected_qty, actual_qty, discrepancy_qty)
   values ($1, $2, 12, 12, 0), ($1, $3, 10, 8, -2)`,
  [remito.id, productIds[3], productIds[4]],
)
await pool.query(
  `insert into alerts (branch_id, product_id, type, message, created_at)
   values ($1, $2, 'desvio_remito', $3, now() - interval '3 days')`,
  [branchIds[1], productIds[4], 'Desvío en remito remito-0042.pdf: Tallarines al huevo — esperado 12, recibido 8'],
)

const alerts = (await pool.query('select count(*)::int as n from alerts')).rows[0].n
console.log(`Listo: ${BRANCHES.length} sucursales, ${PRODUCTS.length} productos, ${WORKERS.length} encargados (pass: 1234), ${movements} movimientos, ${alerts} alertas.`)
await pool.end()
