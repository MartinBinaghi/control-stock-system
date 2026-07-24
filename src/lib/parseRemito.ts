export type RemitoLine = { rawName: string; expectedQty: number }

// ponytail: parser stub sobre patrón genérico "NOMBRE PRODUCTO   CANTIDAD".
// Ajustar la regex cuando haya un PDF real de muestra de la fábrica (formato fijo).
export function parseRemito(text: string): RemitoLine[] {
  const lines = text.split('\n')
  const items: RemitoLine[] = []
  for (const line of lines) {
    const m = line.trim().match(/^(.+?)\s{2,}(\d+(?:[.,]\d+)?)$/)
    if (!m) continue
    const name = m[1].trim()
    // descarta encabezados/totales típicos
    if (/^(total|subtotal|producto|cantidad|fecha|remito)/i.test(name)) continue
    items.push({ rawName: name, expectedQty: Number(m[2].replace(',', '.')) })
  }
  return items
}

// matching por normalización básica contra el catálogo
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
