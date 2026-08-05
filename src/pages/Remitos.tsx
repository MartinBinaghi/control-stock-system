import { useEffect, useState } from 'react'
import { Plus, Upload, Camera, RotateCcw, Trash2, Check, ArrowLeft, History } from 'lucide-react'
import { api, getRemitos, type Product, type Remito, type RemitoItem } from '../lib/api'
import { normalize, parseRemito } from '../lib/parseRemito'

type Row = {
  productId: string | null
  rawName: string
  expected: number | null
  actual: string
}

type RemitoWithItems = Remito & { items: RemitoItem[] }

const DRAFT_KEY = 'remitos_draft'

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
  }
  return text
}

type Msg = { text: string; kind: 'ok' | 'warn' | 'err' } | null

export default function Remitos() {
  const [products, setProducts] = useState<Product[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [pdfName, setPdfName] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [remitoHistory, setRemitoHistory] = useState<RemitoWithItems[]>([])
  const [selectedRemito, setSelectedRemito] = useState<RemitoWithItems | null>(null)
  const [undoToast, setUndoToast] = useState<{ remito: Remito; items: Array<{ product_id: string; expected_qty: number; actual_qty: number }>; timeout: ReturnType<typeof setTimeout> } | null>(null)

  useEffect(() => {
    api<Product[]>('/products').then(setProducts)
    loadHistory()
  }, [])

  async function loadHistory() {
    try {
      const remitos = await getRemitos()
      // Para cada remito, cargar sus items
      const withItems = await Promise.all(
        remitos.map(async (r) => {
          const items = await api<RemitoItem[]>(`/remitos/${r.id}/items`)
          return { ...r, items }
        })
      )
      setRemitoHistory(withItems)
    } catch (e) {
      console.error('Error cargando historial:', e)
    }
  }

  // Restaurar draft al cargar
  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY)
    if (draft) {
      try {
        const parsed = JSON.parse(draft)
        if (parsed.rows && Array.isArray(parsed.rows)) {
          setRows(parsed.rows)
          setPdfName(parsed.pdfName || '')
          setMsg({ text: 'Borrador restaurado', kind: 'ok' })
          setTimeout(() => setMsg(null), 3000)
        }
      } catch {}
    }
  }, [])

  // Guardar draft automáticamente
  useEffect(() => {
    if (rows.length > 0) {
      const draft = { rows, pdfName, timestamp: Date.now() }
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } else {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [rows, pdfName])

  async function onFile(file: File) {
    setMsg(null)
    setPdfName(file.name)
    try {
      const text = await extractPdfText(file)
      const parsed = parseRemito(text)
      const byName = new Map(products.map((p) => [normalize(p.name), p.id]))
      setRows(
        parsed.map((l) => ({
          productId: byName.get(normalize(l.rawName)) ?? null,
          rawName: l.rawName,
          expected: l.expectedQty,
          actual: '',
        })),
      )
      if (parsed.length === 0)
        setMsg({ text: 'No se detectaron ítems en el PDF. Cargá las filas manualmente.', kind: 'warn' })
    } catch {
      setMsg({ text: 'No se pudo leer el PDF. Cargá las filas manualmente.', kind: 'err' })
    }
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function setAllActualToExpected() {
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        actual: r.expected !== null ? String(r.expected) : r.actual,
      })),
    )
  }

  function clearAllActual() {
    setRows((rs) => rs.map((r) => ({ ...r, actual: '' })))
  }

  function removeRow(index: number) {
    setRows((rs) => rs.filter((_, i) => i !== index))
  }

  async function confirm() {
    const valid = rows.filter((r) => r.productId && r.actual !== '')
    if (valid.length === 0) {
      setMsg({ text: 'Asigná producto y conteo físico a cada fila.', kind: 'warn' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const remito = await api<Remito>('/remitos', {
        method: 'POST',
        body: JSON.stringify({
          pdf_name: pdfName || 'carga manual',
          items: valid.map((r) => ({
            product_id: r.productId,
            expected_qty: r.expected ?? Number(r.actual),
            actual_qty: Number(r.actual),
          })),
        }),
      })
      // Guardar para posible deshacer
      const submittedItems: Array<{ product_id: string; expected_qty: number; actual_qty: number }> = valid.map((r) => ({
        product_id: r.productId!,
        expected_qty: r.expected ?? Number(r.actual),
        actual_qty: Number(r.actual),
      }))
      setRows([])
      setPdfName('')
      localStorage.removeItem(DRAFT_KEY)
      setMsg(
        remito.status === 'con_incongruencia'
          ? { text: 'Remito guardado CON incongruencias — se notificó al administrador.', kind: 'warn' }
          : { text: 'Remito guardado sin diferencias. Stock actualizado.', kind: 'ok' },
      )
      // Toast de deshacer
      const timeout = setTimeout(() => setUndoToast(null), 5000)
      setUndoToast({ remito, items: submittedItems, timeout })
      loadHistory()
    } catch (e) {
      setMsg({ text: 'Error al guardar el remito: ' + (e as Error).message, kind: 'err' })
    }
    setBusy(false)
  }

  async function undoLastRemito() {
    if (!undoToast) return
    // Nota: no hay endpoint DELETE para remitos, solo mostramos aviso
    // El admin puede resolver la alerta de desvío manualmente
    clearTimeout(undoToast.timeout)
    setMsg({ text: 'Deshacer no disponible: contactá al administrador para revertir el remito.', kind: 'warn' })
    setUndoToast(null)
  }

  function viewRemito(remito: RemitoWithItems) {
    setSelectedRemito(remito)
    setShowHistory(false)
  }

  function closeRemitoView() {
    setSelectedRemito(null)
  }

  const MSG_STYLE = {
    ok: 'text-ok bg-ok-soft border-ok/40',
    warn: 'text-warn bg-warn-soft border-warn/40',
    err: 'text-danger bg-danger-soft border-danger/40',
  }

  const productById = (id: string) => products.find((p) => p.id === id)

  return (
    <div className="space-y-4">
      {/* Header con tabs */}
      <div className="flex gap-2 border-b-2 border-line">
        <button
          onClick={() => setShowHistory(false)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-md border-2 border-line transition-colors ${
            !showHistory ? 'bg-surface border-b-2 border-surface text-ink' : 'bg-sunken text-soft hover:bg-surface'
          }`}
        >
          <Upload size={16} /> Nuevo Remito
        </button>
        <button
          onClick={() => { setShowHistory(true); loadHistory() }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-md border-2 border-line transition-colors ${
            showHistory ? 'bg-surface border-b-2 border-surface text-ink' : 'bg-sunken text-soft hover:bg-surface'
          }`}
        >
          <History size={16} /> Historial ({remitoHistory.length})
        </button>
      </div>

      {/* Vista: Nuevo Remito */}
      {!showHistory && !selectedRemito && (
        <div className="space-y-4 animate-fade-in">
          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-line rounded-md p-6 bg-surface cursor-pointer hover:border-accent hover:text-accent transition-colors duration-150">
            <Upload size={20} className="text-accent" />
            <span>{pdfName || 'Subir remito PDF de la fábrica'}</span>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>

          {/* Cámara para remitos en papel (futuro OCR) */}
          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-line/50 rounded-md p-3 bg-surface/50 cursor-pointer hover:border-warn hover:text-warn transition-colors duration-150">
            <Camera size={18} className="text-warn" />
            <span>Fotografiar remito en papel (próximamente OCR)</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setMsg({ text: 'OCR de imagen no implementado aún. Usá el PDF o carga manual.', kind: 'warn' })
                }
              }}
            />
          </label>

          {rows.length > 0 && (
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunken text-left font-pixel border-b-2 border-line">
                  <tr>
                    <th className="p-2">Producto</th>
                    <th className="p-2">Stock actual</th>
                    <th className="p-2">Esperado</th>
                    <th className="p-2">Conteo físico</th>
                    <th className="p-2 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const diff = r.actual !== '' && r.expected !== null && Number(r.actual) !== r.expected
                    const product = r.productId ? productById(r.productId) : null
                    return (
                      <tr key={i} className={diff ? 'bg-danger-soft' : ''}>
                        <td className="p-2">
                          <select
                            value={r.productId ?? ''}
                            onChange={(e) => setRow(i, { productId: e.target.value || null })}
                            className={`input px-2 py-1 w-full ${!r.productId ? 'border-danger' : ''}`}
                          >
                            <option value="">— {r.rawName || 'elegir producto'} —</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 tabular-nums text-soft">
                          {product ? `${product.current_stock} ${product.unit}` : '—'}
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            value={r.expected ?? ''}
                            onChange={(e) => setRow(i, { expected: e.target.value === '' ? null : Number(e.target.value) })}
                            className="input px-2 py-1 w-24 tabular-nums"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            value={r.actual}
                            onChange={(e) => setRow(i, { actual: e.target.value })}
                            className={`input px-2 py-1 w-24 tabular-nums ${diff ? 'border-danger text-danger font-semibold' : ''}`}
                          />
                        </td>
                        <td className="p-2">
                          <button
                            onClick={() => removeRow(i)}
                            className="p-1.5 text-danger hover:bg-danger-soft rounded-md"
                            aria-label="Eliminar fila"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => setRows((rs) => [...rs, { productId: null, rawName: '', expected: null, actual: '' }])}
              className="flex items-center gap-1 text-accent hover:underline cursor-pointer"
            >
              <Plus size={16} /> Agregar fila manual
            </button>

            {rows.length > 0 && (
              <>
                <button
                  onClick={setAllActualToExpected}
                  className="btn btn-ghost btn-sm"
                >
                  <Check size={14} /> Igualar todos
                </button>
                <button
                  onClick={clearAllActual}
                  className="btn btn-ghost btn-sm"
                >
                  <RotateCcw size={14} /> Limpiar físicos
                </button>
                <button
                  onClick={() => localStorage.removeItem(DRAFT_KEY)}
                  className="btn btn-ghost btn-sm"
                >
                  <Trash2 size={14} /> Descartar borrador
                </button>
              </>
            )}

            {rows.length > 0 && (
              <button onClick={confirm} disabled={busy} className="btn btn-primary ml-auto">
                {busy ? 'Guardando…' : 'Confirmar conteo'}
              </button>
            )}
          </div>

          {msg && <p className={`text-sm rounded-md border-2 p-3 ${MSG_STYLE[msg.kind]}`}>{msg.text}</p>}
        </div>
      )}

      {/* Vista: Historial de remitos */}
      {showHistory && !selectedRemito && (
        <div className="space-y-3 animate-fade-in">
          {remitoHistory.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-soft">
              <History size={64} />
              <p>No hay remitos registrados aún.</p>
            </div>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunken text-left font-pixel border-b-2 border-line">
                  <tr>
                    <th className="p-2">Fecha</th>
                    <th className="p-2">Sucursal</th>
                    <th className="p-2">PDF</th>
                    <th className="p-2">Estado</th>
                    <th className="p-2">Ítems</th>
                    <th className="p-2">Encargado</th>
                    <th className="p-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {remitoHistory.map((r) => (
                    <tr key={r.id} className="border-t border-line/50 hover:bg-sunken/50 cursor-pointer"
                      onClick={() => viewRemito(r)}>
                    <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString('es-AR')}</td>
                    <td className="p-2">{r.branch_name}</td>
                    <td className="p-2 truncate max-w-[150px]">{r.pdf_name}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-pixel ${
                        r.status === 'correcto' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'
                      }`}>
                        {r.status === 'correcto' ? '✓ Correcto' : '⚠ Incongruencia'}
                      </span>
                    </td>
                    <td className="p-2 tabular-nums">{r.items.length}</td>
                    <td className="p-2">{r.manager_name}</td>
                    <td className="p-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); viewRemito(r) }}
                        className="text-accent hover:underline text-xs"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Vista: Detalle de remito */}
      {selectedRemito && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between gap-2">
            <button onClick={closeRemitoView} className="btn btn-ghost">
              <ArrowLeft size={16} /> Volver
            </button>
            <div className="flex-1 text-center">
              <h3 className="font-pixel font-bold text-lg">{selectedRemito.pdf_name}</h3>
              <p className="text-sm text-soft">
                {selectedRemito.branch_name} · {new Date(selectedRemito.created_at).toLocaleString('es-AR')} · {selectedRemito.manager_name}
              </p>
            </div>
            <div className="w-20" />
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sunken text-left font-pixel border-b-2 border-line">
                <tr>
                  <th className="p-2">Producto</th>
                  <th className="p-2">Esperado</th>
                  <th className="p-2">Físico</th>
                  <th className="p-2">Desvío</th>
                </tr>
              </thead>
              <tbody>
                {selectedRemito.items.map((item, i) => {
                  const product = productById(item.product_id)
                  const diff = item.discrepancy_qty
                  return (
                    <tr key={item.id} className={diff !== 0 ? 'bg-danger-soft' : ''}>
                      <td className="p-2 font-medium">{product?.name ?? 'Producto eliminado'}</td>
                      <td className="p-2 tabular-nums">{item.expected_qty} {product?.unit ?? ''}</td>
                      <td className="p-2 tabular-nums">{item.actual_qty} {product?.unit ?? ''}</td>
                      <td className={`p-2 tabular-nums font-semibold ${diff > 0 ? 'text-ok' : diff < 0 ? 'text-danger' : 'text-soft'}`}>
                        {diff > 0 ? '+' : ''}{diff} {product?.unit ?? ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <span className={`px-3 py-1.5 rounded-md font-pixel text-sm ${
              selectedRemito.status === 'correcto' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'
            }`}>
              {selectedRemito.status === 'correcto' ? '✓ Sin diferencias' : '⚠ Con incongruencias'}
            </span>
          </div>
        </div>
      )}

      {/* Toast de deshacer */}
      {undoToast && (
        <div className="fixed bottom-4 right-4 z-20 animate-slide-in">
          <div className="card p-4 flex items-center gap-3 min-w-[280px] max-w-md shadow-lg">
            <Check className="text-ok" size={20} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Remito guardado</p>
              <p className="text-xs text-soft truncate">
                {undoToast.items.length} ítems · {undoToast.remito.status === 'correcto' ? 'Correcto' : 'Con incongruencias'}
              </p>
            </div>
            <button
              onClick={undoLastRemito}
              className="btn btn-ghost btn-sm px-2 py-1 shrink-0"
            >
              Deshacer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}