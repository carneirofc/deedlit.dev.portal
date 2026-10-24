// Kill switch for the service worker the old deedlit.dev site registered.
//
// That worker cached every navigation. Now that every page sits behind a
// session, that would mean authenticated HTML parked in Cache Storage. Browsers
// re-fetch this script when checking for updates, install this version, and it
// deletes every cache and unregisters itself. Nothing registers a worker any
// more; keep this file until no browser can plausibly still hold the old one.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url);
    })()
  );
});
