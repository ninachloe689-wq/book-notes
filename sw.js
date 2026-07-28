// Service Worker for PWA
self.skipWaiting();
self.addEventListener('install', function(event) { event.waitUntil(self.skipWaiting()); });
var CACHE_NAME = 'bookshelf-v3';
var urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// 安装
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(urlsToCache);
      })
  );
});

// 激活
self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 拦截请求
self.addEventListener('fetch', function(event) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
  });
