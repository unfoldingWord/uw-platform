import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pushSubscribeSchema } from '@uw/contracts';
import {
  PUSH_TEXT,
  wirePushControl,
  type PushDevice,
  type PushSubscriptionLike,
} from './push-subscribe.ts';

const endpoint = 'https://fcm.googleapis.com/fcm/send/device-1';
const p256dh = 'B'.repeat(87);
const auth = 'A'.repeat(22);
const publicKey = 'BPublicKey_-0123456789';

type Sent = { readonly url: string; readonly body: unknown; readonly busy: string | null };
type Answers = Readonly<Record<string, () => Response>>;

function page(): JSDOM {
  return new JSDOM(
    `<!DOCTYPE html><body><section data-push><button type="button" data-push-toggle>${PUSH_TEXT.turnOn}</button><p data-push-outcome role="status"></p></section></body>`,
    { url: 'https://uw.example/' },
  );
}

function subscriptionLike(onUnsubscribe: () => void = () => undefined): PushSubscriptionLike {
  return {
    endpoint,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
    unsubscribe: async () => {
      onUnsubscribe();
      return true;
    },
  };
}

function device(permission: NotificationPermission, subscribed: boolean) {
  const asked: unknown[] = [];
  let current: PushSubscriptionLike | null = null;
  const clear = () => {
    current = null;
  };
  if (subscribed) current = subscriptionLike(clear);
  const push: PushDevice = {
    permission: async () => permission,
    manager: async () => ({
      getSubscription: async () => current,
      subscribe: async (options) => {
        asked.push(options);
        current = subscriptionLike(clear);
        return current;
      },
    }),
  };
  return { push, asked };
}

function wired(dom: JSDOM, push: PushDevice, answers: Answers) {
  const sent: Sent[] = [];
  const document = dom.window.document;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({
      url,
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      busy: document.querySelector('[data-push]')?.getAttribute('aria-busy') ?? null,
    });
    const answer = answers[url];
    return answer === undefined ? Response.json({ status: 'accepted' }) : answer();
  }) as typeof fetch;
  wirePushControl(document, { fetch: fetcher, push });
  return { sent, document };
}

async function settled(): Promise<void> {
  for (let n = 0; n < 10; n += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function click(document: Document): Element | null {
  const button = document.querySelector('[data-push-toggle]');
  button?.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
  return button;
}

function outcome(document: Document): string | null | undefined {
  return document.querySelector('[data-push-outcome]')?.textContent;
}

const keyAnswer = { '/api/push/key': () => Response.json({ status: 'accepted', publicKey }) };

async function turnsOnAndOff(): Promise<void> {
  const { push, asked } = device('granted', false);
  const { sent, document } = wired(page(), push, keyAnswer);
  await settled();
  const button = click(document);
  expect(document.querySelector('[data-push]')?.getAttribute('aria-busy')).toBe('true');
  expect(button?.getAttribute('aria-disabled')).toBe('true');
  await settled();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ userVisibleOnly: true });
  const posted = sent.find((call) => call.url === '/api/push/subscriptions');
  expect(posted?.busy).toBe('true');
  expect(pushSubscribeSchema.safeParse(posted?.body).success).toBe(true);
  expect(posted?.body).toEqual({ endpoint, keys: { p256dh, auth }, expirationTime: null });
  expect(outcome(document)).toBe(PUSH_TEXT.on);
  expect(button?.textContent).toBe(PUSH_TEXT.turnOff);
  expect(button?.hasAttribute('aria-disabled')).toBe(false);
  click(document);
  await settled();
  const removed = sent.find((call) => call.url === '/api/push/subscriptions/remove');
  expect(removed?.body).toEqual({ endpoint });
  expect(outcome(document)).toBe(PUSH_TEXT.off);
  expect(button?.textContent).toBe(PUSH_TEXT.turnOn);
}

describe('the notifications control', () => {
  it('NT-1 a person turns notifications on and off from the installed app', turnsOnAndOff);

  it('starts as turn off when this device already has a subscription', async () => {
    const { push } = device('granted', true);
    const { document } = wired(page(), push, keyAnswer);
    await settled();
    expect(document.querySelector('[data-push-toggle]')?.textContent).toBe(PUSH_TEXT.turnOff);
  });

  it('says when notifications are not set up, blocked, or refused for another reason', async () => {
    const notWired = wired(page(), device('granted', false).push, {
      '/api/push/key': () =>
        Response.json({ status: 'error', reason: 'not_wired' }, { status: 404 }),
    });
    click(notWired.document);
    await settled();
    expect(outcome(notWired.document)).toBe(PUSH_TEXT.notSetUp);
    const blocked = wired(page(), device('denied', false).push, keyAnswer);
    click(blocked.document);
    await settled();
    expect(outcome(blocked.document)).toBe(PUSH_TEXT.blocked);
    const refused = wired(page(), device('granted', false).push, {
      ...keyAnswer,
      '/api/push/subscriptions': () =>
        Response.json({ status: 'error', reason: 'malformed_command' }, { status: 400 }),
    });
    click(refused.document);
    await settled();
    expect(outcome(refused.document)).toBe('Malformed command');
  });
});
