import { describe, expect, it } from 'vitest';
import type { Bindings, SandboxNamespace } from '../../env.ts';
import { ClaudeCodeSandbox, CodexSandbox, routeOutbound, sandboxSettings } from './classes.ts';

function namespaceWith(seen: string[]): SandboxNamespace {
  const stub = {
    bindEgress: () => Promise.resolve(),
    egressFetch: async (request: Request) => {
      seen.push(request.url);
      return new Response('routed');
    },
    writeFile: () => Promise.resolve(),
    exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    destroy: () => Promise.resolve(),
  };
  return {
    idFromName: (name) => name,
    idFromString: (id) => id,
    get: (id) => {
      seen.push(`instance ${String(id)}`);
      return stub;
    },
  };
}

const context = (className: string) => ({ containerId: 'container-1', className });

describe('the sandbox Durable Object classes', () => {
  it('start with the internet off and route every outbound request through the egress proxy', () => {
    expect(sandboxSettings.enableInternet).toBe(false);
    expect(ClaudeCodeSandbox.outbound).toBe(routeOutbound);
    expect(CodexSandbox.outbound).toBe(routeOutbound);
  });

  it("send a request to the sandbox's own bound egress, and refuse it with no namespace", async () => {
    const seen: string[] = [];
    const env: Bindings = { CLAUDE_CODE_SANDBOX: namespaceWith(seen) };
    const routed = await routeOutbound(
      new Request('http://mcp.internal/mcp'),
      env,
      context('ClaudeCodeSandbox'),
    );
    expect(await routed.text()).toBe('routed');
    expect(seen).toEqual(['instance container-1', 'http://mcp.internal/mcp']);
    for (const className of ['CodexSandbox', 'SomeOtherContainer']) {
      const refused = await routeOutbound(new Request('https://api.github.com/'), env, {
        ...context(className),
      });
      expect(refused.status).toBe(403);
      expect(await refused.text()).toBe('egress refused');
    }
  });
});
