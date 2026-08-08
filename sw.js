const CACHE_NAME = 'norirun-v68';

const ASSETS = [
  'index.html',
  'dbclr.html',
  'c011.html',
  'c012.html',
  'c013.html',
  'c014.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'click.wav'
];

// インストール時にファイルをキャッシュに保存するぜ
self.addEventListener('install', e => {
  // 新しいService Workerを「待機」させず、すぐに有効化させる。
  // これが無いと、古いタブが完全に閉じるまで新しいコードに
  // 切り替わらず、CACHE_NAMEを繰り上げても更新が反映されない。
  self.skipWaiting();

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
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('古いキャッシュ削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );

      // 有効化した新しいService Workerに、
      // 今すでに開いているページの制御もすぐ渡す。
      // これが無いと、開いたままのタブは有効化後も
      // 古いService Workerに操作され続けてしまう。
      await self.clients.claim();
    })()
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
