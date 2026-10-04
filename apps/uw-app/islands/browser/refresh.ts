export type Refresher = { refresh(): Promise<void> };

type RefreshDeps = {
  readonly document: Document;
  readonly fetch: typeof fetch;
  readonly morph: (target: Element, html: string) => void;
};

const OUTSTANDING_LIMIT = 2;

export function createRefresher(deps: RefreshDeps): Refresher {
  let issued = 0;
  let applied = 0;
  const outstanding: Promise<void>[] = [];

  async function fetchAndApply(sequence: number): Promise<void> {
    const response = await deps
      .fetch(deps.document.location.href, {
        headers: { 'x-uw-fragment': 'main', accept: 'text/html' },
      })
      .catch(() => null);
    if (response === null || !response.ok) return;
    const html = await response.text();
    const target = deps.document.getElementById('main');
    if (target === null || sequence <= applied) return;
    applied = sequence;
    deps.morph(target, html);
  }

  return {
    refresh: () => {
      const latest = outstanding.at(-1);
      if (outstanding.length >= OUTSTANDING_LIMIT && latest !== undefined) return latest;
      issued += 1;
      const running = fetchAndApply(issued).finally(() => {
        outstanding.splice(outstanding.indexOf(running), 1);
      });
      outstanding.push(running);
      return running;
    },
  };
}
