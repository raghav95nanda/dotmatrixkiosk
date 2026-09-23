const CACHE_NAME = 'matrix-kiosk-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './Head.svg',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './mediapipe/selfie_segmentation.js',
  './mediapipe/selfie_segmentation.binarypb',
  './mediapipe/selfie_segmentation.tflite',
  './mediapipe/selfie_segmentation_landscape.tflite',
  './mediapipe/selfie_segmentation_solution_simd_wasm_bin.js',
  './mediapipe/selfie_segmentation_solution_simd_wasm_bin.wasm',
  './mediapipe/selfie_segmentation_solution_simd_wasm_bin.data',
  './mediapipe/selfie_segmentation_solution_wasm_bin.js',
  './mediapipe/selfie_segmentation_solution_wasm_bin.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Offline and resource not cached.');
      });
    })
  );
});
