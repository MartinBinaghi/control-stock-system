import { useCallback, useEffect, useState } from 'react'
import { Bell, BellRing, Check, LogOut, RefreshCw } from 'lucide-react'
import { api, getToken, type Alert, type Branch, type Product } from '../lib/api'

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
        <h1 className="font-bold text-lg">Di Polo Pastas — Panel Administrador</h1>
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
      </main>
    </div>
  )
}
