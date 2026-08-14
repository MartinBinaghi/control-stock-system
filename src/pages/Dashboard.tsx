import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Bell, BellRing, Boxes, Building2, Check, ClipboardList, Cog, FileText, LogOut, Mail, RefreshCw, Trash2, Pencil, Repeat, Search } from 'lucide-react'
import {
  api, createAlert, createProcess, deleteBranch, deleteProcess, deleteProduct, getToken, resendInvite,
  updateBranch, updateProcess, updateProduct, MOVEMENT_LABELS,
  type Alert, type Branch, type MovementType, type Process, type Product, type RecipeItem, type Worker,
} from '../lib/api'
import Carpi, { CarpiHead } from '../components/Carpi'
import ThemeToggle from '../components/ThemeToggle'
import Mostrador from './Mostrador'
import Remitos from './Remitos'

type InvRow = { branch_id: string; product_id: string; current_stock: number }
type Movement = {
  id: string
  branch_id: string
  product_id: string
  type: string
  quantity: number
  manager_name: string
  reason: string | null
  created_at: string
}
type Tab = 'alertas' | 'stock' | 'movimientos' | 'sucursales' | 'procesos'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// NUMERIC de Postgres llega como float: recorta artefactos (0.30000000000000004)
const fmt = (n: number) => +n.toFixed(2)

const typeLabel = (t: string) => MOVEMENT_LABELS[t as MovementType] ?? t.replace(/_/g, ' ')
const reasonLabel = (r: string | null) => (r ? (r[0]!.toUpperCase() + r.slice(1)).replace(/_/g, ' ') : '')

