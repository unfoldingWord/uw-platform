import type { Context } from 'hono';
import { pastedMarkdownReplySchema, pastedMarkdownSchema } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson } from '../http/commands.ts';
import { refuse } from '../http/outcomes.ts';
import { editorHtml } from '../markdown/editor-html.ts';

function writesAPage(actor: Principal, at: Date): boolean {
  return actor.grants.some((grant) =>
    can(
      actor,
      'write',
      grant.scopeKind === 'org' ? { kind: 'org' } : { kind: 'area', area: grant.scopeArea },
      at,
    ),
  );
}

export async function convertPaste(c: Context<AppEnv>): Promise<Response> {
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (!writesAPage(actor, c.get('now'))) return refuse(c, 'not_permitted');
  const body = await readJson(c);
  const pasted = pastedMarkdownSchema.safeParse(body);
  if (!pasted.success) return malformed(c, body);
  c.set('outcome', 'accepted');
  return c.json(pastedMarkdownReplySchema.parse({ html: editorHtml(pasted.data.markdown) }), 200);
}
