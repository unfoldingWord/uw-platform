import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const mcpEndpoint = 'https://<uw-app>/mcp';
const refusals: readonly (readonly [string, RegExp])[] = [
  ['names a credential', /(api[_-]?key|token|secret|password|bearer|oauth)/i],
  ['names a URL other than the MCP endpoint', /https?:\/\/(?!<uw-app>\/mcp)/],
  ['calls fetch', /\bfetch\(/],
  ['calls curl', /\bcurl\b/],
  ['calls wget', /\bwget\b/],
  ['calls gh', /\bgh\s/],
  ['pushes with git', /git\s+push/],
];
const scriptPath = /^skills\/.+\/scripts\//;
const planted = 'tools/architecture/fixtures/skills';

function scriptProblems(path: string, source: string): string[] {
  return refusals
    .filter(([, pattern]) => pattern.test(source))
    .map(([problem]) => `${path} ${problem}`);
}

describe("a skill's scripts", () => {
  it("HE-7 a script in a skill's folder that holds a credential or calls outside the MCP surface is refused", () => {
    const scripts = repoFiles().filter((path) => scriptPath.test(path));
    expect(scripts.flatMap((path) => scriptProblems(path, readFileSync(path, 'utf8')))).toEqual([]);
    const read = (name: string) => readFileSync(`${planted}/${name}`, 'utf8');
    expect(scriptProblems('token', read('holds-a-token/scripts/sync.sh'))).toEqual([
      'token names a credential',
    ]);
    expect(scriptProblems('curl', read('calls-curl/scripts/fetch.sh'))).toEqual([
      'curl names a URL other than the MCP endpoint',
      'curl calls curl',
    ]);
    expect(scriptProblems('mcp', read('mcp-only/scripts/connect.sh'))).toEqual([]);
    expect(read('mcp-only/scripts/connect.sh')).toContain(mcpEndpoint);
  });
});
