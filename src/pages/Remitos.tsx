import { useEffect, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { api, type Product } from '../lib/api'
import { normalize, parseRemito } from '../lib/parseRemito'

type Row = {
  productId: string | null
  rawName: string
  expected: number | null
  actual: string
}

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

export default function Remitos() {
  const [products, setProducts] = useState<Product[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [pdfName, setPdfName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Product[]>('/products').then(setProducts)
  }, [])

  async function onFile(file: File) {
    setMsg('')
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
        setMsg('No se detectaron ítems en el PDF. Cargá las filas manualmente.')
    } catch {
      setMsg('No se pudo leer el PDF. Cargá las filas manualmente.')
    }
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  // Un solo POST: el servidor guarda remito + items + movimientos + alertas
  // de desvío en una transacción.
  async function confirm() {
    const valid = rows.filter((r) => r.productId && r.actual !== '')
    if (valid.length === 0) {
      setMsg('Asigná producto y conteo físico a cada fila.')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const remito = await api<{ status: string }>('/remitos', {
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
      setRows([])
      setPdfName('')
      setMsg(
        remito.status === 'con_incongruencia'
          ? 'Remito guardado CON incongruencias — se notificó al administrador.'
          : 'Remito guardado sin diferencias. Stock actualizado.',
      )
    } catch (e) {
      setMsg('Error al guardar el remito: ' + (e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-amber-300 rounded-xl p-6 bg-white cursor-pointer hover:bg-amber-50">
        <Upload size={20} className="text-amber-700" />
        <span>{pdfName || 'Subir remito PDF de la fábrica'}</span>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>

      {rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-amber-100 text-left">
              <tr>
                <th className="p-2">Producto</th>
                <th className="p-2">Esperado</th>
                <th className="p-2">Conteo físico</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const diff = r.actual !== '' && r.expected !== null && Number(r.actual) !== r.expected
                return (
                  <tr key={i} className={diff ? 'bg-red-50' : ''}>
                    <td className="p-2">
                      <select
                        value={r.productId ?? ''}
                        onChange={(e) => setRow(i, { productId: e.target.value || null })}
                        className={`border rounded px-2 py-1 w-full ${!r.productId ? 'border-red-400' : ''}`}
                      >
                        <option value="">— {r.rawName || 'elegir producto'} —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        value={r.expected ?? ''}
                        onChange={(e) => setRow(i, { expected: e.target.value === '' ? null : Number(e.target.value) })}
                        className="border rounded px-2 py-1 w-24"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        value={r.actual}
                        onChange={(e) => setRow(i, { actual: e.target.value })}
                        className={`border rounded px-2 py-1 w-24 ${diff ? 'border-red-500 text-red-700 font-semibold' : ''}`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={() => setRows((rs) => [...rs, { productId: null, rawName: '', expected: null, actual: '' }])}
        className="flex items-center gap-1 text-amber-800 hover:underline"
      >
        <Plus size={16} /> Agregar fila manual
      </button>

      {rows.length > 0 && (
        <button
          onClick={confirm}
          disabled={busy}
          className="bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
        >
          Confirmar conteo
        </button>
      )}
      {msg && <p className="text-sm text-amber-900 bg-amber-100 rounded-lg p-3">{msg}</p>}
    </div>
  )
}
