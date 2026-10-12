import {
  isShellAsset,
  pushNotification,
  pushPayload,
  shellCacheName,
  staleCaches,
} from './sw-core.ts';

declare const UW_SHELL_ASSETS: readonly string[];
declare const self: ServiceWorkerGlobalScope;

const CACHE = shellCacheName(UW_SHELL_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...UW_SHELL_ASSETS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(staleCaches(keys, UW_SHELL_ASSETS).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function cachedFirst(request: Request): Promise<Response> {
  return caches.match(request).then((hit) => hit ?? fetch(request));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isShellAsset(url.pathname, UW_SHELL_ASSETS)) return;
  event.respondWith(cachedFirst(request));
});

function payloadOf(event: PushEvent): unknown {
  try {
    return event.data?.json() ?? null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const shown = pushNotification(pushPayload(payloadOf(event)));
  event.waitUntil(self.registration.showNotification(shown.title, shown.options));
});

async function openLink(link: string): Promise<void> {
  const target = new URL(link, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => client.url === target);
  if (open !== undefined) {
    await open.focus();
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  event.waitUntil(openLink(pushPayload(data).link));
});
