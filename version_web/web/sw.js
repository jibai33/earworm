const CACHE = 'earworm-v12';
const SHELL = ['./', './index.html', './app.css', './app.js', './boot.js', './taste.js', './taste-ui.js', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
/* 静态资源走网络优先：改版即时生效；断网时回退缓存，接口与音频代理一律不缓存。
   网络请求带 cache:'reload'，绕过浏览器 HTTP 缓存——否则 GitHub Pages 10 分钟的
   max-age 会让 SW 的「网络优先」其实拿到的是缓存的旧 index/app，改版不生效 */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req, { cache: 'reload' }).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
  );
});
