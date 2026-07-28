import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Bell, BellRing, Check, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { api, getToken, type Alert, type Branch, type Product, type Worker } from '../lib/api'

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

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [inventory, setInventory] = useState<InvRow[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [pushOn, setPushOn] = useState(false)
  const [f, setF] = useState({ branch: '', product: '', from: '', to: '', hourFrom: '', hourTo: '' })

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
    // alertas en vivo por SSE (EventSource no admite headers → token en query)
    const es = new EventSource('/api/events?token=' + getToken())
    es.onmessage = (e) => setAlerts((a) => [JSON.parse(e.data) as Alert, ...a])
    return () => es.close()
  }, [load])

  async function loadMovements() {
    const params = new URLSearchParams()
    if (f.branch) params.set('branch', f.branch)
    if (f.product) params.set('product', f.product)
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
    let rows = await api<Movement[]>('/movements?' + params)
    if (f.hourFrom) rows = rows.filter((m) => new Date(m.created_at).getHours() >= Number(f.hourFrom))
    if (f.hourTo) rows = rows.filter((m) => new Date(m.created_at).getHours() <= Number(f.hourTo))
    setMovements(rows)
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

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-700 text-white flex items-center justify-between px-4 py-3 shadow">
        <h1 className="font-bold text-lg">Control de Stock — Panel Administrador</h1>
        <div className="flex gap-2 items-center">
          <button
            onClick={enablePush}
            disabled={pushOn}
            title={pushOn ? 'Notificaciones activas' : 'Activar notificaciones'}
            className="flex items-center gap-1 px-3 py-1.5 rounded hover:bg-amber-800 disabled:opacity-70"
          >
            {pushOn ? <BellRing size={16} /> : <Bell size={16} />}
            {pushOn ? 'Notificaciones ON' : 'Activar notificaciones'}
          </button>
          <button onClick={load} title="Refrescar" className="p-2 hover:bg-amber-800 rounded">
            <RefreshCw size={16} />
          </button>
          <button onClick={onLogout} title="Salir" className="p-2 hover:bg-amber-800 rounded">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <section>
          <h2 className="font-bold text-amber-900 mb-2">Alertas ({alerts.length})</h2>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className={`bg-white rounded-lg shadow-sm p-3 flex items-center justify-between gap-2 border-l-4 ${a.type === 'stock_critico' ? 'border-red-500' : 'border-orange-400'}`}
              >
                <div>
                  <p className="text-sm">{a.message}</p>
                  <p className="text-xs text-gray-400">
                    {branchName(a.branch_id)} · {new Date(a.created_at).toLocaleString('es-AR')}
                  </p>
                </div>
                <button
                  onClick={() => resolveAlert(a.id)}
                  title="Marcar resuelta"
                  className="p-2 text-green-700 hover:bg-green-50 rounded-lg shrink-0"
                >
                  <Check size={18} />
                </button>
              </li>
            ))}
            {alerts.length === 0 && <p className="text-gray-400 text-sm">Sin alertas pendientes.</p>}
          </ul>
        </section>

        <section>
          <h2 className="font-bold text-amber-900 mb-2">Stock consolidado</h2>
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-100 text-left">
                <tr>
                  <th className="p-2">Producto</th>
                  {branches.map((b) => (
                    <th key={b.id} className="p-2">{b.name}</th>
                  ))}
                  <th className="p-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const total = branches.reduce((s, b) => s + stockOf(p.id, b.id), 0)
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="p-2 font-medium">{p.name}</td>
                      {branches.map((b) => {
                        const s = stockOf(p.id, b.id)
                        return (
                          <td key={b.id} className={`p-2 ${s < p.min_stock_threshold ? 'text-red-600 font-semibold' : ''}`}>
                            {s}
                          </td>
                        )
                      })}
                      <td className="p-2 font-semibold">{total} {p.unit}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-bold text-amber-900 mb-2">Movimientos</h2>
          <div className="flex flex-wrap gap-2 mb-2">
            <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white">
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white">
              <option value="">Todos los productos</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white" />
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white" />
            <input type="number" min="0" max="23" placeholder="Hora desde" value={f.hourFrom} onChange={(e) => setF({ ...f, hourFrom: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white w-28" />
            <input type="number" min="0" max="23" placeholder="Hora hasta" value={f.hourTo} onChange={(e) => setF({ ...f, hourTo: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white w-28" />
            <button onClick={loadMovements} className="bg-amber-700 hover:bg-amber-800 text-white rounded-lg px-4 py-1.5">
              Buscar
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-100 text-left">
                <tr>
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Sucursal</th>
                  <th className="p-2">Producto</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2">Cantidad</th>
                  <th className="p-2">Encargado</th>
                  <th className="p-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString('es-AR')}</td>
                    <td className="p-2">{branchName(m.branch_id)}</td>
                    <td className="p-2">{productName(m.product_id)}</td>
                    <td className="p-2">{m.type.replace('_', ' ')}</td>
                    <td className="p-2">{m.quantity}</td>
                    <td className="p-2">{m.manager_name}</td>
                    <td className="p-2">{m.reason ?? ''}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-gray-400">Usá los filtros y presioná Buscar.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <Gestion branches={branches} onChanged={load} />
      </main>
    </div>
  )
}

// Alta de sucursales, productos e invitación de trabajadores por email.
function Gestion({ branches, onChanged }: { branches: Branch[]; onChanged: () => void }) {
  const [team, setTeam] = useState<Worker[]>([])
  const [branch, setBranch] = useState({ name: '', address: '' })
  const [product, setProduct] = useState({ name: '', category: '', unit: '', min: '' })
  const [invite, setInvite] = useState({ name: '', email: '', branch_id: '' })
  const [msg, setMsg] = useState('')

  const loadTeam = useCallback(() => api<Worker[]>('/team').then(setTeam), [])
  useEffect(() => {
    loadTeam()
  }, [loadTeam])

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg('')
    try {
      await fn()
      setMsg(ok)
      onChanged()
      loadTeam()
    } catch (e) {
      setMsg('Error: ' + (e as Error).message)
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

  const input = 'border rounded-lg px-2 py-1.5 bg-white'
  const btn = 'bg-amber-700 hover:bg-amber-800 text-white rounded-lg px-4 py-1.5'
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'

  return (
    <section>
      <h2 className="font-bold text-amber-900 mb-2">Gestión</h2>
      <div className="space-y-4 bg-white rounded-xl shadow-sm p-4">
        <form onSubmit={addBranch} className="flex flex-wrap gap-2 items-center">
          <span className="w-28 text-sm font-medium">Sucursal</span>
          <input required placeholder="Nombre" value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} className={input} />
          <input placeholder="Dirección" value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} className={input} />
          <button className={btn}>Crear</button>
        </form>

        <form onSubmit={addProduct} className="flex flex-wrap gap-2 items-center">
          <span className="w-28 text-sm font-medium">Producto</span>
          <input required placeholder="Nombre" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} className={input} />
          <input placeholder="Categoría" value={product.category} onChange={(e) => setProduct({ ...product, category: e.target.value })} className={input} />
          <input placeholder="Unidad (kg, plancha…)" value={product.unit} onChange={(e) => setProduct({ ...product, unit: e.target.value })} className={input} />
          <input type="number" min="0" step="any" placeholder="Stock mínimo" value={product.min} onChange={(e) => setProduct({ ...product, min: e.target.value })} className={`${input} w-32`} />
          <button className={btn}>Crear</button>
        </form>

        <form onSubmit={sendInvite} className="flex flex-wrap gap-2 items-center">
          <span className="w-28 text-sm font-medium">Trabajador</span>
          <input required placeholder="Nombre" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} className={input} />
          <input type="email" required placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={input} />
          <select required value={invite.branch_id} onChange={(e) => setInvite({ ...invite, branch_id: e.target.value })} className={input}>
            <option value="">Sucursal…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button className={btn}>Invitar</button>
        </form>

        {msg && <p className="text-sm text-amber-900 bg-amber-100 rounded-lg p-2">{msg}</p>}

        {team.length > 0 && (
          <ul className="divide-y text-sm">
            {team.map((w) => (
              <li key={w.id} className="py-2 flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{w.name}</span> · {w.email} · {branchName(w.branch_id)}
                  {!w.verified && <span className="ml-2 text-xs text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">invitación pendiente</span>}
                </span>
                <button
                  title="Eliminar cuenta"
                  onClick={() => confirm(`¿Eliminar la cuenta de ${w.name}?`) && run(() => api(`/team/${w.id}`, { method: 'DELETE' }), 'Cuenta eliminada.')}
                  className="p-1.5 text-red-700 hover:bg-red-50 rounded-lg shrink-0"
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
