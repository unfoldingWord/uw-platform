import { describe, expect, it } from 'vitest';
import { verbIo } from '@uw/contracts';
import type { Kernel } from '@uw/harness';
import { areaGrant, testAgent, testContext } from '../../testing/mcp.ts';
import type { McpHost, VerbContext } from '../context.ts';
import { recordRunStep } from './record-run-step.ts';
import { callVerb } from '../dispatch.ts';
import { verbHandlers } from './index.ts';

const lease = { leaseExpiresAt: '2026-10-03T09:15:00.000Z', leaseWarning: false };

function stepContext(host: McpHost, reached: unknown[]): VerbContext {
  const context = testContext(testAgent([areaGrant('editor', '80-89')]));
  const kernel: Kernel = {
    ...context.kernel,
    items: {
      ...context.kernel.items,
      recordRunStep: async (_caller, input) => {
        reached.push(input);
        return { status: 'accepted', value: lease };
      },
    },
  };
  return { ...context, host, kernel };
}

function stepInput(costBasis: 'metered' | 'subscription', costs: Record<string, unknown> = {}) {
  return verbIo.record_run_step.input.parse({
    itemId: '00000000-0000-4000-8000-0000000000b1',
    runId: '00000000-0000-4000-8000-0000000000f1',
    step: 'work',
    tokensIn: 120,
    tokensOut: 30,
    costBasis,
    ...costs,
  });
}

describe('an external runner cannot set its own cost or provider', () => {
  it('refuses a subscription step that carries a cost, and records nothing', async () => {
    const reached: unknown[] = [];
    const context = stepContext('external', reached);
    for (const costs of [{ costMinor: 4 }, { computeMinor: 1 }, { costMinor: 0 }]) {
      expect(await recordRunStep.run(context, stepInput('subscription', costs), null)).toEqual({
        status: 'error',
        reason: 'malformed_command',
        detail: { why: 'subscription_has_no_cost' },
      });
    }
    expect(reached).toEqual([]);
  });

  it('refuses a provider named by the runner, and records nothing', async () => {
    const reached: unknown[] = [];
    const input = stepInput('subscription', { resolvedProvider: 'anthropic' });
    expect(await recordRunStep.run(stepContext('external', reached), input, null)).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { why: 'provider_is_the_hosts' },
    });
    expect(reached).toEqual([]);
  });

  it('records a step that reports tokens, a model and tools, and answers no prompts yet', async () => {
    const reached: unknown[] = [];
    const input = stepInput('subscription', { model: 'claude-opus', toolsCalled: ['read_page'] });
    expect(await recordRunStep.run(stepContext('external', reached), input, null)).toEqual({
      status: 'accepted',
      output: { ...lease, prompts: [] },
    });
    expect(reached).toEqual([input]);
  });

  it('takes the costs and provider the in-process host reports', async () => {
    const reached: unknown[] = [];
    const input = stepInput('metered', { costMinor: 4, resolvedProvider: 'z-ai' });
    const reply = await recordRunStep.run(stepContext('workflow', reached), input, null);
    expect(reply.status).toBe('accepted');
    expect(reached).toEqual([input]);
  });
});

describe('record_run_step names every key it takes', () => {
  it('refuses a misspelled cost key malformed_command before the handler runs', async () => {
    const context = testContext(testAgent([areaGrant('editor', '80-89')]));
    const args = {
      itemId: '00000000-0000-4000-8000-0000000000b1',
      runId: '00000000-0000-4000-8000-0000000000f1',
      step: 'work',
      tokensIn: 1,
      tokensOut: 1,
      costBasis: 'subscription',
      cost_minor: 4,
    };
    const result = await callVerb(context, 'record_run_step', args, verbHandlers);
    expect(result.isError).toBe(true);
    expect(JSON.parse(JSON.stringify(result.content))).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          reason: 'malformed_command',
          detail: { fields: ['(root)'] },
        }),
      },
    ]);
  });
});
