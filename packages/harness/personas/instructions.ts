import { parse } from 'yaml';

export type AgentSkillHeader = {
  readonly name: string;
  readonly description: string;
  readonly body: string;
};
export type HeaderProblem = { readonly problem: string };

const FENCE = '---';
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DESCRIPTION_LIMIT = 1024;
const OTHER_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

type Split = { readonly header: string; readonly body: string };

function split(text: string): Split | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FENCE) return null;
  const end = lines.indexOf(FENCE, 1);
  if (end < 0) return null;
  return { header: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}

function mappingOf(header: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = parse(header, { uniqueKeys: true });
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return null;
  }
}

function problemOf(mapping: Readonly<Record<string, unknown>>): string | null {
  const name = mapping['name'];
  if (typeof name !== 'string' || !NAME.test(name)) return 'the header has no name';
  const description = mapping['description'];
  const described =
    typeof description === 'string' &&
    description.length > 0 &&
    description.length <= DESCRIPTION_LIMIT;
  if (!described) return "the header's description is missing or too long";
  const other = Object.keys(mapping).find((key) => !OTHER_KEYS.has(key));
  return other === undefined ? null : `the header names ${other}`;
}

export function parseAgentSkillHeader(text: string): AgentSkillHeader | HeaderProblem {
  const parts = split(text);
  if (parts === null) return { problem: 'no agentskills header' };
  const mapping = mappingOf(parts.header);
  if (mapping === null) return { problem: 'the header is not a mapping' };
  const problem = problemOf(mapping);
  if (problem !== null) return { problem };
  const body = parts.body.trim();
  if (body.length === 0) return { problem: 'the body is empty' };
  return { name: String(mapping['name']), description: String(mapping['description']), body };
}
