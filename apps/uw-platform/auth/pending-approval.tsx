import type { Context } from 'hono';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Shell } from '@uw/ui/components/shell.tsx';
import { appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../deps.ts';
import { frameOf } from '../views/parts/frame-data.ts';
import { pageNames } from '../views/parts/names.ts';

type Words = { readonly name: string; readonly title: string; readonly text: string };

async function noAccessPage(c: Context<AppEnv>, words: Words): Promise<Response> {
  const frame = { ...(await frameOf(c, () => null)), sections: [] };
  const page = (
    <Shell
      title={words.name}
      frame={frame}
      current=""
      crumbs={[{ label: words.name }]}
      stylesheet={appCssPath}
    >
      <PageHead title={words.title} />
      <p>{words.text}</p>
    </Shell>
  );
  return c.html(`<!DOCTYPE html>${await page.toString()}`, 403);
}

export function pendingApprovalPage(c: Context<AppEnv>): Promise<Response> {
  return noAccessPage(c, {
    name: pageNames.waitingApproval,
    title: 'Your sign-in is waiting for approval',
    text: 'An unfoldingWord admin needs to approve your account before you can continue.',
  });
}

export function accessDeclinedPage(c: Context<AppEnv>): Promise<Response> {
  return noAccessPage(c, {
    name: pageNames.accessDeclined,
    title: 'Your account does not have access',
    text: 'An unfoldingWord admin declined this sign-in. Ask an admin if you think that is a mistake.',
  });
}
