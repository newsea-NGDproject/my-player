const CACHE_NAME = 'norirun-v10';
const ASSETS = [
  'index.html',
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

// 起動時はキャッシュから最速で読み込んで、オフラインでも動かすぜ
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => {
      return response || fetch(e.request);
    })
  );
});
