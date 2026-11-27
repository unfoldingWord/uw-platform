import { exportPKCS8, generateKeyPair, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { fakeGoogle, type FakeGoogle } from '../google/testing/fake-google.ts';
import { fakeResearch, type FakeResearch } from '../research/testing/fake-research.ts';
import {
  fakeZulip,
  FAKE_ADMIN,
  FAKE_ZULIP_SITE,
  type FakeZulip,
} from '../zulip/testing/fake-zulip.ts';
import { exitCodeOf, reportLines } from './report.ts';
import { runAssistantProbes, type ProbeEnv } from './run.ts';
import type { ProbeResult } from './report.ts';

const person = 'ana@unfoldingword.org';
const colleague = 'boaz@unfoldingword.org';
const mailbox = 'barnabas@unfoldingword.org';
const admin = 'platform-admin@unfoldingword.org';
const now = new Date('2026-11-27T09:00:00.000Z');

let privateKey = '';
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

function mailFrom(sender: string, authentication: string): string {
  return [
    `Delivered-To: ${mailbox}`,
    `Authentication-Results: mx.google.com;${authentication}`,
    `From: Ana <${sender}>`,
    `To: ${mailbox}`,
    'Subject: Probe',
    'Message-ID: <probe01@mail.gmail.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    'What is on my schedule today?',
    '',
  ].join('\r\n');
}

const passing = ` dkim=pass header.i=@unfoldingword.org; spf=pass smtp.mailfrom=${person}; dmarc=pass (p=QUARANTINE) header.from=unfoldingword.org`;

function openRouter(provider: string): typeof fetch {
  return async () =>
    Response.json({
      id: 'gen-probe',
      provider,
      model: 'z-ai/glm-5.3-flash',
      object: 'chat.completion',
      created: 1_795_000_000,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
      usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, cost: 0.00001 },
    });
}

type World = {
  zulip: FakeZulip;
  google: FakeGoogle;
  research: FakeResearch;
  fetcher: typeof fetch;
  env: ProbeEnv;
};

function researchWorld(): FakeResearch {
  const research = fakeResearch();
  research.addResults('unfoldingWord Bible translation', [
    { title: 'unfoldingWord', url: 'https://www.unfoldingword.org/', snippet: 'Bible translation' },
  ]);
  research.addPage('https://example.com/', {
    title: 'Example Domain',
    text: 'This domain is for use in examples.',
  });
  research.resolve('localtest.me', ['127.0.0.1']);
  research.addOffers(
    {
      origin: 'LHR',
      destination: 'JFK',
      departDate: '2027-01-26',
      returnDate: null,
      passengers: 1,
      cabin: 'economy',
    },
    [
      {
        airline: 'Duffel Airways',
        totalMinor: 45_120,
        currency: 'GBP',
        expiresAt: new Date('2026-11-27T09:30:00.000Z'),
        legs: [
          {
            from: 'LHR',
            to: 'JFK',
            departAt: '2027-01-26T09:00:00',
            arriveAt: '2027-01-26T12:00:00',
            durationMinutes: 480,
            flights: ['ZZ1'],
          },
        ],
      },
    ],
  );
  return research;
}

function world(provider = 'Z.AI', authentication = passing): World {
  const zulip = fakeZulip();
  zulip.addUser(person, 'Ana', 5001);
  const google = fakeGoogle();
  google.trust(publicKey);
  for (const email of [person, colleague, mailbox, admin]) google.addUser(email);
  google.directory.add(admin);
  google.gmail.deliver(mailbox, mailFrom(person, authentication));
  const model = openRouter(provider);
  const research = researchWorld();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new Request(input, init).url;
    if (research.owns(url) || url.startsWith('http://localtest.me/'))
      return research.fetch(input, init);
    if (url.startsWith(FAKE_ZULIP_SITE)) return zulip.fetch(input, init);
    if (url.startsWith('https://gateway.ai.cloudflare.com/')) return model(input, init);
    return google.fetch(input, init);
  };
  const env: ProbeEnv = {
    ZULIP_SITE: FAKE_ZULIP_SITE,
    ZULIP_ADMIN_EMAIL: FAKE_ADMIN.email,
    ZULIP_ADMIN_API_KEY: FAKE_ADMIN.apiKey,
    ASSISTANT_WEBHOOK_BASE: 'https://uw-ingest-staging.example.org',
    GOOGLE_WORKSPACE_KEY: JSON.stringify({
      client_email: 'assistants@uw-platform.iam.gserviceaccount.com',
      private_key: privateKey,
    }),
    GOOGLE_WORKSPACE_DOMAIN: 'unfoldingword.org',
    GOOGLE_WORKSPACE_ADMIN_SUBJECT: admin,
    GOOGLE_ASSISTANT_OU: '/Assistants',
    AI_GATEWAY_ACCOUNT_ID: 'account',
    AI_GATEWAY_ID: 'uw-platform-staging',
    OPENROUTER_API_KEY: 'openrouter-key',
    ALWAYS_ON_MODEL: 'z-ai/glm-5.3-flash',
    ALWAYS_ON_PROVIDER: 'z-ai',
    PROBE_PERSON_EMAIL: person,
    PROBE_COLLEAGUE_EMAIL: colleague,
    PROBE_ASSISTANT_MAILBOX: mailbox,
    PROBE_WEB_PAGE: 'https://example.com/',
    BRAVE_SEARCH_API_KEY: research.braveKey,
    DUFFEL_ACCESS_TOKEN: research.duffelToken,
  };
  return { zulip, google, research, fetcher, env };
}

