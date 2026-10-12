import type { MiddlewareHandler } from 'hono';
import { inlineScripts } from '@uw/ui/components/inline-scripts.ts';
import type { AppEnv } from '../deps.ts';

const SWITCHING_PROTOCOLS = 101;
const plainHost = /^[A-Za-z0-9.:-]+$/;

let hashes: Promise<readonly string[]> | null = null;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

export async function contentSecurityPolicy(host: string): Promise<string> {
  hashes ??= Promise.all(inlineScripts.map(sha256));
  const scripts = (await hashes).join(' ');
  const connect = plainHost.test(host) ? `'self' wss://${host}` : "'self'";
  return [
    "default-src 'none'",
    `script-src 'self' ${scripts}`,
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${connect}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (c.res.status === SWITCHING_PROTOCOLS) return;
    c.header('content-security-policy', await contentSecurityPolicy(new URL(c.req.url).host));
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'same-origin');
  };
}
