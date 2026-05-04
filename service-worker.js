// ATIK Service Worker v2.0
// Ключове виправлення: змінюй BUILD_DATE при кожному деплої —
// це автоматично інвалідує старий кеш і підтягне нові файли.

const BUILD_DATE = '2026-05-04'; // ← ЗМІНЮЙ ЦЕ при кожному оновленні index.html
const CACHE_NAME = 'atik-v2-' + BUILD_DATE;

const PRECACHE_URLS = [
  './manifest.json',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js',
];

// ── Встановлення ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // manifest та Firebase CDN — кешуємо (вони не змінюються)
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(() => {}))
        );
      })
      // Одразу активуємось, не чекаємо закриття старих вкладок
      .then(() => self.skipWaiting())
  );
});

// ── Активація — видаляємо ВСІ старі кеші ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Видаляю старий кеш:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch стратегія ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / Google APIs — завжди пряма мережа, без кешу
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('firebaseapp.com')
  ) {
    return;
  }

  // index.html — ЗАВЖДИ Network First
  // Якщо мережа є — береться свіжий файл.
  // Якщо офлайн — fallback на кеш.
  if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Зберігаємо свіжу копію в кеш
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Офлайн — повертаємо закешовану версію
          return caches.match('./index.html');
        })
    );
    return;
  }

  // Всі інші статичні файли — Cache First (manifest, іконки тощо)
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(response => {
            if (
              event.request.method === 'GET' &&
              response.status === 200 &&
              response.type !== 'opaque'
            ) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});
