import type { Context } from 'hono';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Shell } from '@uw/ui/components/shell.tsx';
import { appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../deps.ts';
import { frameOf } from '../views/parts/frame-data.ts';
import { pageNames } from '../views/parts/names.ts';

export async function pendingApprovalPage(c: Context<AppEnv>): Promise<Response> {
  const frame = { ...(await frameOf(c, () => null)), sections: [] };
  const page = (
    <Shell
      title={pageNames.waitingApproval}
      frame={frame}
      current=""
      crumbs={[{ label: pageNames.waitingApproval }]}
      stylesheet={appCssPath}
    >
      <PageHead title="Your sign-in is waiting for approval" />
      <p>An unfoldingWord admin needs to approve your account before you can continue.</p>
    </Shell>
  );
  return c.html(`<!DOCTYPE html>${await page.toString()}`, 403);
}
