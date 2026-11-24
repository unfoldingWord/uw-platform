import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { platformKernel } from '../kernel.ts';
import type { ScreenKernel } from '../views/parts/frame.tsx';
import type { Printed } from './print-document.ts';
import { element, htmlOf, text } from './print-html.ts';

export type Printable = {
  readonly title: string;
  readonly bodyHtml: string;
  readonly printed: Printed;
  readonly areas: readonly string[];
};

export function screenOf(db: Database, actor: Principal, at: Date): ScreenKernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const kernel = platformKernel(handle, { now: () => at });
  return { kernel, caller: { actor, traceId: crypto.randomUUID() }, at };
}

export function titled(title: string, html: string): string {
  return htmlOf({
    type: 'root',
    children: [element('h1', {}, [text(title)]), { type: 'raw', value: html }],
  });
}
