import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

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
