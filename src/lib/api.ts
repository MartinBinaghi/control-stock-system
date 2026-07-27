// Cliente de la API propia (server/index.ts). En dev, Vite proxya /api al
// puerto 3001; en producción el mismo Express sirve el frontend.

const TOKEN_KEY = 'dipolo_token'

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
  role: 'admin' | 'encargado'
  branch_id: string | null
}

export type Product = {
  id: string
  name: string
  category: string | null
  unit: string
  min_stock_threshold: number
}

export type Branch = { id: string; name: string }

export type Alert = {
  id: string
  branch_id: string
  product_id: string
  type: 'stock_critico' | 'desvio_remito'
  message: string
  resolved: boolean
  created_at: string
}

export type MovementType = 'ingreso_manual' | 'egreso_manual' | 'merma' | 'remito_fabrica'
