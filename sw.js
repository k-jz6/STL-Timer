// キャッシュの名前（バージョン管理用）
const CACHE_NAME = 'timer-app-v1';

// キャッシュするファイルのリスト
// ※ここにあるファイルがオフラインでも読めるようになります
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// インストール時：ファイルをキャッシュに保存
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(ASSETS);
            })
    );
});

// 起動時：古いキャッシュを削除（バージョンアップ用）
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});

// 通信時：キャッシュがあればそこから返す（オフライン対応）
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // キャッシュにあればそれを返す、なければネットに取りに行く
                return response || fetch(event.request);
            })
    );
});