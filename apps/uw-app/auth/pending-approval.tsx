import type { Context } from 'hono';
import type { AppEnv } from '../deps.ts';

export function pendingApprovalPage(c: Context<AppEnv>): Response | Promise<Response> {
  return c.html(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>Waiting for approval</title>
      </head>
      <body>
        <h1>Your sign-in is waiting for approval</h1>
        <p>An unfoldingWord admin needs to approve your account before you can continue.</p>
      </body>
    </html>,
    403,
  );
}
