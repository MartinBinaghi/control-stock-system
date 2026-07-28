import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Trash2 } from 'lucide-react'
import { api, type MovementType, type Product } from '../lib/api'

const MERMA_CAUSAS = ['Vencimiento', 'Cadena de frío', 'Rotura', 'Otro']

type Row = Product & { current_stock: number }
type ModalState = { product: Row; type: MovementType } | null

export default function Mostrador() {
  const [rows, setRows] = useState<Row[]>([])
  const [modal, setModal] = useState<ModalState>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    // el servidor limita inventory a la sucursal del encargado
    const [products, inv] = await Promise.all([
      api<Product[]>('/products'),
      api<{ product_id: string; current_stock: number }[]>('/inventory'),
    ])
    const stock = new Map(inv.map((i) => [i.product_id, i.current_stock]))
    setRows(products.map((p) => ({ ...p, current_stock: stock.get(p.id) ?? 0 })))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visible = rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-3">
      <input
        placeholder="Buscar producto…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 bg-white"
      />
      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} className="bg-white rounded-lg shadow-sm p-3 flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className={`text-sm ${r.current_stock < r.min_stock_threshold ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                Stock: {r.current_stock} {r.unit}
                {r.current_stock < r.min_stock_threshold && ' — ¡crítico!'}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                title="Entrada"
                onClick={() => setModal({ product: r, type: 'ingreso_manual' })}
                className="p-2 rounded-lg text-green-700 hover:bg-green-50"
              >
                <ArrowUpCircle size={22} />
              </button>
              <button
                title="Salida"
                onClick={() => setModal({ product: r, type: 'egreso_manual' })}
                className="p-2 rounded-lg text-blue-700 hover:bg-blue-50"
              >
                <ArrowDownCircle size={22} />
              </button>
              <button
                title="Merma"
                onClick={() => setModal({ product: r, type: 'merma' })}
                className="p-2 rounded-lg text-red-700 hover:bg-red-50"
              >
                <Trash2 size={22} />
              </button>
            </div>
          </li>
        ))}
        {visible.length === 0 && <p className="text-center text-gray-400 py-8">Sin productos</p>}
      </ul>
      {modal && (
        <MovementModal
          modal={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function MovementModal({
  modal,
  onClose,
  onSaved,
}: {
  modal: NonNullable<ModalState>
  onClose: () => void
  onSaved: () => void
}) {
  const [qty, setQty] = useState('')
  const [causa, setCausa] = useState(MERMA_CAUSAS[0])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isMerma = modal.type === 'merma'
  const title =
    modal.type === 'ingreso_manual' ? 'Entrada' : modal.type === 'egreso_manual' ? 'Salida' : 'Merma'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/movements', {
        method: 'POST',
        body: JSON.stringify({
          product_id: modal.product.id,
          type: modal.type,
          quantity: Number(qty),
          reason: isMerma ? causa : null,
        }),
      })
      onSaved()
    } catch (e) {
      setError('No se pudo guardar: ' + (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-3"
      >
        <h2 className="text-lg font-bold">
          {title} — {modal.product.name}
        </h2>
        <input
          type="number"
          required
          min="0.01"
          step="any"
          placeholder={`Cantidad (${modal.product.unit})`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-full border rounded-lg px-3 py-2"
        />
        {isMerma && (
          <select value={causa} onChange={(e) => setCausa(e.target.value)} className="w-full border rounded-lg px-3 py-2">
            {MERMA_CAUSAS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-gray-100">
            Cancelar
          </button>
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </form>
    </div>
  )
}
