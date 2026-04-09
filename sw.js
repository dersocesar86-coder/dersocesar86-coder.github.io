const CACHE  = 'performance-v5';
const STATIC = [
  '/index.html',
  '/auth.html',
  '/manifest.json',
  '/icon.svg',
];

// HTML files que nunca devem ser cacheados (sempre busca do servidor)
const NO_CACHE = ['/admin.html', '/index.html', '/auth.html'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  if(
    e.request.url.includes('firebase') ||
    e.request.url.includes('googleapis') ||
    e.request.url.includes('gstatic') ||
    e.request.url.includes('cdnjs') ||
    e.request.url.includes('fonts.g')
  ) return;

  // Arquivos HTML: network-first (sempre pega versão mais recente)
  const isHTML = NO_CACHE.some(p => e.request.url.endsWith(p)) || e.request.url.endsWith('/');
  if(isHTML){
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Demais assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

