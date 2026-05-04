// ATIK Service Worker — автоматична інвалідація кешу
// Не потребує ручного оновлення версії.
// При кожному запуску перевіряє чи змінився index.html,
// і якщо так — повністю очищає кеш.

const CACHE_NAME = 'atik-cache';

// ── Утиліта: простий хеш рядка ─────────────────────────────
async function hashText(text) {
  const buf = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Встановлення ────────────────────────────────────────────
self.addEventListener('install', event => {
  // Одразу стаємо активним, не чекаємо закриття вкладок
  self.skipWaiting();
});

// ── Активація ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// ── Fetch ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / Google APIs — завжди пряма мережа, без кешу
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  // index.html — Network First з автоматичною інвалідацією
  const isIndex =
    url.pathname.endsWith('index.html') ||
    url.pathname.endsWith('/') ||
    url.pathname === '/';

  if (isIndex) {
    event.respondWith(handleIndex(event.request));
    return;
  }

  // Решта (manifest, іконки) — Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Логіка для index.html ───────────────────────────────────
async function handleIndex(request) {
  try {
    // Завантажуємо свіжий файл з мережі
    const networkResponse = await fetch(request);
    if (!networkResponse.ok) throw new Error('Network error');

    const freshText = await networkResponse.clone().text();
    const freshHash = await hashText(freshText);

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached) {
      const cachedText = await cached.clone().text();
      const cachedHash = await hashText(cachedText);

      if (freshHash !== cachedHash) {
        // Файл змінився — очищаємо весь кеш і зберігаємо новий
        console.log('[SW] index.html змінився, очищаю кеш...');
        await caches.delete(CACHE_NAME);
        const newCache = await caches.open(CACHE_NAME);
        await newCache.put(request, networkResponse.clone());

        // Повідомляємо всі відкриті вкладки
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client =>
          client.postMessage({ type: 'SW_UPDATED' })
        );
      }
    } else {
      // Перший запуск — просто кешуємо
      await cache.put(request, networkResponse.clone());
    }

    return networkResponse;

  } catch {
    // Офлайн — повертаємо з кешу
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Офлайн — збереженої версії немає', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}
