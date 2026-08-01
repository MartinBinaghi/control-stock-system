import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Bell, BellRing, Check, LogOut, RefreshCw, Trash2, Pencil } from 'lucide-react'
import { api, getToken, deleteProduct, updateProduct, MOVEMENT_LABELS, type Alert, type Branch, type MovementType, type Product, type Worker } from '../lib/api'
import Carpi, { CarpiHead } from '../components/Carpi'
import ThemeToggle from '../components/ThemeToggle'

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

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [inventory, setInventory] = useState<InvRow[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [movements, setMovements] = useState<Movement[] | null>(null) // null = todavía no se buscó
  const [searching, setSearching] = useState(false)
  const [pushOn, setPushOn] = useState(false)
  const [f, setF] = useState({ branch: '', product: '', from: '', to: '', hourFrom: '', hourTo: '' })
  const [editing, setEditing] = useState<Product | null>(null)

  const load = useCallback(async () => {
    const [b, p, inv, al] = await Promise.all([
      api<Branch[]>('/branches'),
      api<Product[]>('/products'),
      api<InvRow[]>('/inventory'),
      api<Alert[]>('/alerts'),
    ])
    setBranches(b)
    setProducts(p)
    setInventory(inv)
    setAlerts(al)
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
    es.onmessage = (e) => setAlerts((a) => [JSON.parse(e.data) as Alert, ...a])
    return () => es.close()
  }, [load])

  async function loadMovements() {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (f.branch) params.set('branch', f.branch)
      if (f.product) params.set('product', f.product)
      if (f.from) params.set('from', f.from)
      if (f.to) params.set('to', f.to)
      let rows = await api<Movement[]>('/movements?' + params)
      if (f.hourFrom) rows = rows.filter((m) => new Date(m.created_at).getHours() >= Number(f.hourFrom))
      if (f.hourTo) rows = rows.filter((m) => new Date(m.created_at).getHours() <= Number(f.hourTo))
      setMovements(rows)
    } finally {
      setSearching(false)
    }
  }

  async function resolveAlert(id: string) {
    await api(`/alerts/${id}/resolve`, { method: 'PATCH' })
    setAlerts((a) => a.filter((x) => x.id !== id))
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
  const stockOf = (productId: string, branchId: string) =>
    inventory.find((i) => i.product_id === productId && i.branch_id === branchId)?.current_stock ?? 0

  const iconBtn = 'p-2 rounded-md cursor-pointer text-soft hover:text-ink hover:bg-sunken'
  const sectionTitle = 'font-pixel font-bold text-lg mb-2'
  const th = 'p-2 font-pixel font-medium'

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

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <section>
          <h2 className={sectionTitle}>Alertas ({alerts.length})</h2>
          <ul className="space-y-2">
            {alerts.map((a) => (
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
                  onClick={() => resolveAlert(a.id)}
                  title="Marcar resuelta"
                  aria-label="Marcar alerta resuelta"
                  className="p-2 text-ok hover:bg-ok-soft rounded-md shrink-0 cursor-pointer"
                >
                  <Check size={18} />
                </button>
              </li>
            ))}
            {alerts.length === 0 && (
              <li className="flex items-center gap-3 text-soft text-sm list-none">
                <Carpi size={56} title="Carpi tranquilo, sin alertas" />
                <p>Sin alertas pendientes. Carpi está tranquilo.</p>
              </li>
            )}
          </ul>
        </section>

        <section>
          <h2 className={sectionTitle}>Stock consolidado</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sunken text-left border-b-2 border-line">
                <tr>
                  <th className="p-2 w-20"></th>
                  <th className={th}>Producto</th>
                  {branches.map((b) => (
                    <th key={b.id} className={th}>{b.name}</th>
                  ))}
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {products.map((p) => {
                  const total = branches.reduce((s, b) => s + stockOf(p.id, b.id), 0)
                  return (
                    <tr key={p.id} className="border-t border-line/50">
                      <td className="p-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setEditing(p)}
                            title="Editar producto"
                            aria-label={`Editar ${p.name}`}
                            className="p-1.5 text-soft hover:bg-sunken rounded-md cursor-pointer"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => confirm(`¿Eliminar "${p.name}"? No se borra el historial, solo deja de aparecer en las listas.`) &&
                              deleteProduct(p.id).then(load)}
                            title="Eliminar producto"
                            aria-label={`Eliminar ${p.name}`}
                            className="p-1.5 text-danger hover:bg-danger-soft rounded-md cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="p-2 font-medium">{p.name}</td>
                      {branches.map((b) => {
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
                {products.length === 0 && (
                  <tr>
                    <td colSpan={branches.length + 2} className="p-4 text-center text-soft">
                      Todavía no hay productos — crealos en la sección Gestión.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className={sectionTitle}>
            Movimientos{movements !== null && ` (${movements.length}${movements.length === 200 ? ', últimos 200' : ''})`}
          </h2>
          <div className="flex flex-wrap gap-2 mb-2">
            <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} aria-label="Filtrar por sucursal" className="input px-2 py-1.5">
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} aria-label="Filtrar por producto" className="input px-2 py-1.5">
              <option value="">Todos los productos</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde fecha" className="input px-2 py-1.5" />
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta fecha" className="input px-2 py-1.5" />
            <input type="number" min="0" max="23" placeholder="Hora desde" value={f.hourFrom} onChange={(e) => setF({ ...f, hourFrom: e.target.value })} aria-label="Desde hora" className="input px-2 py-1.5 w-28" />
            <input type="number" min="0" max="23" placeholder="Hora hasta" value={f.hourTo} onChange={(e) => setF({ ...f, hourTo: e.target.value })} aria-label="Hasta hora" className="input px-2 py-1.5 w-28" />
            <button onClick={loadMovements} disabled={searching} className="btn btn-primary px-4 py-1.5">
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
                {(movements ?? []).map((m) => (
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
        </section>

        <Gestion branches={branches} onChanged={load} />
      </main>
      {editing && (
        <EditProductModal
          product={editing}
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

function EditProductModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: product.name,
    category: product.category ?? '',
    unit: product.unit,
    min: String(product.min_stock_threshold),
  })
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
        className="card p-6 w-full max-w-sm space-y-3"
      >
        <h2 className="font-pixel text-lg">Editar producto</h2>
        <input required placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full px-3 py-2" />
        <input placeholder="Categoría" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input w-full px-3 py-2" />
        <input required placeholder="Unidad (kg, plancha…)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="input w-full px-3 py-2" />
        <input type="number" min="0" step="any" placeholder="Stock mínimo" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} className="input w-full px-3 py-2" />
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

// Alta de sucursales, productos e invitación de trabajadores por email.
function Gestion({ branches, onChanged }: { branches: Branch[]; onChanged: () => void }) {
  const [team, setTeam] = useState<Worker[]>([])
  const [branch, setBranch] = useState({ name: '', address: '' })
  const [product, setProduct] = useState({ name: '', category: '', unit: '', min: '' })
  const [invite, setInvite] = useState({ name: '', email: '', branch_id: '' })
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)

  const loadTeam = useCallback(() => api<Worker[]>('/team').then(setTeam), [])
  useEffect(() => {
    loadTeam()
  }, [loadTeam])

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null)
    try {
      await fn()
      setMsg({ text: ok, kind: 'ok' })
      onChanged()
      loadTeam()
    } catch (e) {
      setMsg({ text: 'Error: ' + (e as Error).message, kind: 'err' })
    }
  }

  function addBranch(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await api('/branches', { method: 'POST', body: JSON.stringify(branch) })
      setBranch({ name: '', address: '' })
    }, 'Sucursal creada.')
  }

  function addProduct(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: product.name,
          category: product.category || null,
          unit: product.unit,
          min_stock_threshold: product.min === '' ? 0 : Number(product.min),
        }),
      })
      setProduct({ name: '', category: '', unit: '', min: '' })
    }, 'Producto creado.')
  }

  function sendInvite(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await api('/invite', { method: 'POST', body: JSON.stringify(invite) })
      setInvite({ name: '', email: '', branch_id: '' })
    }, 'Invitación enviada por email.')
  }

  const input = 'input px-2 py-1.5'
  const btn = 'btn btn-primary px-4 py-1.5'
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'

  return (
    <section>
      <h2 className="font-pixel font-bold text-lg mb-2">Gestión</h2>
      <div className="space-y-4 card p-4">
        <form onSubmit={addBranch} className="flex flex-wrap gap-2 items-center">
          <span className="w-28 text-sm font-pixel">Sucursal</span>
          <input required placeholder="Nombre" aria-label="Nombre de la sucursal" value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} className={input} />
          <input placeholder="Dirección" aria-label="Dirección" value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} className={input} />
          <button className={btn}>Crear</button>
        </form>

        <form onSubmit={addProduct} className="flex flex-wrap gap-2 items-center">
          <span className="w-28 text-sm font-pixel">Producto</span>
          <input required placeholder="Nombre" aria-label="Nombre del producto" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} className={input} />
          <input placeholder="Categoría" aria-label="Categoría" value={product.category} onChange={(e) => setProduct({ ...product, category: e.target.value })} className={input} />
          <input required placeholder="Unidad (kg, plancha…)" aria-label="Unidad" value={product.unit} onChange={(e) => setProduct({ ...product, unit: e.target.value })} className={input} />
          <input type="number" min="0" step="any" placeholder="Stock mínimo" aria-label="Stock mínimo" value={product.min} onChange={(e) => setProduct({ ...product, min: e.target.value })} className={`${input} w-32`} />
          <button className={btn}>Crear</button>
        </form>

        <form onSubmit={sendInvite} className="flex flex-wrap gap-2 items-center">
          <span className="w-28 text-sm font-pixel">Trabajador</span>
          <input required placeholder="Nombre" aria-label="Nombre del trabajador" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} className={input} />
          <input type="email" required placeholder="Email" aria-label="Email del trabajador" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={input} />
          <select required value={invite.branch_id} aria-label="Sucursal del trabajador" onChange={(e) => setInvite({ ...invite, branch_id: e.target.value })} className={input}>
            <option value="">Sucursal…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button className={btn}>Invitar</button>
        </form>

        {msg && (
          <p className={`text-sm rounded-md border-2 p-2 ${msg.kind === 'ok' ? 'text-ok bg-ok-soft border-ok/40' : 'text-danger bg-danger-soft border-danger/40'}`}>
            {msg.text}
          </p>
        )}

        {team.length > 0 && (
          <ul className="divide-y divide-line/50 text-sm">
            {team.map((w) => (
              <li key={w.id} className="py-2 flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{w.name}</span> · {w.email} · {branchName(w.branch_id)}
                  {!w.verified && <span className="ml-2 text-xs text-warn bg-warn-soft rounded px-1.5 py-0.5">invitación pendiente</span>}
                </span>
                <button
                  title="Eliminar cuenta"
                  aria-label={`Eliminar cuenta de ${w.name}`}
                  onClick={() => confirm(`¿Eliminar la cuenta de ${w.name}?`) && run(() => api(`/team/${w.id}`, { method: 'DELETE' }), 'Cuenta eliminada.')}
                  className="p-1.5 text-danger hover:bg-danger-soft rounded-md shrink-0 cursor-pointer"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
