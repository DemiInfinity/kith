// Kith service worker: makes the app installable, keeps the app shell for flaky signal, and shows
// check-in notifications. It never caches conversations or API responses.
const SHELL = "kith-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/favicon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  // Network first for pages and built files, falling back to the shell when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname === "/")) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Kith", body: "", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url }, tag: data.tag || "kith" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
