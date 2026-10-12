export type Refresher = { refresh(): Promise<void> };

type RefreshDeps = {
  readonly document: Document;
  readonly fetch: typeof fetch;
  readonly morph: (target: Element, html: string) => void;
};

export function createRefresher(deps: RefreshDeps): Refresher {
  let issued = 0;
  let applied = 0;
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  async function fetchAndApply(sequence: number): Promise<void> {
    const response = await deps
      .fetch(deps.document.location.href, {
        headers: { 'x-uw-fragment': 'main', accept: 'text/html' },
      })
      .catch(() => null);
    if (response === null || !response.ok) return;
    const html = await response.text().catch(() => null);
    const target = deps.document.getElementById('main');
    if (html === null || target === null || sequence <= applied) return;
    applied = sequence;
    deps.morph(target, html);
  }

  function start(): Promise<void> {
    issued += 1;
    const running = fetchAndApply(issued).finally(() => {
      inFlight = null;
    });
    inFlight = running;
    return running;
  }

  return {
    refresh: () => {
      if (inFlight === null) return start();
      if (queued === null) {
        queued = inFlight
          .catch(() => undefined)
          .then(() => {
            queued = null;
            return start();
          });
      }
      return queued;
    },
  };
}
