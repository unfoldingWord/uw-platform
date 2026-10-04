export async function registerWorker(navigator: Navigator): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}
