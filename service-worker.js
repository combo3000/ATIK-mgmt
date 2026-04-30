// ATIK Service Worker v1.0
// Кешує основні ресурси для офлайн-роботи

const CACHE_NAME = 'atik-v1';

// Файли які кешуємо при встановленні
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js',
];

// Встановлення — кешуємо статику
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Кешуємо локальні файли; зовнішні — по одному з ігноруванням помилок
        return cache.addAll(['./index.html', './manifest.json'])
          .then(() => {
            return Promise.allSettled(
              PRECACHE_URLS.slice(2).map(url =>
                cache.add(url).catch(() => { /* ігноруємо якщо CDN недоступний */ })
              )
            );
          });
      })
      .then(() => self.skipWaiting())
  );
});

// Активація — видаляємо старі кеші
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch — стратегія: Network First для Firebase, Cache First для статики
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / Google APIs — завжди мережа, без кешу
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken')
  ) {
    return; // браузер робить запит напряму
  }

  // Для решти — Cache First з fallback на мережу
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request)
          .then(response => {
            // Кешуємо тільки успішні GET-відповіді
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
            // Офлайн-fallback: повертаємо index.html для навігаційних запитів
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});
