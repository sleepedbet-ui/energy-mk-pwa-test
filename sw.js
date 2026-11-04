/**
 * Service Worker: Світло Миколаїв PWA
 * Забезпечує роботу в автономному режимі (offline), кешування статичних ресурсів
 * та перехоплення/кешування запитів до API графіків відключень.
 */

const CACHE_NAME = 'energy-mk-cache-v6';

// Ресурси оболонки додатку (App Shell)
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './test.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/**
 * Подія install: завантажуємо та зберігаємо у кеші критичні файли App Shell
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Кешування App Shell');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

/**
 * Подія activate: видаляємо старі версії кешу при оновленні версії
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Видалення застарілого кешу:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Подія fetch:
 * - Для статичних локальних ресурсів: Stale-While-Revalidate (швидкий показ з кешу + фонове оновлення).
 * - Для запитів до API (off.energy.mk.ua або test.json): Network-First із кешуванням успішної відповіді.
 *   У разі відсутності зв'язку (offline) повертається остання збережена копія з кешу.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Обробка тільки GET-запитів
  if (request.method !== 'GET') {
    return;
  }

  // 1. Запити до API Миколаївобленерго
  if (url.hostname.includes('energy.mk.ua') || url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Якщо відповідь успішна, клонуємо її у кеш
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          // Мережа недоступна: шукаємо відповідь у кеші
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            console.log('[SW] Отримано API з кешу (offline):', request.url);
            return cachedResponse;
          }
          // Якщо навіть у кеші немає, повертаємо порожній JSON або помилку
          return new Response(JSON.stringify({ error: 'offline', cached: false }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 2. Статичні файли (App Shell)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Якщо це навігація по сторінці і мережі немає - віддаємо головний index.html
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Слухач повідомлень від клієнта (наприклад, для примусового оновлення)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
