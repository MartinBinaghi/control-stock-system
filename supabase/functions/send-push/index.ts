// Edge Function: send-push
// Invocada por un Database Webhook en INSERT sobre la tabla alerts.
// Envía Web Push (VAPID) a todas las suscripciones registradas.
// Secrets requeridos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen inyectados por Supabase)

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

Deno.serve(async (req) => {
  const { record } = await req.json() // payload del webhook: la fila insertada en alerts
  if (!record?.message) return new Response('no record', { status: 400 })

  webpush.setVapidDetails(
    'mailto:admin@dipolopastas.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ponytail: se envía a todas las suscripciones (solo los admins tienen el
  // botón de suscribirse). Filtrar por rol si algún día se suscriben encargados.
  const { data: subs } = await supabase.from('push_subscriptions').select('id, subscription')

  const payload = JSON.stringify({
    title: record.type === 'desvio_remito' ? 'Di Polo — Desvío de remito' : 'Di Polo — Stock crítico',
    body: record.message,
  })

  const results = await Promise.allSettled(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, payload)
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode
        // suscripción muerta (navegador desinstalado/permiso revocado): limpiar
        if (code === 404 || code === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id)
        }
        throw err
      }
    }),
  )

  const sent = results.filter((r) => r.status === 'fulfilled').length
  return new Response(JSON.stringify({ sent, total: subs?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
