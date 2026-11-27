import { z } from 'zod';
import type { Bindings } from '../../env.ts';
import { serviceAccountOf, type ServiceAccount } from './token.ts';

export type WorkspaceConfig = {
  readonly account: ServiceAccount;
  readonly domain: string;
  readonly adminSubject: string | null;
};

const LABEL = /^[a-z0-9-]{1,63}$/;

function domainLabelsValid(domain: string): boolean {
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => LABEL.test(label) && !label.startsWith('-'));
}

const domainSchema = z.string().trim().toLowerCase().refine(domainLabelsValid);
const emailSchema = z.email();

export function workspaceConfigOf(env: Bindings): WorkspaceConfig | null {
  const account = serviceAccountOf(env.GOOGLE_WORKSPACE_KEY);
  const domain = domainSchema.safeParse(env.GOOGLE_WORKSPACE_DOMAIN);
  if (account === null || !domain.success) return null;
  const admin = emailSchema.safeParse(env.GOOGLE_WORKSPACE_ADMIN_SUBJECT?.trim().toLowerCase());
  const adminSubject = admin.success && admin.data.endsWith(`@${domain.data}`) ? admin.data : null;
  return { account, domain: domain.data, adminSubject };
}
