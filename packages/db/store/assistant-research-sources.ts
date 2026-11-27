import { RESEARCH_SOURCES_MOST } from '@uw/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantRequests } from '../schema.ts';

function sourcesOf(value: unknown): readonly string[] {
  if (!Array.isArray(value))
    throw new TypeError('assistant_requests.research_sources is not an array');
  return value.filter((each): each is string => typeof each === 'string');
}

export async function researchSources(
  executor: AnyExecutor,
  requestId: string,
): Promise<readonly string[]> {
  const [row] = await executor
    .select({ sources: assistantRequests.researchSources })
    .from(assistantRequests)
    .where(eq(assistantRequests.id, requestId));
  return row === undefined ? [] : sourcesOf(row.sources);
}

export async function addResearchSources(
  executor: AnyExecutor,
  requestId: string,
  urls: readonly string[],
): Promise<void> {
  const known = await researchSources(executor, requestId);
  const merged = [...new Set([...known, ...urls])].slice(0, RESEARCH_SOURCES_MOST);
  if (merged.length === known.length) return;
  await executor
    .update(assistantRequests)
    .set({ researchSources: merged })
    .where(and(eq(assistantRequests.id, requestId), isNull(assistantRequests.redactedAt)));
}
