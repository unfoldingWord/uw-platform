import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUSH_TITLE,
  PUSH_TITLES,
  isShellAsset,
  pushNotification,
  pushPayload,
  pushTitle,
  safeLink,
  shellCacheName,
  staleCaches,
} from './sw-core.ts';

const assets = [
  '/assets/app-0123456789ab.css',
  '/assets/islands-0123456789ab.js',
  '/manifest.webmanifest',
  '/assets/icon.svg',
];

describe('the service worker core', () => {
  it('a push opens its same-origin link and nothing else', () => {
    expect(safeLink('/harnesses/a/gates/b')).toBe('/harnesses/a/gates/b');
    for (const unsafe of [
      'https://evil.example/x',
      '//evil.example',
      'javascript:alert(1)',
      '/\\evil',
      '/a\u0000b',
      '/a\nb',
      42,
      null,
      undefined,
      { link: '/' },
      `/${'a'.repeat(2000)}`,
    ]) {
      expect(safeLink(unsafe)).toBe('/');
    }
    expect(safeLink(`/${'a'.repeat(1999)}`)).toHaveLength(2000);
  });
});

describe('the push notification', () => {
  it("a push's title follows its reason and never its content", () => {
    const sent = {
      harness: 'h',
      reason: 'gate_waiting',
      link: '/harnesses/h/gates/i',
      title: 'Click here',
      body: 'Your account is locked',
    };
    const payload = pushPayload(sent);
    expect(payload).toEqual({ harness: 'h', reason: 'gate_waiting', link: '/harnesses/h/gates/i' });
    expect(pushTitle(payload)).toBe(PUSH_TITLES['gate_waiting']);
    expect(pushTitle(pushPayload({ ...sent, reason: 'something_new' }))).toBe(DEFAULT_PUSH_TITLE);
    expect(pushPayload('not json')).toEqual({ harness: null, reason: null, link: '/' });
    const hostile = pushPayload({ reason: 'toString', link: '//x', harness: 7 });
    expect([pushTitle(hostile), hostile.link, hostile.harness]).toEqual([
      DEFAULT_PUSH_TITLE,
      '/',
      null,
    ]);
    expect(Object.values(PUSH_TITLES)).toEqual([
      'A gate is waiting on you',
      'A run failed on an item you hold',
      'A delegation you gave has lapsed',
      'An item you hold moved on',
      'An agent merged under a delegation you gave',
    ]);
  });
});

describe('the worker cache', () => {
  it('the worker caches only the shell assets', () => {
    for (const path of assets) expect(isShellAsset(path, assets)).toBe(true);
    for (const path of ['/', '/gates', '/api/harness/x/events', '/sw.js', '/assets/other.js']) {
      expect(isShellAsset(path, assets)).toBe(false);
    }
  });
});

describe('the worker cache name', () => {
  it('follows the shell assets, so a new build leaves the old cache to be deleted', () => {
    const next = ['/assets/app-ba9876543210.css', ...assets.slice(1)];
    expect(shellCacheName(assets)).toBe(shellCacheName([...assets]));
    expect(shellCacheName(next)).not.toBe(shellCacheName(assets));
    expect(staleCaches(['other', shellCacheName(assets), shellCacheName(next)], next)).toEqual([
      'other',
      shellCacheName(assets),
    ]);
  });
});

describe('the notification a push shows', () => {
  it('the notification a push shows carries its deep link, names its harness, and is tagged by the link', () => {
    const link = '/harnesses/h/gates/i';
    const shown = pushNotification(
      pushPayload({ harness: 'software', reason: 'gate_waiting', link }),
    );
    expect(shown).toEqual({
      title: PUSH_TITLES['gate_waiting'],
      options: { body: 'In software.', tag: link, data: { link } },
    });
    expect(pushNotification(pushPayload('not json'))).toEqual({
      title: DEFAULT_PUSH_TITLE,
      options: { tag: '/', data: { link: '/' } },
    });
    const odd = pushNotification(
      pushPayload({ harness: 'Not A Key!', reason: 'run_failed', link }),
    );
    expect(odd.options).toEqual({ tag: link, data: { link } });
  });
});
