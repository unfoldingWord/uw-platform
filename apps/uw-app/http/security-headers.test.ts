import { jsx } from 'hono/jsx';
import { describe, expect, it } from 'vitest';
import { appCssPath } from '@uw/ui/generated/app-css';
import { Shell } from '@uw/ui/components/shell.tsx';
import { createApp } from '../app.tsx';
import { islandsPath } from '../generated/islands.ts';
import { recordingDeps } from '../testing/deps.ts';
import { contentSecurityPolicy } from './security-headers.ts';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

function inlineScriptsOf(html: string): string[] {
  return [...html.matchAll(/<script(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/g)]
    .filter((match) => {
      const attributes = match.groups?.['attributes'] ?? '';
      return !attributes.includes('src=') && !attributes.includes('application/json');
    })
    .map((match) => match.groups?.['body'] ?? '');
}

function directive(policy: string, name: string): string {
  return policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';
}

describe('the Content-Security-Policy', () => {
  it('every response carries the Content-Security-Policy, nosniff and the referrer policy', async () => {
    const app = createApp(recordingDeps().deps);
    for (const path of ['/', '/health/probe', '/api/harness/x/events', appCssPath, '/sw.js']) {
      const response = await app.request(`https://uw.example${path}`, {}, {});
      expect(response.headers.get('content-security-policy'), path).toBe(
        await contentSecurityPolicy('uw.example'),
      );
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('referrer-policy'), path).toBe('same-origin');
    }
  });

  it('the policy allows exactly the inline scripts the shell renders', async () => {
    const html = await jsx(Shell, {
      title: 'unfoldingWord',
      nav: [],
      current: '/',
      crumbs: [],
      stylesheet: appCssPath,
      script: islandsPath,
    }).toString();
    const inline = inlineScriptsOf(html);
    expect(inline).toHaveLength(2);
    const scripts = directive(await contentSecurityPolicy('uw.example'), 'script-src');
    for (const body of inline) expect(scripts).toContain(await sha256(body));
    expect(scripts).not.toContain(await sha256('alert(1)'));
    expect(scripts.split(' ')).toHaveLength(2 + inline.length);
  });

  it('the policy allows no inline style, no eval and no other origin', async () => {
    const policy = await contentSecurityPolicy('uw.example');
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/(?:^|\s)\*/);
    expect(policy).not.toContain('http:');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' wss://uw.example");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('names no host in connect-src when the host carries a character outside the host set', async () => {
    const policy = await contentSecurityPolicy("uw.example; script-src 'unsafe-inline'");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });
});
