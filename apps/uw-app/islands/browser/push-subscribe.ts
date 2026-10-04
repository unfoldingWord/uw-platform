import { reasonText } from '@uw/ui/components/text.ts';

export const PUSH_TEXT = {
  turnOn: 'Turn on notifications on this device',
  turnOff: 'Turn off notifications on this device',
  on: 'Notifications are on for this device.',
  off: 'Notifications are off for this device.',
  notSetUp: 'Notifications are not set up yet.',
  blocked: 'Your browser blocked notifications. Allow them in its settings.',
} as const;

type SubscriptionJson = {
  readonly endpoint?: string;
  readonly expirationTime?: number | null;
  readonly keys?: Readonly<Record<string, string>>;
};

export type PushSubscriptionLike = {
  readonly endpoint: string;
  toJSON(): SubscriptionJson;
  unsubscribe(): Promise<boolean>;
};

type ManagerLike = {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    readonly userVisibleOnly: boolean;
    readonly applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<PushSubscriptionLike>;
};

export type PushDevice = {
  manager(): Promise<ManagerLike | null>;
  permission(): Promise<NotificationPermission>;
};

type PushDeps = { readonly fetch: typeof fetch; readonly push: PushDevice };
type Answer = { readonly accepted: boolean; readonly reason: string; readonly publicKey: string };
type Control = { readonly root: Element; readonly button: Element; readonly outcome: Element };

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function answerOf(response: Response): Promise<Answer> {
  const body: unknown = await response.json().catch(() => null);
  const read = new Map(typeof body === 'object' && body !== null ? Object.entries(body) : []);
  const reason = read.get('reason');
  const publicKey = read.get('publicKey');
  return {
    accepted: read.get('status') === 'accepted',
    reason: typeof reason === 'string' ? reason : 'internal_error',
    publicKey: typeof publicKey === 'string' ? publicKey : '',
  };
}

function postJson(deps: PushDeps, url: string, body: unknown): Promise<Answer> {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  return deps.fetch(url, init).then(answerOf);
}

function refusalText(reason: string): string {
  return reason === 'not_wired' ? PUSH_TEXT.notSetUp : reasonText(reason);
}

function reshaped(subscription: PushSubscriptionLike) {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
    expirationTime: json.expirationTime ?? null,
  };
}

async function turnOn(deps: PushDeps, manager: ManagerLike): Promise<string> {
  const key = await deps.fetch('/api/push/key').then(answerOf);
  if (!key.accepted) return refusalText(key.reason);
  if ((await deps.push.permission()) !== 'granted') return PUSH_TEXT.blocked;
  const applicationServerKey = keyBytes(key.publicKey);
  const subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey });
  const saved = await postJson(deps, '/api/push/subscriptions', reshaped(subscription));
  if (saved.accepted) return PUSH_TEXT.on;
  await subscription.unsubscribe().catch(() => false);
  return refusalText(saved.reason);
}

async function turnOff(deps: PushDeps, subscription: PushSubscriptionLike): Promise<string> {
  const removed = await postJson(deps, '/api/push/subscriptions/remove', {
    endpoint: subscription.endpoint,
  });
  if (!removed.accepted) return refusalText(removed.reason);
  await subscription.unsubscribe().catch(() => false);
  return PUSH_TEXT.off;
}

async function toggled(deps: PushDeps): Promise<string> {
  const manager = await deps.push.manager();
  if (manager === null) return PUSH_TEXT.notSetUp;
  const current = await manager.getSubscription();
  return current === null ? turnOn(deps, manager) : turnOff(deps, current);
}

async function labelled(control: Control, deps: PushDeps): Promise<void> {
  const manager = await deps.push.manager().catch(() => null);
  const current = manager === null ? null : await manager.getSubscription().catch(() => null);
  control.button.textContent = current === null ? PUSH_TEXT.turnOn : PUSH_TEXT.turnOff;
}

async function onClick(control: Control, deps: PushDeps): Promise<void> {
  if (control.root.getAttribute('aria-busy') === 'true') return;
  control.root.setAttribute('aria-busy', 'true');
  control.button.setAttribute('aria-disabled', 'true');
  try {
    control.outcome.textContent = await toggled(deps);
  } catch {
    control.outcome.textContent = reasonText('internal_error');
  } finally {
    await labelled(control, deps);
    control.root.removeAttribute('aria-busy');
    control.button.removeAttribute('aria-disabled');
  }
}

export function wirePushControl(document: Document, deps: PushDeps): void {
  const root = document.querySelector('[data-push]');
  const button = root?.querySelector('[data-push-toggle]');
  const outcome = root?.querySelector('[data-push-outcome]');
  if (!root || !button || !outcome) return;
  const control = { root, button, outcome };
  button.addEventListener('click', () => void onClick(control, deps));
  void labelled(control, deps);
}

export function browserPush(navigator: Navigator): PushDevice {
  return {
    manager: async () => {
      if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return null;
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager;
    },
    permission: () => Notification.requestPermission(),
  };
}
