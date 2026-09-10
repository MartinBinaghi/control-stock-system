// Canal realtime por WebSocket (server: /api/realtime en server/index.ts).
// Reemplaza al EventSource/SSE anterior. Un solo socket por pestaña que recibe
// alertas, cambios de inventario y movimientos del tenant logueado.

import { getToken, type Alert, type Movement } from './api'

export type RealtimeEvent =
  | ({ kind: 'alert' } & Alert)
  | { kind: 'inventory'; branch_id: string; product_id: string; current_stock: number }
  | { kind: 'movement'; row: Movement }

// Backoff de reconexión: 1s, 2s, 5s, y de ahí 10s fijo.
const BACKOFF = [1000, 2000, 5000, 10000]

export function connectRealtime(handlers: {
  onEvent: (e: RealtimeEvent) => void
  // Se llama en cada (re)conexión. El consumidor la usa para re-hacer su fetch
  // inicial y ponerse al día con lo que se haya perdido mientras estuvo caído.
  onConnect?: () => void
}): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined

  function open() {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/realtime?token=${getToken() ?? ''}`)

    ws.onopen = () => {
      attempt = 0
      handlers.onConnect?.()
    }
    ws.onmessage = (e) => {
      try {
        handlers.onEvent(JSON.parse(e.data as string) as RealtimeEvent)
      } catch {
        // frames de control / no-JSON: ignorar
      }
    }
    ws.onclose = () => {
      if (closed) return
      retry = setTimeout(open, BACKOFF[Math.min(attempt, BACKOFF.length - 1)])
      attempt++
    }
    ws.onerror = () => ws?.close() // onclose se encarga del retry
  }

  open()

  return () => {
    closed = true
    clearTimeout(retry)
    ws?.close()
    ws = null
  }
}
