// Cliente de la API propia (server/index.ts). En dev, Vite proxya /api al
// puerto 3001; en producción el mismo Express sirve el frontend.

const TOKEN_KEY = 'stockcito_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export type Profile = {
  id: string
  email: string
  name: string
  role: 'admin' | 'encargado'
  branch_id: string | null
}

export type Worker = {
  id: string
  email: string
  name: string
  branch_id: string
  verified: boolean
}

export type Process = { id: string; name: string }

export type RecipeItem = { ingredient_id: string; quantity: number }

export type Product = {
  id: string
  name: string
  category: string | null
  unit: string
  unit_symbol: string | null
  min_stock_threshold: number
  process_id: string | null
  is_raw_material: boolean
  recipe: RecipeItem[]
  current_stock?: number
}

export type Unit = { id: string; name: string; symbol: string | null }

export type Branch = { id: string; name: string; address: string | null }

export type Alert = {
  id: string
  branch_id: string
  product_id: string
  type: 'stock_critico' | 'desvio_remito' | 'insumo_negativo'
  message: string
  resolved: boolean
  created_at: string
}

export type Remito = {
  id: string
  branch_id: string
  branch_name: string
  pdf_name: string
  status: 'correcto' | 'con_incongruencia'
  manager_name: string
  created_at: string
}

export type RemitoItem = {
  id: string
  remito_id: string
  product_id: string
  product_name: string
  unit: string
  expected_qty: number
  actual_qty: number
  discrepancy_qty: number
}

export type MovementType = 'ingreso_manual' | 'egreso_manual' | 'merma' | 'remito_fabrica' | 'produccion' | 'consumo_produccion'

export type Movement = {
  id: string
  branch_id: string
  product_id: string
  type: MovementType
  quantity: number
  manager_name: string
  reason: string | null
  created_at: string
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  ingreso_manual: 'Entrada',
  egreso_manual: 'Salida',
  merma: 'Merma',
  remito_fabrica: 'Remito fábrica',
  produccion: 'Producción',
  consumo_produccion: 'Consumo (producción)',
}

export function updateProduct(
  id: string,
  data: Partial<Pick<Product, 'name' | 'category' | 'unit' | 'min_stock_threshold' | 'process_id' | 'is_raw_material'>> & { recipe?: RecipeItem[] },
) {
  return api<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function createProcess(name: string) {
  return api<Process>('/processes', { method: 'POST', body: JSON.stringify({ name }) })
}

export function updateProcess(id: string, name: string) {
  return api<Process>(`/processes/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function deleteProcess(id: string) {
  return api(`/processes/${id}`, { method: 'DELETE' })
}

export function produce(data: { product_id: string; quantity: number; branch_id?: string; force?: boolean }) {
  return api<{ ok: true }>('/production', { method: 'POST', body: JSON.stringify(data) })
}

export function deleteProduct(id: string) {
  return api(`/products/${id}`, { method: 'DELETE' })
}

export function createAlert(data: { branch_id: string; product_id: string; type: Alert['type']; message: string }) {
  return api<Alert>('/alerts', { method: 'POST', body: JSON.stringify(data) })
}

export function updateBranch(id: string, data: { name: string; address: string | null }) {
  return api<Branch>(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteBranch(id: string) {
  return api(`/branches/${id}`, { method: 'DELETE' })
}

export function getUnits() {
  return api<Unit[]>('/units')
}

export function createUnit(data: { name: string; symbol?: string | null }) {
  return api<Unit>('/units', { method: 'POST', body: JSON.stringify(data) })
}

export function updateUnit(id: string, data: { name: string; symbol?: string | null }) {
  return api<Unit>(`/units/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteUnit(id: string) {
  return api(`/units/${id}`, { method: 'DELETE' })
}

export function resendInvite(id: string) {
  return api(`/team/${id}/resend`, { method: 'POST' })
}

export function getRemitos() {
  return api<Remito[]>('/remitos')
}

export function getMovements(branchId?: string) {
  return api<Movement[]>('/movements' + (branchId ? `?branch=${branchId}` : ''))
}
