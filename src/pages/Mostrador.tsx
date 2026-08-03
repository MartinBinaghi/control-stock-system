import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Trash2, Clock, CheckCircle, XCircle, Plus, X } from 'lucide-react'
import { api, getMovements, MOVEMENT_LABELS, type MovementType, type Product, type Movement } from '../lib/api'
import Carpi from '../components/Carpi'

const MERMA_CAUSAS = ['Vencimiento', 'Cadena de frío', 'Rotura', 'Otro']

type Row = Product & { current_stock: number }
type ModalState = { product: Row; type: MovementType } | null
type BatchModalState = { products: Row[]; entries: Map<string, { qty: string; causa: string }> } | null
type RecentMovement = Movement & { product_name: string }

const DRAFT_KEY = 'mostrador_draft'
const SHIFT_START_KEY = 'shift_start_time'

function saveDraft(type: MovementType, qty: string, causa?: string) {
  const draft = { type, qty, causa }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY)
}

export default function Mostrador() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [batchModal, setBatchModal] = useState<BatchModalState>(null)
  const [filter, setFilter] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [recentMovements, setRecentMovements] = useState<RecentMovement[]>([])
  const [shiftSummary, setShiftSummary] = useState<{ entradas: number; salidas: number; mermas: number }>({ entradas: 0, salidas: 0, mermas: 0 })
  const [undoToast, setUndoToast] = useState<{ movement: Movement; timeout: ReturnType<typeof setTimeout> } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLUListElement>(null)

  const load = useCallback(async () => {
    const [products, inv, movements] = await Promise.all([
      api<Product[]>('/products'),
      api<{ product_id: string; current_stock: number }[]>('/inventory'),
      getMovements(),
    ])
    const stock = new Map(inv.map((i) => [i.product_id, i.current_stock]))
    setRows(products.map((p) => ({ ...p, current_stock: stock.get(p.id) ?? 0 })))
    const productMap = new Map(products.map((p) => [p.id, p.name]))
    const enriched = movements.map((m) => ({ ...m, product_name: productMap.get(m.product_id) ?? '—' }))
    setRecentMovements(enriched.slice(0, 30))
    const shiftStart = localStorage.getItem(SHIFT_START_KEY)
    if (shiftStart) {
      const startTime = new Date(shiftStart).getTime()
      const shiftMovements = movements.filter((m) => new Date(m.created_at).getTime() >= startTime)
      setShiftSummary({
        entradas: shiftMovements.filter((m) => m.type === 'ingreso_manual').reduce((s, m) => s + m.quantity, 0),
        salidas: shiftMovements.filter((m) => m.type === 'egreso_manual').reduce((s, m) => s + m.quantity, 0),
        mermas: shiftMovements.filter((m) => m.type === 'merma').reduce((s, m) => s + m.quantity, 0),
      })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (modal || batchModal || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return

      const visibleRows = (rows ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
      if (visibleRows.length === 0) return

      if (focusedIndex >= visibleRows.length) setFocusedIndex(visibleRows.length - 1)

      switch (e.key.toLowerCase()) {
        case 'e':
          e.preventDefault()
          setModal({ product: visibleRows[focusedIndex], type: 'ingreso_manual' })
          break
        case 's':
          e.preventDefault()
          setModal({ product: visibleRows[focusedIndex], type: 'egreso_manual' })
          break
        case 'm':
          e.preventDefault()
          setModal({ product: visibleRows[focusedIndex], type: 'merma' })
          break
        case 'enter':
          e.preventDefault()
          setModal({ product: visibleRows[focusedIndex], type: 'ingreso_manual' })
          break
        case 'arrowdown':
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, visibleRows.length - 1))
          break
        case 'arrowup':
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break
        case 'b':
          e.preventDefault()
          openBatchMode()
          break
        case ' ':
          e.preventDefault()
          {
            const row = visibleRows[focusedIndex]
            setSelectedIds((prev) => {
              const next = new Set(prev)
              if (next.has(row.id)) next.delete(row.id)
              else next.add(row.id)
              return next
            })
          }
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modal, batchModal, rows, filter, focusedIndex])

  useEffect(() => {
    const list = listRef.current
    const items = list?.querySelectorAll('[data-row-index]')
    const target = items?.[focusedIndex] as HTMLElement
    target?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  const visible = (rows ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))

  function openBatchMode() {
    const selectedProducts = visible.filter((r) => selectedIds.has(r.id))
    if (selectedProducts.length > 0) {
      const entries = new Map<string, { qty: string; causa: string }>()
      selectedProducts.forEach((p) => entries.set(p.id, { qty: '', causa: MERMA_CAUSAS[0] }))
      setBatchModal({ products: selectedProducts, entries })
    }
  }

  function startShift() {
    localStorage.setItem(SHIFT_START_KEY, new Date().toISOString())
    setShiftSummary({ entradas: 0, salidas: 0, mermas: 0 })
  }

  function endShift() {
    localStorage.removeItem(SHIFT_START_KEY)
    setShiftSummary({ entradas: 0, salidas: 0, mermas: 0 })
  }

  async function onMovementSaved(movement: Movement) {
    load()
    clearDraft()
    const timeout = setTimeout(() => setUndoToast(null), 5000)
    setUndoToast({ movement, timeout })
    if ('vibrate' in navigator) navigator.vibrate(30)
  }

  async function retryLastMovement() {
    if (!undoToast) return
    const { movement } = undoToast
    try {
      await api('/movements', {
        method: 'POST',
        body: JSON.stringify({
          product_id: movement.product_id,
          type: movement.type,
          quantity: movement.quantity,
          reason: movement.reason,
        }),
      })
      clearTimeout(undoToast.timeout)
      setUndoToast(null)
      load()
    } catch (e) {
      console.error('No se pudo repetir:', e)
    }
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col gap-3 p-3 lg:p-4">
      {/* Header: search + shift controls */}
      <header className="flex flex-wrap gap-2 items-center shrink-0">
        <div className="flex-1 min-w-0 lg:max-w-2xl">
          <input
            type="search"
            placeholder="Buscar producto… (ESC para limpiar)"
            aria-label="Buscar producto"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setFocusedIndex(0) }}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            className="input w-full"
          />
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={startShift}
            disabled={!!localStorage.getItem(SHIFT_START_KEY)}
            title="Iniciar turno"
            className="btn btn-ghost px-3"
            aria-label="Iniciar turno"
          >
            <Clock size={16} /> Turno
          </button>
          <button
            onClick={endShift}
            disabled={!localStorage.getItem(SHIFT_START_KEY)}
            title="Finalizar turno"
            className="btn btn-ghost px-3"
            aria-label="Finalizar turno"
          >
            <XCircle size={16} /> Fin
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              title="Limpiar selección"
              className="btn btn-ghost px-3 text-warn"
              aria-label={`Limpiar selección (${selectedIds.size} productos)`}
            >
              <X size={16} /> Limpiar
            </button>
          )}
          <button
            onClick={openBatchMode}
            disabled={selectedIds.size === 0}
            title="Entrada múltiple (B)"
            className="btn btn-ghost px-3"
            aria-label={`Modo lote${selectedIds.size > 0 ? ` (${selectedIds.size} seleccionados)` : ''}`}
          >
            <Plus size={16} /> Lote
          </button>
        </div>
      </header>

      {/* Shift summary bar */}
      {localStorage.getItem(SHIFT_START_KEY) && (
        <div className="panel p-2 grid grid-cols-3 gap-2 text-center text-sm shrink-0">
          <div className="bg-ok-soft border-2 border-ok/40 rounded-md p-2">
            <div className="font-pixel font-bold text-ok">{shiftSummary.entradas}</div>
            <div className="text-xs text-soft">Entradas</div>
          </div>
          <div className="bg-accent-soft border-2 border-accent/40 rounded-md p-2">
            <div className="font-pixel font-bold text-accent">{shiftSummary.salidas}</div>
            <div className="text-xs text-soft">Salidas</div>
          </div>
          <div className="bg-danger-soft border-2 border-danger/40 rounded-md p-2">
            <div className="font-pixel font-bold text-danger">{shiftSummary.mermas}</div>
            <div className="text-xs text-soft">Mermas</div>
          </div>
        </div>
      )}

      {/* Main split layout: Product list (left) + History (right) */}
      <main className="flex-1 min-h-0 flex gap-3 lg:gap-4 overflow-hidden">
        {/* Left: Product list */}
        <section className="flex-1 min-w-0 lg:max-w-2xl flex flex-col overflow-hidden">
          <ul ref={listRef} className="space-y-1.5 flex-1 overflow-y-auto pr-1 pl-2 pt-2" role="listbox" aria-label="Productos">
            {visible.map((r, idx) => {
              const isSelected = selectedIds.has(r.id)
              return (
                <li
                  key={r.id}
                  data-row-index={idx}
                  className={`panel p-2.5 flex items-center justify-between gap-2 transition-colors duration-100 ${
                    idx === focusedIndex ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
                  } ${isSelected ? 'bg-accent-soft border-accent' : ''}`}
                  role="option"
                  aria-selected={idx === focusedIndex}
                  aria-checked={isSelected}
                  onClick={() => setFocusedIndex(idx)}
                  onDoubleClick={() => setModal({ product: r, type: 'ingreso_manual' })}
                >
                  <label className="flex items-center cursor-pointer min-w-[40px] select-none" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(r.id)) next.delete(r.id)
                          else next.add(r.id)
                          return next
                        })
                      }}
                      className="w-4 h-4 accent-accent border-2 border-line rounded cursor-pointer"
                      aria-label={`Seleccionar ${r.name}`}
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className={`tabular-nums font-mono ${r.current_stock < r.min_stock_threshold ? 'text-danger font-semibold' : 'text-ok font-semibold'}`}>
                          {r.current_stock} {r.unit}
                        </span>
                      </div>
                  </div>
                <div className="flex gap-0.5 shrink-0">
                  <button
                    title="Entrada (E)"
                    aria-label={`Entrada de ${r.name}`}
                    onClick={() => setModal({ product: r, type: 'ingreso_manual' })}
                    className="p-1.5 rounded-md cursor-pointer text-ok hover:bg-ok-soft min-w-[40px] min-h-[40px] flex items-center justify-center"
                  >
                    <ArrowUpCircle size={20} />
                  </button>
                  <button
                    title="Salida (S)"
                    aria-label={`Salida de ${r.name}`}
                    onClick={() => setModal({ product: r, type: 'egreso_manual' })}
                    className="p-1.5 rounded-md cursor-pointer text-accent hover:bg-sunken min-w-[40px] min-h-[40px] flex items-center justify-center"
                  >
                    <ArrowDownCircle size={20} />
                  </button>
                  <button
                    title="Merma (M)"
                    aria-label={`Merma de ${r.name}`}
                    onClick={() => setModal({ product: r, type: 'merma' })}
                    className="p-1.5 rounded-md cursor-pointer text-danger hover:bg-danger-soft min-w-[40px] min-h-[40px] flex items-center justify-center"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </li>
            )
            })}
            {rows === null && (
              <li className="text-center text-soft py-8 list-none">Cargando productos…</li>
            )}
            {rows !== null && visible.length === 0 && (
              <li className="flex flex-col items-center gap-3 py-8 text-center text-soft list-none">
                <Carpi size={88} title="Carpi sin nada que anotar" />
                <p className="text-sm">
                  {rows.length === 0
                    ? 'Carpi no tiene nada que anotar: todavía no hay productos. El administrador los crea desde su panel.'
                    : `Sin resultados para «${filter}».`}
                </p>
              </li>
            )}
          </ul>
        </section>

        {/* Right: History panel - always visible on desktop, hidden on mobile */}
        <aside className="hidden lg:block w-72 lg:w-80 flex flex-col panel overflow-hidden shrink-0" aria-label="Historial de movimientos">
          <header className="p-2 border-b-2 border-line bg-sunken shrink-0">
            <h3 className="font-pixel font-bold text-xs text-soft uppercase tracking-wide">Historial reciente</h3>
          </header>
          <div className="flex-1 overflow-y-auto p-1.5">
            {recentMovements.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-soft h-full">
                <Carpi size={48} title="Carpi tranquilo" />
                <p className="text-xs">Sin movimientos aún</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-sunken sticky top-0 border-b-2 border-line">
                  <tr>
                    <th className="p-1.5 text-left font-pixel">Hora</th>
                    <th className="p-1.5 text-left font-pixel">Producto</th>
                    <th className="p-1.5 text-left font-pixel">Tipo</th>
                    <th className="p-1.5 text-right font-pixel tabular-nums">Cant.</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.map((m) => (
                    <tr key={m.id} className="border-t border-line/50 hover:bg-sunken/50">
                      <td className="p-1.5 whitespace-nowrap text-soft">{new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="p-1.5 truncate max-w-[140px] font-medium">{m.product_name}</td>
                      <td className="p-1.5">
                        <span className={`px-1 py-0.5 rounded text-[9px] font-pixel ${
                          m.type === 'ingreso_manual' ? 'bg-ok-soft text-ok' :
                          m.type === 'egreso_manual' ? 'bg-accent-soft text-accent' :
                          m.type === 'merma' ? 'bg-danger-soft text-danger' :
                          'bg-warn-soft text-warn'
                        }`}>
                          {MOVEMENT_LABELS[m.type as MovementType] ?? m.type}
                        </span>
                      </td>
                      <td className="p-1.5 text-right tabular-nums font-medium">{m.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </aside>
      </main>

      {/* Toast de deshacer */}
      {undoToast && (
        <div className="fixed bottom-4 right-4 z-20 animate-slide-in lg:bottom-6 lg:right-6">
          <div className="card p-3 flex items-center gap-2 min-w-[260px] max-w-md shadow-lg">
            <CheckCircle className="text-ok" size={18} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Movimiento guardado</p>
              <p className="text-xs text-soft truncate">
                {MOVEMENT_LABELS[undoToast.movement.type as MovementType]}: {undoToast.movement.quantity} {rows?.find(p => p.id === undoToast.movement.product_id)?.unit ?? ''}
              </p>
            </div>
            <button
              onClick={retryLastMovement}
              className="btn btn-ghost btn-sm px-2 py-1 shrink-0"
            >
              Repetir
            </button>
            <button
              onClick={() => { clearTimeout(undoToast.timeout); setUndoToast(null) }}
              className="p-1 text-soft hover:text-ink shrink-0"
              aria-label="Descartar"
            >
              <XCircle size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Mobile history toggle - shows as bottom sheet on mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-10 panel border-t-2 border-line bg-base animate-slide-up max-h-[50vh] overflow-hidden">
        <header className="p-2 border-b-2 border-line bg-sunken flex items-center justify-between shrink-0">
          <h3 className="font-pixel font-bold text-xs text-soft uppercase tracking-wide">Historial reciente</h3>
          <button onClick={() => {}} className="p-1 text-soft" aria-label="Cerrar">×</button>
        </header>
        <div className="overflow-y-auto p-2 max-h-[45vh]">
          {recentMovements.length === 0 ? (
            <p className="text-center text-soft py-4 text-sm">Sin movimientos aún</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-sunken sticky top-0 border-b-2 border-line">
                <tr>
                  <th className="p-1.5 text-left font-pixel">Hora</th>
                  <th className="p-1.5 text-left font-pixel">Producto</th>
                  <th className="p-1.5 text-left font-pixel">Tipo</th>
                  <th className="p-1.5 text-right font-pixel tabular-nums">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.slice(0, 20).map((m) => (
                  <tr key={m.id} className="border-t border-line/50 hover:bg-sunken/50">
                    <td className="p-1.5 whitespace-nowrap text-soft">{new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="p-1.5 truncate max-w-[120px] font-medium">{m.product_name}</td>
                    <td className="p-1.5">
                      <span className={`px-1 py-0.5 rounded text-[9px] font-pixel ${
                        m.type === 'ingreso_manual' ? 'bg-ok-soft text-ok' :
                        m.type === 'egreso_manual' ? 'bg-accent-soft text-accent' :
                        m.type === 'merma' ? 'bg-danger-soft text-danger' :
                        'bg-warn-soft text-warn'
                      }`}>
                        {MOVEMENT_LABELS[m.type as MovementType] ?? m.type}
                      </span>
                    </td>
                    <td className="p-1.5 text-right tabular-nums font-medium">{m.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal && (
        <MovementModal
          modal={modal}
          onClose={() => setModal(null)}
          onSaved={(movement) => {
            setModal(null)
            onMovementSaved(movement)
          }}
        />
      )}

      {batchModal && (
        <BatchMovementModal
          modal={batchModal}
          onClose={() => setBatchModal(null)}
          onSaved={(movements) => {
            setBatchModal(null)
            movements.forEach(onMovementSaved)
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
  onSaved: (movement: Movement) => void
}) {
  const [qty, setQty] = useState('')
  const [causa, setCausa] = useState(MERMA_CAUSAS[0])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isMerma = modal.type === 'merma'
  const title = MOVEMENT_LABELS[modal.type]

  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY)
    if (draft) {
      try {
        const parsed = JSON.parse(draft)
        if (parsed.type === modal.type) {
          setQty(parsed.qty)
          if (parsed.causa) setCausa(parsed.causa)
        }
      } catch {}
    }
  }, [modal])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!qty || Number(qty) <= 0) return setError('Cantidad inválida')
    setBusy(true)
    setError('')
    try {
      const res = await api<Movement>('/movements', {
        method: 'POST',
        body: JSON.stringify({
          product_id: modal.product.id,
          type: modal.type,
          quantity: Number(qty),
          reason: isMerma ? causa : null,
        }),
      })
      saveDraft(modal.type, qty, isMerma ? causa : undefined)
      onSaved(res)
    } catch (e) {
      setError('No se pudo guardar: ' + (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} — ${modal.product.name}`}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card p-6 w-full max-w-sm space-y-3"
      >
        <h2 className="font-pixel text-lg font-bold">
          {title} — {modal.product.name}
        </h2>
        <p className="text-xs text-soft">Stock actual: {modal.product.current_stock} {modal.product.unit}</p>
        <input
          type="number"
          required
          autoFocus
          min="1"
          step="1"
          placeholder={`Cantidad (${modal.product.unit})`}
          aria-label={`Cantidad en ${modal.product.unit}`}
          value={qty}
          onChange={(e) => { setQty(e.target.value); saveDraft(modal.type, e.target.value, causa) }}
          className="input w-full text-lg"
        />
        {isMerma && (
          <select
            value={causa}
            onChange={(e) => { setCausa(e.target.value); saveDraft(modal.type, qty, e.target.value) }}
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

function BatchMovementModal({
  modal,
  onClose,
  onSaved,
}: {
  modal: NonNullable<BatchModalState>
  onClose: () => void
  onSaved: (movements: Movement[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [entries, setEntries] = useState(modal.entries)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function updateQty(productId: string, value: string) {
    setEntries((prev) => {
      const newEntries = new Map(prev)
      const entry = newEntries.get(productId) ?? { qty: '', causa: MERMA_CAUSAS[0] }
      newEntries.set(productId, { ...entry, qty: value })
      return newEntries
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const validEntries: Array<{ product: Row; qty: number; causa: string }> = []
    const newErrors: Record<string, string> = {}

    modal.products.forEach((p) => {
      const entry = entries.get(p.id)
      const qty = entry?.qty ? Number(entry.qty) : 0
      if (qty > 0) {
        validEntries.push({ product: p, qty, causa: entry?.causa ?? MERMA_CAUSAS[0] })
      } else if (entry?.qty !== '' && entry?.qty !== undefined) {
        newErrors[p.id] = 'Cantidad inválida'
      }
    })

    if (validEntries.length === 0) return setErrors({ general: 'Ingresá al menos una cantidad válida' })
    setErrors(newErrors)
    setBusy(true)

    try {
      const results = await Promise.all(
        validEntries.map(({ product, qty }) =>
          api<Movement>('/movements', {
            method: 'POST',
            body: JSON.stringify({
              product_id: product.id,
              type: 'ingreso_manual' as MovementType,
              quantity: qty,
              reason: null,
            }),
          })
        )
      )
      onSaved(results)
    } catch (e) {
      setErrors({ general: 'Error al guardar: ' + (e as Error).message })
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10" onClick={onClose} role="dialog" aria-modal="true" aria-label="Entrada múltiple">
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card p-6 w-full max-w-md max-h-[80vh] overflow-auto space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-lg font-bold">Entrada múltiple</h2>
          <span className="text-xs text-soft">{modal.products.length} productos seleccionados</span>
        </div>

        {errors.general && <p className="text-danger text-sm bg-danger-soft border-2 border-danger/40 rounded-md p-2">{errors.general}</p>}

        <div className="space-y-2 max-h-64 overflow-auto">
          {modal.products.map((p) => {
            const entry = entries.get(p.id) ?? { qty: '', causa: MERMA_CAUSAS[0] }
            const err = errors[p.id]
            return (
              <div key={p.id} className="panel p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-xs text-soft">Stock: {p.current_stock} {p.unit}</p>
                </div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder={`Cant. (${p.unit})`}
                  value={entry.qty}
                  onChange={(e) => updateQty(p.id, e.target.value)}
                  className={`input w-24 text-center ${err ? 'border-danger' : ''}`}
                  aria-label={`Cantidad de ${p.name}`}
                />
                {err && <span className="text-danger text-xs">{err}</span>}
              </div>
            )
          })}
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-line">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button disabled={busy} className="btn btn-primary">
            {busy ? 'Guardando…' : `Guardar ${modal.products.length} movimientos`}
          </button>
        </div>
      </form>
    </div>
  )
}