import type { Context } from 'hono';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Shell } from '@uw/ui/components/shell.tsx';
import { appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../deps.ts';

export async function pendingApprovalPage(c: Context<AppEnv>): Promise<Response> {
  const page = (
    <Shell
      title="Waiting for approval"
      nav={[]}
      current=""
      crumbs={[{ label: 'Waiting for approval' }]}
      stylesheet={appCssPath}
    >
      <PageHead title="Your sign-in is waiting for approval" />
      <p>An unfoldingWord admin needs to approve your account before you can continue.</p>
    </Shell>
  );
  return c.html(`<!DOCTYPE html>${await page.toString()}`, 403);
}