async function probed(at: World, write: boolean): Promise<readonly ProbeResult[]> {
  return runAssistantProbes({
    env: at.env,
    fetcher: at.fetcher,
    now: () => now,
    write,
    suffix: 'a1b2c3',
  });
}

function researchLeftNothing(at: World): boolean {
  const urls = at.research.requests().map((request) => new URL(request.url));
  const booked = urls.some((url) => url.pathname.startsWith('/air/orders'));
  return !booked && !urls.some((url) => url.host === 'localtest.me');
}

function statusOf(results: readonly ProbeResult[], id: string): string | undefined {
  return results.find((result) => result.id === id)?.status;
}

const automated = [
  's3.1',
  's3.2',
  's3.3',
  's3.4',
  's3.5',
  's4.1',
  's5.1',
  's5.2',
  's5.3',
  's5.4',
  's5.5',
  's5.6',
  's6.1',
  's6.2',
  's6.3',
  's6.4',
  's6.5',
  's8.1',
  's8.3',
  's8.4',
  's8.5',
  's8.6',
  's8.7',
  's12.1',
  's12.2',
  's12.3',
  's12.4',
];

describe('go-live: the staging probes exercise each external assumption and report pass or fail', () => {
  it('passes every automated probe against the recorded shapes and leaves nothing behind', async () => {
    const at = world();
    const results = await probed(at, true);
    const failing = results.filter((result) => automated.includes(result.id));
    expect(failing.filter((result) => result.status !== 'pass')).toEqual([]);
    expect(failing.map((result) => result.id).sort()).toEqual([...automated].sort());
    expect(exitCodeOf(results)).toBe(0);
    expect(at.zulip.messages().filter((message) => message.type === 'direct')).toHaveLength(1);
    expect(at.zulip.bots().every((bot) => !bot.is_active)).toBe(true);
    expect(at.google.events(person)).toEqual([]);
    expect(at.google.directory.user('uwprobea1b2c3@unfoldingword.org')).toBeNull();
    expect(researchLeftNothing(at)).toBe(true);
  });

  it('lists what only a person on staging can check as manual, never as passed', async () => {
    const results = await probed(world(), true);
    const manual = results.filter((result) => result.status === 'manual').map((r) => r.id);
    expect(manual).toEqual(expect.arrayContaining(['s3.7', 's4.2', 's4.3', 's9.4']));
    expect(results.find((result) => result.id === 's4.2')?.detail).toMatch(/Workflow/);
  });

  it('only reads without --write: it creates no bot, no user, no hold and sends nothing', async () => {
    const at = world();
    const results = await probed(at, false);
    expect(statusOf(results, 's3.3')).toBe('pass');
    expect(statusOf(results, 's5.3')).toBe('pass');
    expect(statusOf(results, 's8.1')).toBe('pass');
    for (const id of ['s3.1', 's3.5', 's5.5', 's6.2', 's8.7']) {
      expect(statusOf(results, id)).toBe('skip');
    }
    expect(at.zulip.bots()).toEqual([]);
    expect(at.zulip.messages()).toEqual([]);
    expect(at.google.gmail.sent(mailbox)).toEqual([]);
    expect(at.google.directory.user('uwprobea1b2c3@unfoldingword.org')).toBeNull();
  });

  it('skips a group whose settings are missing and names the setting', async () => {
    const results = await runAssistantProbes({
      env: {},
      fetcher: () => Promise.reject(new Error('nothing may be called')),
      now: () => now,
      write: true,
      suffix: 'a1b2c3',
    });
    expect(results.filter((result) => result.status === 'pass')).toEqual([]);
    expect(results.find((result) => result.id === 's3.1')?.detail).toMatch(/ZULIP_ADMIN_API_KEY/);
    expect(results.find((result) => result.id === 's5.1')?.detail).toMatch(/GOOGLE_WORKSPACE_KEY/);
    expect(exitCodeOf(results)).toBe(0);
  });
});

describe('go-live: a probe whose answer departs from the recorded shape fails', () => {
  it('fails the DMARC probe when the person’s own mail is not shown as passing', async () => {
    const at = world('Z.AI', ` spf=softfail smtp.mailfrom=${person}`);
    const results = await probed(at, false);
    const dmarc = results.find((result) => result.id === 's8.1');
    expect(dmarc?.status).toBe('fail');
    expect(dmarc?.detail).toMatch(/unverified_sender/);
    expect(exitCodeOf(results)).toBe(1);
  });

  it('fails the ZDR probe when another provider answers', async () => {
    const results = await probed(world('Other Cloud'), false);
    expect(statusOf(results, 's4.1')).toBe('fail');
  });

  it('fails a Zulip probe when the realm refuses it, and says so in the report', async () => {
    const at = world();
    at.zulip.failNext({ status: 400 });
    const results = await probed(at, false);
    expect(statusOf(results, 's3.3')).toBe('fail');
    expect(reportLines(results).some((line) => /^FAIL\s+s3\.3/.test(line))).toBe(true);
  });
});
