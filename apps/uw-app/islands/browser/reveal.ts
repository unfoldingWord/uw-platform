import { credentialRevealedSchema } from '@uw/contracts';
import { reasonText } from '@uw/ui/components/text.ts';
import { answerOf, goBusy, setOutcome, settle } from './command-form.ts';

export const REVEAL_SHOWN_MS = 60_000;
const ENDPOINT = '/api/credentials/reveal';
const SHOWN = 'Shown for one minute. The reveal is recorded and the area’s admins are told.';

type RevealTimers = {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

type RevealDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
  readonly timers: RevealTimers;
};

type Showing = { readonly form: HTMLFormElement; readonly timer: unknown };

type Answer = { readonly value: string } | { readonly reason: string };

function formOf(target: EventTarget | null): HTMLFormElement | null {
  const element = target as Element | null;
  if (element === null || element.tagName !== 'FORM') return null;
  return element.hasAttribute('data-reveal') ? (element as HTMLFormElement) : null;
}

function place(form: HTMLFormElement, value: string | null): void {
  const region = form.querySelector('[data-revealed]');
  const hide = form.querySelector('[data-reveal-hide]');
  if (region !== null) region.textContent = value ?? '';
  for (const part of [region, hide]) {
    if (value === null) part?.setAttribute('hidden', '');
    else part?.removeAttribute('hidden');
  }
}

async function ask(form: HTMLFormElement, deps: RevealDeps): Promise<Answer> {
  const body = {
    command: 'reveal_credential',
    requestId: deps.uuid(),
    credentialId: form.getAttribute('data-reveal'),
  };
  const response = await deps
    .fetch(ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  if (response === null) return { reason: 'internal_error' };
  const revealed = credentialRevealedSchema.safeParse(
    await response
      .clone()
      .json()
      .catch(() => null),
  );
  if (revealed.success) return { value: revealed.data.value };
  return { reason: (await answerOf(response)).reason || 'internal_error' };
}

export function wireReveal(root: Document, deps: RevealDeps): void {
  let showing: Showing | null = null;
  let asked = 0;

  function forget(): void {
    asked += 1;
    if (showing === null) return;
    deps.timers.clearTimeout(showing.timer);
    place(showing.form, null);
    setOutcome(showing.form, '');
    showing = null;
  }

  async function onSubmit(event: Event): Promise<void> {
    const form = formOf(event.target);
    if (form === null) return;
    event.preventDefault();
    if (form.hasAttribute('aria-busy')) return;
    const quieted = goBusy(form);
    forget();
    const mine = asked;
    const answer = await ask(form, deps);
    settle(form, quieted, 'value' in answer);
    if (mine !== asked) return;
    if (!('value' in answer)) {
      setOutcome(form, reasonText(answer.reason));
      return;
    }
    place(form, answer.value);
    setOutcome(form, SHOWN);
    showing = { form, timer: deps.timers.setTimeout(forget, REVEAL_SHOWN_MS) };
  }

  root.addEventListener('submit', (event) => void onSubmit(event));
  root.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if ((target?.closest('[data-reveal-hide]') ?? null) !== null) forget();
  });
  root.defaultView?.addEventListener('pagehide', forget);
}
