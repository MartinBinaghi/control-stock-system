/// <reference lib="webworker" />
const sw = self as unknown as ServiceWorkerGlobalScope

sw.addEventListener('install', () => sw.skipWaiting())
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()))

sw.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    sw.registration.showNotification(data.title ?? 'Stockcito', {
      body: data.body ?? 'Nueva alerta de stock',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  )
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(sw.clients.openWindow('/'))
})
