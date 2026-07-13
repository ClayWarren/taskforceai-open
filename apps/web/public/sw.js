// @ts-check
/// <reference lib="webworker" />

const serviceWorker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

serviceWorker.addEventListener('install', (event) => {
  event.waitUntil(serviceWorker.skipWaiting());
});

serviceWorker.addEventListener('activate', (event) => {
  event.waitUntil(
    serviceWorker.registration
      .unregister()
      .then(
        () =>
          /** @type {Promise<WindowClient[]>} */ (
            serviceWorker.clients.matchAll({ type: 'window' })
          )
      )
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
  );
});
