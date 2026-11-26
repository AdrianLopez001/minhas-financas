// Guarda o app no aparelho para funcionar sem internet.
// Estratégia: abre sempre da cópia salva (rápido e offline) e, se houver internet,
// baixa a versão nova em segundo plano — ela aparece na próxima vez que abrir o app.
// Os SEUS DADOS não passam por aqui: ficam no armazenamento do próprio app.
const CACHE = 'financas-v3';
const FILES = ['./', './index.html', './styles.css', './app.js', './manifest.json',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (await cache.match('./index.html'));
    })
  );
});
