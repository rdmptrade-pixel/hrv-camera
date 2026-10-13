// Работа без интернета: отдаём файлы из сохранённой копии, а при наличии сети тихо обновляем её.
// При изменении состава файлов — поднять номер версии.
const CACHE = 'hrv-camera-v4'
const FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './lib/camera.js',
  './lib/signal.js',
  './lib/offline.js',
  './lib/baevsky.js',
  './lib/result.js',
  './lib/history.js',
  './lib/spectrum.js',
  './lib/risk.js',
  './lib/noise.js',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true })
      const fresh = fetch(e.request)
        .then((resp) => {
          if (resp.ok && new URL(e.request.url).origin === location.origin) cache.put(e.request, resp.clone())
          return resp
        })
        .catch(() => cached)
      return cached || fresh
    })
  )
})