const input = 'input px-2 py-1.5'
const th = 'p-2 font-pixel font-medium'
const sectionTitle = 'font-pixel font-bold text-lg mb-2'

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('alertas')
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [processes, setProcesses] = useState<Process[]>([])
  const [inventory, setInventory] = useState<InvRow[]>([])
  const [alerts, setAlerts] = useState<Alert[] | null>(null) // null = todavía no se cargaron
  const [team, setTeam] = useState<Worker[]>([])
  const [movements, setMovements] = useState<Movement[] | null>(null) // null = todavía no se buscó
  const [searching, setSearching] = useState(false)
  const [pushOn, setPushOn] = useState(false)
  const [f, setF] = useState({ branch: '', product: '', from: '', to: '', hourFrom: '', hourTo: '' })
  const [editing, setEditing] = useState<Product | null>(null)
  const [alertsBranchFilter, setAlertsBranchFilter] = useState('')
  const [loadError, setLoadError] = useState('')
  const [viewAsBranch, setViewAsBranch] = useState<Branch | null>(null)

  const load = useCallback(async () => {
    const fetchAll = () =>
      Promise.all([
        api<Branch[]>('/branches'),
        api<Product[]>('/products'),
        api<InvRow[]>('/inventory'),
        api<Alert[]>('/alerts'),
        api<Worker[]>('/team'),
        api<Process[]>('/processes'),
      ])
    try {
      const [b, p, inv, al, tm, pr] = await fetchAll().catch(async (firstErr) => {
        await new Promise((r) => setTimeout(r, 1000))
        return fetchAll().catch(() => {
          throw firstErr
        })
      })
      setBranches(b)
      setProducts(p)
      setInventory(inv)
      setAlerts(al)
      setTeam(tm)
      setProcesses(pr)
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    load()
    // si ya hay una suscripción push en este navegador, reflejarla
    navigator.serviceWorker?.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => s && setPushOn(true))
      .catch(() => {})
    // alertas en vivo por SSE (EventSource no admite headers → token en query)
    const es = new EventSource('/api/events?token=' + getToken())
    es.onmessage = (e) => setAlerts((a) => [JSON.parse(e.data) as Alert, ...(a ?? [])])
    return () => es.close()
  }, [load])

  const loadMovements = useCallback(async (filters = f) => {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (filters.branch) params.set('branch', filters.branch)
      if (filters.product) params.set('product', filters.product)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      let rows = await api<Movement[]>('/movements?' + params)
      if (filters.hourFrom) rows = rows.filter((m) => new Date(m.created_at).getHours() >= Number(filters.hourFrom))
      if (filters.hourTo) rows = rows.filter((m) => new Date(m.created_at).getHours() <= Number(filters.hourTo))
      setMovements(rows)
    } finally {
      setSearching(false)
    }
  }, [f])

  function goToMovements(branchId: string) {
    const next = { ...f, branch: branchId }
    setF(next)
    setTab('movimientos')
    loadMovements(next)
  }

  function goToAlerts(branchId: string) {
    setAlertsBranchFilter(branchId)
    setTab('alertas')
  }

  async function resolveAlert(id: string) {
    await api(`/alerts/${id}/resolve`, { method: 'PATCH' })
    setAlerts((a) => a && a.filter((x) => x.id !== id))
  }

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      window.alert('Este navegador no soporta notificaciones push.')
      return
    }
    const { key } = await api<{ key: string | null }>('/vapid-public-key')
    if (!key) {
      window.alert('El servidor no tiene configuradas las claves VAPID (ver README).')
      return
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
    await api('/push-subscriptions', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
    setPushOn(true)
  }

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? '—'

  const iconBtn = 'p-2 rounded-md cursor-pointer text-soft hover:text-ink hover:bg-sunken'
  const tabClass = (active: boolean) =>
    `font-pixel flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 cursor-pointer transition-colors duration-150 ${
      active
        ? 'bg-accent text-on-accent border-line shadow-px-sm'
        : 'border-transparent text-soft hover:text-ink hover:bg-sunken'
    }`

  if (viewAsBranch) return <ViewAsEncargado branch={viewAsBranch} onExit={() => setViewAsBranch(null)} />

  return (
    <div className="min-h-screen">
      <header className="bg-surface border-b-2 border-line flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <CarpiHead size={42} />
          <div className="min-w-0">
            <h1 className="font-pixel font-bold text-lg leading-tight text-accent truncate">STOCKCITO</h1>
            <p className="text-xs text-soft">Panel de administración</p>
          </div>
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          <button
            onClick={enablePush}
            disabled={pushOn}
            title={pushOn ? 'Notificaciones activas' : 'Activar notificaciones'}
            aria-label={pushOn ? 'Notificaciones activas' : 'Activar notificaciones'}
            className={`${iconBtn} flex items-center gap-1 disabled:opacity-70 disabled:pointer-events-none`}
          >
            {pushOn ? <BellRing size={16} /> : <Bell size={16} />}
            <span className="hidden sm:inline text-sm">{pushOn ? 'Notificaciones ON' : 'Activar notificaciones'}</span>
          </button>
          <button onClick={load} title="Refrescar" aria-label="Refrescar" className={iconBtn}>
            <RefreshCw size={16} />
          </button>
          <ThemeToggle />
          <button onClick={onLogout} title="Salir" aria-label="Salir" className={iconBtn}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <nav className="bg-surface border-b-2 border-line flex gap-1.5 px-4 py-2 overflow-x-auto">
        <button onClick={() => setTab('alertas')} className={tabClass(tab === 'alertas')}>
          <AlertTriangle size={16} /> Alertas{alerts && alerts.length > 0 && ` (${alerts.length})`}
        </button>
        <button onClick={() => setTab('stock')} className={tabClass(tab === 'stock')}>
          <Boxes size={16} /> Stock
        </button>
        <button onClick={() => setTab('movimientos')} className={tabClass(tab === 'movimientos')}>
          <Repeat size={16} /> Movimientos
        </button>
        <button onClick={() => setTab('sucursales')} className={tabClass(tab === 'sucursales')}>
          <Building2 size={16} /> Sucursales
        </button>
        <button onClick={() => setTab('procesos')} className={tabClass(tab === 'procesos')}>
          <Cog size={16} /> Procesos
        </button>
      </nav>

      <main className="max-w-6xl mx-auto p-4">
        {loadError && (
          <p className="text-danger bg-danger-soft border-2 border-danger/40 rounded-md p-2 text-sm mb-4">
            No se pudo cargar los datos: {loadError}
          </p>
        )}
        {tab === 'alertas' && (
          <AlertasTab
            alerts={alerts} branches={branches} products={products} branchName={branchName}
            onResolve={resolveAlert} onChanged={load}
            branchFilter={alertsBranchFilter} setBranchFilter={setAlertsBranchFilter}
          />
        )}
        {tab === 'stock' && (
          <StockTab branches={branches} products={products} processes={processes} inventory={inventory} onEdit={setEditing} onChanged={load} />
        )}
        {tab === 'movimientos' && (
          <MovimientosTab
            branches={branches} products={products} movements={movements} searching={searching}
            f={f} setF={setF} onSearch={() => loadMovements()} branchName={branchName} productName={productName}
          />
        )}
        {tab === 'sucursales' && (
          <SucursalesTab
            branches={branches} team={team} alerts={alerts ?? []} products={products} inventory={inventory}
            onChanged={load} onViewMovements={goToMovements} onViewAlerts={goToAlerts} onViewAsEncargado={setViewAsBranch}
          />
        )}
        {tab === 'procesos' && <ProcesosTab processes={processes} products={products} onChanged={load} />}
      </main>

      {editing && (
        <EditProductModal
          product={editing}
          processes={processes}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function AlertasTab({ alerts, branches, products, branchName, onResolve, onChanged, branchFilter, setBranchFilter }: {
  alerts: Alert[] | null; branches: Branch[]; products: Product[]; branchName: (id: string) => string
  onResolve: (id: string) => void; onChanged: () => void
  branchFilter: string; setBranchFilter: (id: string) => void
}) {
  const [form, setForm] = useState({ branch_id: '', product_id: '', type: 'stock_critico' as Alert['type'], message: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // alerts null = todavía no respondió el servidor: nunca mostrar "sin alertas" antes de saberlo de verdad
  const shownAlerts = alerts === null ? null : branchFilter ? alerts.filter((a) => a.branch_id === branchFilter) : alerts

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await createAlert(form)
      setForm({ branch_id: '', product_id: '', type: 'stock_critico', message: '' })
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className={sectionTitle}>Nueva alerta</h2>
        <form onSubmit={submit} className="flex flex-wrap gap-2 items-center">
          <select required value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} aria-label="Sucursal" className={input}>
            <option value="">Sucursal…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} aria-label="Producto" className={input}>
            <option value="">Producto…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Alert['type'] })} aria-label="Tipo de alerta" className={input}>
            <option value="stock_critico">Stock crítico</option>
            <option value="desvio_remito">Desvío de remito</option>
          </select>
          <input required placeholder="Mensaje" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={`${input} flex-1 min-w-[12rem]`} />
          <button disabled={busy} className="btn btn-primary px-4 py-1.5">{busy ? 'Creando…' : 'Crear'}</button>
        </form>
        {err && <p className="text-danger text-sm mt-2">{err}</p>}
      </section>

      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className={sectionTitle + ' mb-0'}>
            Alertas {shownAlerts !== null && `(${shownAlerts.length})`}{branchFilter && ` · ${branchName(branchFilter)}`}
          </h2>
          {branchFilter && (
            <button onClick={() => setBranchFilter('')} className="text-xs text-accent hover:underline cursor-pointer">
              Ver todas
            </button>
          )}
        </div>
        <ul className="space-y-2">
          {shownAlerts === null && (
            <li className="text-center text-soft py-8 list-none">Cargando alertas…</li>
          )}
          {shownAlerts?.map((a) => (
            <li key={a.id} className="panel p-3 flex items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-1.5 w-2 h-2 shrink-0 ${a.type === 'stock_critico' ? 'bg-danger' : 'bg-accent'}`}
                />
                <div>
                  <p className="text-sm">{a.message}</p>
                  <p className="text-xs text-soft">
                    {branchName(a.branch_id)} · {new Date(a.created_at).toLocaleString('es-AR')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onResolve(a.id)}
                title="Marcar resuelta"
                aria-label="Marcar alerta resuelta"
                className="p-2 text-ok hover:bg-ok-soft rounded-md shrink-0 cursor-pointer"
              >
                <Check size={18} />
              </button>
            </li>
          ))}
          {shownAlerts !== null && shownAlerts.length === 0 && (
            <li className="flex items-center gap-3 text-soft text-sm list-none">
              <Carpi size={56} title="Carpi tranquilo, sin alertas" />
              <p>Sin alertas pendientes. Carpi está tranquilo.</p>
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}

// Selector de proceso + "es materia prima" + receta, compartido entre el
// alta de producto y su edición. Si no hay procesos creados, no se muestra
// nada: los negocios sin producción propia no ven este bloque.
function ProcessFields({ processes, products, excludeProductId, processId, setProcessId, isRawMaterial, setIsRawMaterial, recipe, setRecipe }: {
  processes: Process[]; products: Product[]; excludeProductId?: string
  processId: string; setProcessId: (v: string) => void
  isRawMaterial: boolean; setIsRawMaterial: (v: boolean) => void
  recipe: RecipeItem[]; setRecipe: (r: RecipeItem[]) => void
}) {
  if (processes.length === 0) return null
  const candidates = products.filter((p) => p.process_id && p.process_id !== processId && p.id !== excludeProductId)
  return (
    <div className="space-y-2 pt-2 border-t border-line/50">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={processId} onChange={(e) => setProcessId(e.target.value)} aria-label="Proceso" className={input}>
          <option value="">Sin proceso</option>
          {processes.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
        </select>
        {processId && (
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={isRawMaterial} onChange={(e) => setIsRawMaterial(e.target.checked)} />
            Es materia prima
          </label>
        )}
      </div>
      {processId && !isRawMaterial && <RecipeBuilder recipe={recipe} setRecipe={setRecipe} candidates={candidates} />}
    </div>
  )
}

function RecipeBuilder({ recipe, setRecipe, candidates }: {
  recipe: RecipeItem[]; setRecipe: (r: RecipeItem[]) => void; candidates: Product[]
}) {
  const updateRow = (i: number, patch: Partial<RecipeItem>) => setRecipe(recipe.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-pixel text-soft">Insumos (de otros procesos)</p>
      {candidates.length === 0 && <p className="text-xs text-soft">No hay productos de otros procesos todavía.</p>}
      {recipe.map((item, i) => {
        const ingredient = candidates.find((c) => c.id === item.ingredient_id)
        // cada fila oculta los insumos que ya eligieron las demás — así no se puede repetir uno
        const usedElsewhere = new Set(recipe.filter((_, j) => j !== i).map((r) => r.ingredient_id))
        const options = candidates.filter((c) => !usedElsewhere.has(c.id))
        return (
          <div key={i} className="flex gap-1.5 items-center">
            <select required value={item.ingredient_id} onChange={(e) => updateRow(i, { ingredient_id: e.target.value })} aria-label="Insumo" className={`${input} flex-1 min-w-0`}>
              <option value="">Insumo…</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              required type="number" min="0.001" step="any"
              placeholder={ingredient ? `Cantidad (${ingredient.unit})` : 'Cantidad'}
              aria-label="Cantidad de insumo" value={item.quantity || ''}
              onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
              className={`${input} w-32`}
            />
            <button type="button" onClick={() => setRecipe(recipe.filter((_, j) => j !== i))} aria-label="Quitar insumo" className="p-1.5 text-danger hover:bg-danger-soft rounded-md cursor-pointer">
              <Trash2 size={14} />
            </button>
          </div>
        )
      })}
      {recipe.length < candidates.length && (
        <button type="button" onClick={() => setRecipe([...recipe, { ingredient_id: '', quantity: 0 }])} className="text-xs text-accent hover:underline cursor-pointer">
          + Agregar insumo
        </button>
      )}
    </div>
  )
}

function StockTab({ branches, products, processes, inventory, onEdit, onChanged }: {
  branches: Branch[]; products: Product[]; processes: Process[]; inventory: InvRow[]
  onEdit: (p: Product) => void; onChanged: () => void
}) {
  const [branchFilter, setBranchFilter] = useState('')
  const [processFilter, setProcessFilter] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ name: '', category: '', unit: '', min: '' })
  const [processId, setProcessId] = useState('')
  const [isRawMaterial, setIsRawMaterial] = useState(true)
  const [recipe, setRecipe] = useState<RecipeItem[]>([])
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [confirming, setConfirming] = useState<ConfirmState>(null)

  const shownBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches
  const q = search.trim().toLowerCase()
  const shownProducts = products
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q))
    .filter((p) => !processFilter || p.process_id === processFilter)
  const stockOf = (productId: string, branchId: string) =>
    inventory.find((i) => i.product_id === productId && i.branch_id === branchId)?.current_stock ?? 0
  const processName = (id: string | null) => processes.find((pr) => pr.id === id)?.name

  async function addProduct(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    try {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          category: form.category || null,
          unit: form.unit,
          min_stock_threshold: form.min === '' ? 0 : Number(form.min),
          process_id: processId || null,
          is_raw_material: isRawMaterial,
          recipe: processId && !isRawMaterial ? recipe : [],
        }),
      })
      setForm({ name: '', category: '', unit: '', min: '' })
      setProcessId('')
      setIsRawMaterial(true)
      setRecipe([])
      setMsg({ text: 'Producto creado.', kind: 'ok' })
      onChanged()
    } catch (e) {
      setMsg({ text: 'Error: ' + (e as Error).message, kind: 'err' })
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className={sectionTitle}>Nuevo producto</h2>
        <form onSubmit={addProduct} className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input required placeholder="Nombre" aria-label="Nombre del producto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <input placeholder="Categoría" aria-label="Categoría" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input} />
          <input required placeholder="Unidad (kg, plancha…)" aria-label="Unidad" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={input} />
          <input type="number" min="0" step="any" placeholder="Stock mínimo" aria-label="Stock mínimo" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} className={`${input} w-32`} />
        </div>
        <ProcessFields
          processes={processes} products={products}
          processId={processId} setProcessId={setProcessId}
          isRawMaterial={isRawMaterial} setIsRawMaterial={setIsRawMaterial}
          recipe={recipe} setRecipe={setRecipe}
        />
        <button className="btn btn-primary px-4 py-1.5">Crear</button>
        </form>
        {msg && (
          <p className={`text-sm rounded-md border-2 p-2 mt-2 ${msg.kind === 'ok' ? 'text-ok bg-ok-soft border-ok/40' : 'text-danger bg-danger-soft border-danger/40'}`}>
            {msg.text}
          </p>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className={sectionTitle + ' mb-0'}>Stock consolidado</h2>
          <div className="flex gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-soft" />
              <input
                placeholder="Buscar producto o categoría…"
                aria-label="Buscar producto"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${input} pl-7`}
              />
            </div>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="Filtrar por sucursal" className={input}>
              <option value="">Todas las sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {processes.length > 0 && (
              <select value={processFilter} onChange={(e) => setProcessFilter(e.target.value)} aria-label="Filtrar por proceso" className={input}>
                <option value="">Todos los procesos</option>
                {processes.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-left border-b-2 border-line">
              <tr>
                <th className="p-2 w-20"></th>
                <th className={th}>Producto</th>
                {shownBranches.map((b) => (
                  <th key={b.id} className={th}>{b.name}</th>
                ))}
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {shownProducts.map((p) => {
                const total = shownBranches.reduce((s, b) => s + stockOf(p.id, b.id), 0)
                return (
                  <tr key={p.id} className="border-t border-line/50">
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => onEdit(p)}
                          title="Editar producto"
                          aria-label={`Editar ${p.name}`}
                          className="p-1.5 text-soft hover:bg-sunken rounded-md cursor-pointer"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirming({
                            message: `¿Eliminar "${p.name}"? No se borra el historial, solo deja de aparecer en las listas.`,
                            onConfirm: () => {
                              setConfirming(null)
                              deleteProduct(p.id).then(onChanged).catch((e) => setMsg({ text: 'Error: ' + (e as Error).message, kind: 'err' }))
                            },
                          })}
                          title="Eliminar producto"
                          aria-label={`Eliminar ${p.name}`}
                          className="p-1.5 text-danger hover:bg-danger-soft rounded-md cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="p-2 font-medium">
                      {p.name}
                      {p.process_id && (
                        <span className="ml-1.5 text-xs font-normal text-soft bg-sunken rounded px-1.5 py-0.5 whitespace-nowrap">
                          {processName(p.process_id)} · {p.is_raw_material ? 'materia prima' : 'fabricado'}
                        </span>
                      )}
                    </td>
                    {shownBranches.map((b) => {
                      const s = stockOf(p.id, b.id)
                      return (
                        <td key={b.id} className={`p-2 ${s < p.min_stock_threshold ? 'text-danger font-semibold' : ''}`}>
                          {fmt(s)}
                        </td>
                      )
                    })}
                    <td className="p-2 font-semibold">{fmt(total)} {p.unit}</td>
                  </tr>
                )
              })}
              {shownProducts.length === 0 && (
                <tr>
                  <td colSpan={shownBranches.length + 2} className="p-4 text-center text-soft">
                    {products.length === 0 ? 'Todavía no hay productos — crealos arriba.' : 'Sin resultados para esa búsqueda.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {confirming && <ConfirmModal message={confirming.message} onConfirm={confirming.onConfirm} onCancel={() => setConfirming(null)} />}
    </div>
  )
}

function ProcesosTab({ processes, products, onChanged }: { processes: Process[]; products: Product[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirming, setConfirming] = useState<ConfirmState>(null)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null)
    try {
      await fn()
      setMsg({ text: ok, kind: 'ok' })
      onChanged()
    } catch (e) {
      setMsg({ text: 'Error: ' + (e as Error).message, kind: 'err' })
    }
  }

  function addProcess(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await createProcess(name.trim())
      setName('')
    }, 'Proceso creado.')
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault()
    run(() => updateProcess(editingId!, editingName.trim()), 'Proceso actualizado.').then(() => setEditingId(null))
  }

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className={sectionTitle}>Nuevo proceso</h2>
        <form onSubmit={addProcess} className="flex flex-wrap gap-2 items-center">
          <input required placeholder="Nombre (ej: Materia prima, Panadería…)" aria-label="Nombre del proceso" value={name} onChange={(e) => setName(e.target.value)} className={`${input} flex-1 min-w-[16rem]`} />
          <button className="btn btn-primary px-4 py-1.5">Crear</button>
        </form>
        {msg && (
          <p className={`text-sm rounded-md border-2 p-2 mt-2 ${msg.kind === 'ok' ? 'text-ok bg-ok-soft border-ok/40' : 'text-danger bg-danger-soft border-danger/40'}`}>
            {msg.text}
          </p>
        )}
      </section>

      <section>
        <h2 className={sectionTitle}>Procesos ({processes.length})</h2>
        <ul className="space-y-2">
          {processes.map((p) => {
            const count = products.filter((pr) => pr.process_id === p.id).length
            return (
              <li key={p.id} className="panel p-3">
                {editingId === p.id ? (
                  <form onSubmit={saveEdit} className="flex gap-2 items-center">
                    <input required autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)} aria-label="Nombre del proceso" className={`${input} flex-1`} />
                    <button type="button" onClick={() => setEditingId(null)} className="btn btn-ghost px-3 py-1 text-sm">Cancelar</button>
                    <button className="btn btn-primary px-3 py-1 text-sm">Guardar</button>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-soft">{count} producto{count === 1 ? '' : 's'}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setEditingId(p.id); setEditingName(p.name) }}
                          title="Editar proceso" aria-label={`Editar ${p.name}`}
                          className="p-1.5 text-soft hover:bg-sunken rounded-md cursor-pointer"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirming({
                            message: `¿Eliminar el proceso "${p.name}"? Solo se puede si no tiene productos asignados.`,
                            onConfirm: () => { setConfirming(null); run(() => deleteProcess(p.id), 'Proceso eliminado.') },
                          })}
                          title="Eliminar proceso" aria-label={`Eliminar ${p.name}`}
                          className="p-1.5 text-danger hover:bg-danger-soft rounded-md cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {count > 0 && (
                      <ul className="mt-2 pl-3 border-l-2 border-line/50 space-y-1.5">
                        {products.filter((pr) => pr.process_id === p.id).map((pr) => (
                          <li key={pr.id} className="text-sm">
                            <span className="font-medium">{pr.name}</span>
                            <span className="text-xs text-soft"> — {pr.is_raw_material ? 'materia prima' : 'fabricado'}</span>
                            {!pr.is_raw_material && (
                              pr.recipe.length === 0 ? (
                                <p className="text-xs text-warn pl-2">Sin receta definida.</p>
                              ) : (
                                <p className="text-xs text-soft pl-2">
                                  {pr.recipe
                                    .map((r) => {
                                      const ing = products.find((x) => x.id === r.ingredient_id)
                                      return ing ? `${ing.name} (${fmt(r.quantity)} ${ing.unit})` : null
                                    })
                                    .filter(Boolean)
                                    .join(', ')}
                                </p>
                              )
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            )
          })}
          {processes.length === 0 && <p className="text-soft text-sm">Todavía no hay procesos — creá uno arriba.</p>}
        </ul>
      </section>
      {confirming && <ConfirmModal message={confirming.message} onConfirm={confirming.onConfirm} onCancel={() => setConfirming(null)} />}
    </div>
  )
}

type MovementFilters = { branch: string; product: string; from: string; to: string; hourFrom: string; hourTo: string }

const MOVEMENTS_PAGE_SIZE = 20

function MovimientosTab({ branches, products, movements, searching, f, setF, onSearch, branchName, productName }: {
  branches: Branch[]; products: Product[]; movements: Movement[] | null; searching: boolean
  f: MovementFilters; setF: (f: MovementFilters) => void; onSearch: () => void
  branchName: (id: string) => string; productName: (id: string) => string
}) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [movements])

  const pageCount = Math.max(1, Math.ceil((movements?.length ?? 0) / MOVEMENTS_PAGE_SIZE))
  const shown = (movements ?? []).slice(page * MOVEMENTS_PAGE_SIZE, (page + 1) * MOVEMENTS_PAGE_SIZE)

  return (
    <section>
      <h2 className={sectionTitle}>
        Movimientos{movements !== null && ` (${movements.length}${movements.length === 200 ? ', últimos 200' : ''})`}
      </h2>
      <div className="flex flex-wrap gap-2 mb-2">
        <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} aria-label="Filtrar por sucursal" className={input}>
          <option value="">Todas las sucursales</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} aria-label="Filtrar por producto" className={input}>
          <option value="">Todos los productos</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde fecha" className={input} />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta fecha" className={input} />
        <input type="number" min="0" max="23" placeholder="Hora desde" value={f.hourFrom} onChange={(e) => setF({ ...f, hourFrom: e.target.value })} aria-label="Desde hora" className={`${input} w-28`} />
        <input type="number" min="0" max="23" placeholder="Hora hasta" value={f.hourTo} onChange={(e) => setF({ ...f, hourTo: e.target.value })} aria-label="Hasta hora" className={`${input} w-28`} />
        <button onClick={onSearch} disabled={searching} className="btn btn-primary px-4 py-1.5">
          {searching ? 'Buscando…' : 'Buscar'}
        </button>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-left border-b-2 border-line">
            <tr>
              <th className={th}>Fecha</th>
              <th className={th}>Sucursal</th>
              <th className={th}>Producto</th>
              <th className={th}>Tipo</th>
              <th className={th}>Cantidad</th>
              <th className={th}>Encargado</th>
              <th className={th}>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} className="border-t border-line/50">
                <td className="p-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString('es-AR')}</td>
                <td className="p-2">{branchName(m.branch_id)}</td>
                <td className="p-2">{productName(m.product_id)}</td>
                <td className="p-2">{typeLabel(m.type)}</td>
                <td className="p-2 tabular-nums">{fmt(m.quantity)}</td>
                <td className="p-2">{m.manager_name}</td>
                <td className="p-2">{reasonLabel(m.reason)}</td>
              </tr>
            ))}
            {movements === null && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-soft">Usá los filtros y presioná Buscar.</td>
              </tr>
            )}
            {movements !== null && movements.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-soft">Sin movimientos para esos filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {movements !== null && movements.length > 0 && (
        <div className="flex items-center justify-center gap-3 mt-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-ghost px-3 py-1">
            ← Anterior
          </button>
          <input
            type="range"
            min={0}
            max={pageCount - 1}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            aria-label="Página de movimientos"
            className="w-40 accent-accent"
          />
          <span className="text-sm text-soft whitespace-nowrap">Página {page + 1} de {pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="btn btn-ghost px-3 py-1">
            Siguiente →
          </button>
        </div>
      )}
    </section>
  )
}

function SucursalesTab({ branches, team, alerts, products, inventory, onChanged, onViewMovements, onViewAlerts, onViewAsEncargado }: {
  branches: Branch[]; team: Worker[]; alerts: Alert[]; products: Product[]; inventory: InvRow[]
  onChanged: () => void; onViewMovements: (branchId: string) => void; onViewAlerts: (branchId: string) => void
  onViewAsEncargado: (branch: Branch) => void
}) {
  const [form, setForm] = useState({ name: '', address: '' })
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)

  async function addBranch(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    try {
      await api('/branches', { method: 'POST', body: JSON.stringify(form) })
      setForm({ name: '', address: '' })
      setMsg({ text: 'Sucursal creada.', kind: 'ok' })
      onChanged()
    } catch (e) {
      setMsg({ text: 'Error: ' + (e as Error).message, kind: 'err' })
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className={sectionTitle}>Nueva sucursal</h2>
        <form onSubmit={addBranch} className="flex flex-wrap gap-2 items-center">
          <input required placeholder="Nombre" aria-label="Nombre de la sucursal" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <input placeholder="Dirección" aria-label="Dirección" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={input} />
          <button className="btn btn-primary px-4 py-1.5">Crear</button>
        </form>
        {msg && (
          <p className={`text-sm rounded-md border-2 p-2 mt-2 ${msg.kind === 'ok' ? 'text-ok bg-ok-soft border-ok/40' : 'text-danger bg-danger-soft border-danger/40'}`}>
            {msg.text}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((b) => (
          <BranchCard
            key={b.id}
            branch={b}
            team={team.filter((w) => w.branch_id === b.id)}
            alerts={alerts.filter((a) => a.branch_id === b.id)}
            products={products}
            inventory={inventory.filter((i) => i.branch_id === b.id)}
            onChanged={onChanged}
            onViewMovements={() => onViewMovements(b.id)}
            onViewAlerts={() => onViewAlerts(b.id)}
            onViewAsEncargado={() => onViewAsEncargado(b)}
          />
        ))}
        {branches.length === 0 && <p className="text-soft text-sm">Todavía no hay sucursales — creá una arriba.</p>}
      </div>
    </div>
  )
}

function BranchCard({ branch, team, alerts, products, inventory, onChanged, onViewMovements, onViewAlerts, onViewAsEncargado }: {
  branch: Branch; team: Worker[]; alerts: Alert[]; products: Product[]; inventory: InvRow[]
  onChanged: () => void; onViewMovements: () => void; onViewAlerts: () => void; onViewAsEncargado: () => void
}) {
  const [invite, setInvite] = useState({ name: '', email: '' })
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [editingBranch, setEditingBranch] = useState(false)
  const [branchForm, setBranchForm] = useState({ name: branch.name, address: branch.address ?? '' })
  const [confirming, setConfirming] = useState<ConfirmState>(null)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null)
    try {
      await fn()
      setMsg({ text: ok, kind: 'ok' })
      onChanged()
    } catch (e) {
      setMsg({ text: 'Error: ' + (e as Error).message, kind: 'err' })
    }
  }

  async function saveBranch(e: FormEvent) {
    e.preventDefault()
    await run(() => updateBranch(branch.id, { name: branchForm.name.trim(), address: branchForm.address.trim() || null }), 'Sucursal actualizada.')
    setEditingBranch(false)
  }

  function sendInvite(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await api('/invite', { method: 'POST', body: JSON.stringify({ ...invite, branch_id: branch.id }) })
      setInvite({ name: '', email: '' })
    }, 'Invitación enviada.')
  }

  const stockRows = products
    .map((p) => ({ p, s: inventory.find((i) => i.product_id === p.id)?.current_stock ?? 0 }))
    .filter(({ s }) => s > 0)

  return (
    <div className="card p-4 space-y-3">
      {editingBranch ? (
        <form onSubmit={saveBranch} className="space-y-1.5">
          <input required aria-label="Nombre de la sucursal" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} className={`${input} w-full`} />
          <input aria-label="Dirección" placeholder="Dirección" value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} className={`${input} w-full`} />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditingBranch(false)} className="btn btn-ghost px-3 py-1 text-sm">Cancelar</button>
            <button className="btn btn-primary px-3 py-1 text-sm">Guardar</button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-pixel font-bold truncate">{branch.name}</h3>
            {branch.address && <p className="text-xs text-soft truncate">{branch.address}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {alerts.length > 0 && (
              <button onClick={onViewAlerts} className="text-xs text-danger bg-danger-soft rounded px-1.5 py-0.5 shrink-0 cursor-pointer">
                {alerts.length} alerta{alerts.length > 1 ? 's' : ''}
              </button>
            )}
            <button
              onClick={() => setEditingBranch(true)}
              title="Editar sucursal"
              aria-label={`Editar ${branch.name}`}
              className="p-1.5 text-soft hover:bg-sunken rounded-md cursor-pointer"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setConfirming({
                message: `¿Eliminar "${branch.name}"? Solo se puede si no tiene encargados, stock ni movimientos asociados.`,
                onConfirm: () => { setConfirming(null); run(() => deleteBranch(branch.id), 'Sucursal eliminada.') },
              })}
              title="Eliminar sucursal"
              aria-label={`Eliminar ${branch.name}`}
              className="p-1.5 text-danger hover:bg-danger-soft rounded-md cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-pixel text-soft mb-1">Stock</p>
        {stockRows.length === 0 ? (
          <p className="text-sm text-soft">Sin stock cargado.</p>
        ) : (
          <ul className="text-sm space-y-0.5 max-h-32 overflow-y-auto scroll-accent pr-2">
            {stockRows.map(({ p, s }) => (
              <li key={p.id} className={`flex justify-between gap-2 ${s < p.min_stock_threshold ? 'text-danger font-semibold' : ''}`}>
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums shrink-0">{fmt(s)} {p.unit}</span>
              </li>
            ))}
          </ul>
        )}
        <button onClick={onViewMovements} className="text-xs text-accent hover:underline mt-1 cursor-pointer">
          Ver movimientos →
        </button>
      </div>

      <div>
        <p className="text-xs font-pixel text-soft mb-1">Encargados</p>
        {team.length === 0 && <p className="text-sm text-soft">Sin encargados.</p>}
        <ul className="text-sm space-y-1">
          {team.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {w.name}
                {!w.verified && <span className="ml-1 text-xs text-warn">(pendiente)</span>}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <button
                  title={w.verified ? 'Reenviar link para cambiar contraseña' : 'Reenviar invitación'}
                  aria-label={`Reenviar invitación a ${w.name}`}
                  onClick={() => run(() => resendInvite(w.id), 'Invitación reenviada.')}
                  className="p-1 text-soft hover:bg-sunken rounded-md cursor-pointer"
                >
                  <Mail size={14} />
                </button>
                <button
                  title="Eliminar cuenta"
                  aria-label={`Eliminar cuenta de ${w.name}`}
                  onClick={() => setConfirming({
                    message: `¿Eliminar la cuenta de ${w.name}?`,
                    onConfirm: () => { setConfirming(null); run(() => api(`/team/${w.id}`, { method: 'DELETE' }), 'Cuenta eliminada.') },
                  })}
                  className="p-1 text-danger hover:bg-danger-soft rounded-md cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={sendInvite} className="flex gap-1.5 mt-2">
          <input required placeholder="Nombre" aria-label={`Nombre del encargado para ${branch.name}`} value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} className={`${input} text-sm min-w-0`} />
          <input type="email" required placeholder="Email" aria-label={`Email del encargado para ${branch.name}`} value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={`${input} text-sm min-w-0`} />
          <button className="btn btn-primary px-3 py-1.5 text-sm shrink-0">Invitar</button>
        </form>
      </div>

      <button onClick={onViewAsEncargado} className="btn btn-ghost w-full text-sm py-1.5">
        Vista de encargado →
      </button>

      {msg && <p className={`text-xs ${msg.kind === 'ok' ? 'text-ok' : 'text-danger'}`}>{msg.text}</p>}
      {confirming && <ConfirmModal message={confirming.message} onConfirm={confirming.onConfirm} onCancel={() => setConfirming(null)} />}
    </div>
  )
}

function ViewAsEncargado({ branch, onExit }: { branch: Branch; onExit: () => void }) {
  const [tab, setTab] = useState<'mostrador' | 'remitos'>('mostrador')
  const tabClass = (active: boolean) =>
    `font-pixel flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 cursor-pointer transition-colors duration-150 ${
      active
        ? 'bg-accent text-on-accent border-line shadow-px-sm'
        : 'border-transparent text-soft hover:text-ink hover:bg-sunken'
    }`

  return (
    <div className="min-h-screen">
      <header className="bg-surface border-b-2 border-line flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <CarpiHead size={42} />
          <div className="min-w-0">
            <h1 className="font-pixel font-bold text-lg leading-tight text-accent truncate">STOCKCITO</h1>
            <p className="text-xs text-soft truncate">Vista de encargado · {branch.name}</p>
          </div>
        </div>
        <nav className="flex gap-1.5 items-center shrink-0">
          <button onClick={() => setTab('mostrador')} className={tabClass(tab === 'mostrador')}>
            <ClipboardList size={16} /> Mostrador
          </button>
          <button onClick={() => setTab('remitos')} className={tabClass(tab === 'remitos')}>
            <FileText size={16} /> Remitos
          </button>
          <ThemeToggle />
          <button onClick={onExit} className="btn btn-ghost px-3 py-1.5 text-sm">
            ← Volver al panel
          </button>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto p-4">
        {tab === 'mostrador' ? <Mostrador branchId={branch.id} /> : <Remitos branchId={branch.id} />}
      </main>
    </div>
  )
}

// Reemplaza confirm() nativo en las acciones destructivas: mismo look que el
// resto de los modales de la app (antes esos borrados rompían la identidad
// visual saliendo al diálogo crudo del navegador).
type ConfirmState = { message: string; onConfirm: () => void } | null

function ConfirmModal({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar acción"
        className="card p-6 w-full max-w-sm space-y-4"
      >
        <p className="text-sm">{message}</p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="btn btn-ghost px-4 py-1.5">Cancelar</button>
          <button type="button" onClick={onConfirm} className="btn btn-primary px-4 py-1.5">Confirmar</button>
        </div>
      </div>
    </div>
  )
}

function EditProductModal({ product, processes, products, onClose, onSaved }: {
  product: Product; processes: Process[]; products: Product[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: product.name,
    category: product.category ?? '',
    unit: product.unit,
    min: String(product.min_stock_threshold),
  })
  const [processId, setProcessId] = useState(product.process_id ?? '')
  const [isRawMaterial, setIsRawMaterial] = useState(product.is_raw_material)
  const [recipe, setRecipe] = useState<RecipeItem[]>(product.recipe)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await updateProduct(product.id, {
        name: form.name.trim(),
        category: form.category.trim() || null,
        unit: form.unit,
        min_stock_threshold: form.min === '' ? 0 : Number(form.min),
        process_id: processId || null,
        is_raw_material: isRawMaterial,
        recipe: processId && !isRawMaterial ? recipe : [],
      })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card p-6 w-full max-w-md space-y-3"
      >
        <h2 className="font-pixel text-lg">Editar producto</h2>
        <input required placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full px-3 py-2" />
        <input placeholder="Categoría" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input w-full px-3 py-2" />
        <input required placeholder="Unidad (kg, plancha…)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="input w-full px-3 py-2" />
        <input type="number" min="0" step="any" placeholder="Stock mínimo" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} className="input w-full px-3 py-2" />
        <ProcessFields
          processes={processes} products={products} excludeProductId={product.id}
          processId={processId} setProcessId={setProcessId}
          isRawMaterial={isRawMaterial} setIsRawMaterial={setIsRawMaterial}
          recipe={recipe} setRecipe={setRecipe}
        />
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn btn-ghost px-4 py-1.5">Cancelar</button>
          <button disabled={busy} className="btn btn-primary px-4 py-1.5">
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
