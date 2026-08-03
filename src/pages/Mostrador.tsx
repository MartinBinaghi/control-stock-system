import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Cog, Trash2 } from 'lucide-react'
import { api, produce, MOVEMENT_LABELS, type MovementType, type Product } from '../lib/api'
import Carpi from '../components/Carpi'

const MERMA_CAUSAS = ['Vencimiento', 'Cadena de frío', 'Rotura', 'Otro']

type Row = Product & { current_stock: number }
type ModalState = { product: Row; type: MovementType } | null

// branchId: solo lo usa el admin cuando entra a la "vista de encargado" de una
// sucursal puntual (p. ej. si él mismo la atiende). Un encargado real no lo
// recibe: el servidor ya limita todo a su propia sucursal.
export default function Mostrador({ branchId }: { branchId?: string } = {}) {
  const [rows, setRows] = useState<Row[] | null>(null) // null = cargando
  const [modal, setModal] = useState<ModalState>(null)
  const [producing, setProducing] = useState<Row | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const [products, inv] = await Promise.all([
      api<Product[]>('/products'),
      api<{ product_id: string; current_stock: number }[]>('/inventory' + (branchId ? `?branch=${branchId}` : '')),
    ])
    const stock = new Map(inv.map((i) => [i.product_id, i.current_stock]))
    setRows(products.map((p) => ({ ...p, current_stock: stock.get(p.id) ?? 0 })))
  }, [branchId])

  useEffect(() => {
    load()
  }, [load])

  const visible = (rows ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Buscar producto…"
        aria-label="Buscar producto"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input w-full"
      />
      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} className="panel p-3 flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className={`text-sm tabular-nums ${r.current_stock < r.min_stock_threshold ? 'text-danger font-semibold' : 'text-soft'}`}>
                Stock: {r.current_stock} {r.unit}
                {r.current_stock < r.min_stock_threshold && ' — ¡crítico!'}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                title="Entrada"
                aria-label={`Entrada de ${r.name}`}
                onClick={() => setModal({ product: r, type: 'ingreso_manual' })}
                className="p-2 rounded-md cursor-pointer text-ok hover:bg-ok-soft"
              >
                <ArrowUpCircle size={22} />
              </button>
              <button
                title="Salida"
                aria-label={`Salida de ${r.name}`}
                onClick={() => setModal({ product: r, type: 'egreso_manual' })}
                className="p-2 rounded-md cursor-pointer text-accent hover:bg-sunken"
              >
                <ArrowDownCircle size={22} />
              </button>
              <button
                title="Merma"
                aria-label={`Merma de ${r.name}`}
                onClick={() => setModal({ product: r, type: 'merma' })}
                className="p-2 rounded-md cursor-pointer text-danger hover:bg-danger-soft"
              >
                <Trash2 size={22} />
              </button>
              {!r.is_raw_material && (
                <button
                  title="Producir"
                  aria-label={`Producir ${r.name}`}
                  onClick={() => setProducing(r)}
                  className="p-2 rounded-md cursor-pointer text-accent hover:bg-sunken"
                >
                  <Cog size={22} />
                </button>
              )}
            </div>
          </li>
        ))}
        {rows === null && <p className="text-center text-soft py-8">Cargando productos…</p>}
        {rows !== null && visible.length === 0 && (
          <li className="flex flex-col items-center gap-3 py-8 text-center text-soft list-none">
            <Carpi size={88} title="Carpi sin nada que anotar" />
            <p>
              {rows.length === 0
                ? 'Carpi no tiene nada que anotar: todavía no hay productos. El administrador los crea desde su panel.'
                : `Sin resultados para «${filter}».`}
            </p>
          </li>
        )}
      </ul>
      {modal && (
        <MovementModal
          modal={modal}
          branchId={branchId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
      {producing && (
        <ProduceModal
          product={producing}
          branchId={branchId}
          onClose={() => setProducing(null)}
          onSaved={() => {
            setProducing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function MovementModal({
  modal,
  branchId,
  onClose,
  onSaved,
}: {
  modal: NonNullable<ModalState>
  branchId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [qty, setQty] = useState('')
  const [causa, setCausa] = useState(MERMA_CAUSAS[0])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isMerma = modal.type === 'merma'
  const title = MOVEMENT_LABELS[modal.type]

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

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
          ...(branchId ? { branch_id: branchId } : {}),
        }),
      })
      onSaved()
    } catch (e) {
      setError('No se pudo guardar: ' + (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — ${modal.product.name}`}
        className="card p-6 w-full max-w-sm space-y-3"
      >
        <h2 className="font-pixel text-lg font-bold">
          {title} — {modal.product.name}
        </h2>
        <input
          type="number"
          required
          autoFocus
          min="0.01"
          step="any"
          placeholder={`Cantidad (${modal.product.unit})`}
          aria-label={`Cantidad en ${modal.product.unit}`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="input w-full"
        />
        {isMerma && (
          <select
            value={causa}
            onChange={(e) => setCausa(e.target.value)}
            aria-label="Causa de la merma"
            className="input w-full"
          >
            {MERMA_CAUSAS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        {error && <p className="text-danger text-sm bg-danger-soft border-2 border-danger/40 rounded-md p-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button disabled={busy} className="btn btn-primary">
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ProduceModal({ product, branchId, onClose, onSaved }: {
  product: Row; branchId?: string; onClose: () => void; onSaved: () => void
}) {
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const body = { product_id: product.id, quantity: Number(qty), ...(branchId ? { branch_id: branchId } : {}) }
    try {
      await produce(body)
      onSaved()
    } catch (e) {
      const msg = (e as Error).message
      // el server devuelve "Faltan insumos: ..." cuando algo quedaría negativo;
      // se reintenta con force solo si el usuario confirma explícitamente
      if (msg.startsWith('Faltan insumos') && confirm(`${msg}\n\n¿Confirmar la producción igual? Los insumos que falten quedan en stock negativo y se genera una alerta para revisar.`)) {
        try {
          await produce({ ...body, force: true })
          onSaved()
          return
        } catch (e2) {
          setError('No se pudo guardar: ' + (e2 as Error).message)
        }
      } else {
        setError('No se pudo guardar: ' + msg)
      }
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Producir — ${product.name}`}
        className="card p-6 w-full max-w-sm space-y-3"
      >
        <h2 className="font-pixel text-lg font-bold">Producir — {product.name}</h2>
        <input
          type="number"
          required
          autoFocus
          min="0.01"
          step="any"
          placeholder={`Cantidad (${product.unit})`}
          aria-label={`Cantidad en ${product.unit}`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="input w-full"
        />
        {error && <p className="text-danger text-sm bg-danger-soft border-2 border-danger/40 rounded-md p-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button disabled={busy} className="btn btn-primary">
            {busy ? 'Guardando…' : 'Producir'}
          </button>
        </div>
      </form>
    </div>
  )
}
