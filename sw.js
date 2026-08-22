const CACHE_NAME = 'norirun-v128';

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
  'click.wav',

  // 外部ライブラリ(音楽メタデータ解析用)。
  // CDNから読み込まずリポジトリに同梱しているのは、ランニング中=電波が
  // 悪い場所で使うアプリのため。ここに登録してキャッシュさせることで、
  // 圏外でもタイトルやジャケットの取得が動く。
  'lib/jsmediatags.min.js',

  // c014(メインメニュー)のJavaScript。
  // v73で、c014.htmlに直接書いていた約1,900行を機能ごとに分割した。
  //
  // 【重要】js/ にファイルを追加したら、必ずここにも追記すること。
  // 登録を忘れると、そのファイルだけキャッシュされず、圏外や
  // オフラインでメインメニューが動かなくなる。
  // 初期設定画面のデザイン。v77で c012.html から移設した。
  'css/setup.css',

  'js/config.js',
  'js/db.js',
  'js/setup.js',
  'js/scanner.js',
  'js/nori.js',
  'js/exclude.js',
  'js/favorite.js',
  'js/sort.js',
  'js/undo.js',
  'js/list-view.js',
  'js/bpm.js',
  'js/upper-area.js',
  'js/pitch.js',
  'js/settings.js',
  'js/player.js',
  'js/queue.js',
  'js/media-session.js',
  'js/drag-sort.js',
  'js/jump.js',
  'js/lamp.js',
  'js/metadata.js',
  'js/main.js'
];

// インストール時にファイルをキャッシュに保存するぜ
self.addEventListener('install', e => {
  // 新しいService Workerを「待機」させず、すぐに有効化させる。
  // これが無いと、古いタブが完全に閉じるまで新しいコードに
  // 切り替わらず、CACHE_NAMEを繰り上げても更新が反映されない。
  self.skipWaiting();

  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      console.log('アセットをキャッシュ中...');

      /*
      【v71で修正した重要な落とし穴】

      以前はここで cache.addAll(ASSETS) を使っていた。
      addAll は「全部まとめて登録」する便利な命令だが、
      リストの中に1つでも取得できないファイルがあると
      全体が失敗し、その結果 Service Worker の
      インストールごと失敗してしまう。

      実際にv70で事故が起きた。ASSETSに追加した
      lib/jsmediatags.min.js がサーバー上に無かったため、
      Service Workerが更新できない状態に陥り、
      「CACHE_NAMEを繰り上げたのに古いコードが動き続ける」
      という分かりにくい不具合になった。

      そこで1ファイルずつ登録し、失敗しても
      ログを残して次に進む方式に変更した。
      これなら1つ足りなくてもアプリ本体は動く。
      */
      for (const asset of ASSETS) {
        try {
          // cache.add は「取得してキャッシュに保存」を1件だけ行う命令
          await cache.add(asset);
        } catch (error) {
          console.error('キャッシュ失敗(処理は続行):', asset, error);
        }
      }

      console.log('キャッシュ完了');
    })()
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
