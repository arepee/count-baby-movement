/* Baby Movement service worker: push notifications only, no offline caching. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }
  const title = data.title || "Baby Movement";
  const options = {
    body: data.body || "Time to log baby movement.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "bm-reminder",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
        } catch {
          // focus can fail if not allowed; fall through to navigate/open
        }
        if ("navigate" in client && client.url !== target) {
          try {
            await client.navigate(target);
          } catch {
            // navigate fails for uncontrolled clients; focusing is good enough
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
