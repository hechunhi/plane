// BARSOUL: 自毁 Service Worker（kill-switch）。
//
// 背景：Plane 早期 Next.js / next-pwa 时代在用户浏览器注册过一个 workbox
// Service Worker，会拦截请求喂旧缓存（NetworkFirst start-url + 把 Authelia
// opaqueredirect 伪造成 200 缓存）。当前 React-Router 7 构建已不再注册任何
// SW，但那个僵尸 SW 仍残留在每个员工浏览器里，导致前端部署后“修了像没修”、
// 强刷(Cmd+Shift+R)无效、只有隐私窗口正常。
//
// 此脚本只做一件事：注销自己 + 清空所有 Cache Storage + 让打开的页面重载。
// 浏览器对已安装 SW 会定期(导航时/≤24h)重新拉取 sw.js 做更新检查；配合
// Caddy 对 /sw.js 强制 no-store，僵尸 SW 会在下次检查时拉到本脚本、安装、
// 自我了断 —— 全员浏览器自动清理，无需任何人手动操作。一次性根治。

self.addEventListener("install", () => {
  // 立即接管，不等旧 worker 释放
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. 清空所有缓存（旧 workbox 的 start-url / dev 等）
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        /* noop */
      }
      // 2. 注销自身（之后该作用域不再有 SW 控制）
      try {
        await self.registration.unregister();
      } catch (e) {
        /* noop */
      }
      // 3. 让当前受控页面重载一次，立即脱离旧 SW 控制、拿到最新构建
      try {
        const cs = await self.clients.matchAll({ type: "window" });
        for (const c of cs) {
          try {
            c.navigate(c.url);
          } catch (e) {
            /* noop */
          }
        }
      } catch (e) {
        /* noop */
      }
    })()
  );
});

// 关键：不注册任何 fetch 处理器 —— 所有请求直接走网络，
// 彻底消除缓存劫持。（此 worker 存在的唯一目的就是把自己清掉。）
