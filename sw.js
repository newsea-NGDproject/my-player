const CACHE_NAME = 'norirun-v57';

const ASSETS = [
  'index.html',
  'dbclr.html',
  'c011.html',
  'c012.html',
  'c013.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'click.wav'
];

// インストール時にファイルをキャッシュに保存するぜ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('アセットをキャッシュ中...');
      return cache.addAll(ASSETS);
    })
  );
});

// 新しいService Workerが有効になった時、古いキャッシュを削除する
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('古いキャッシュ削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 起動時はキャッシュから最速で読み込んで、オフラインでも動かすぜ
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => {
      return response || fetch(e.request);
    })
  );
});
