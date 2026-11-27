import { describe, expect, it } from 'vitest';
import { repoSources, type SourceFiles } from './agent-boundary.ts';
import {
  decideCallSites,
  proposalDecisionSites,
  proposalDecisionViolations,
  turnKernelClosure,
} from './assistant-decisions.ts';

const real = repoSources();
const decider = 'packages/harness/assistants/proposal-decide.ts';
const command = 'apps/uw-platform/commands/person/assistant-proposals.ts';

function withPlanted(planted: Readonly<Record<string, string>>): SourceFiles {
  const texts = new Map(Object.entries(planted));
  const added = [...texts.keys()].filter((file) => !real.files.includes(file));
  return { files: [...real.files, ...added], read: (file) => texts.get(file) ?? real.read(file) };
}

describe('PA-12 only a person decides an assistant proposal', () => {
  it('finds exactly one function that records a decision, and one route that asks for it', () => {
    expect(proposalDecisionSites(real)).toEqual([{ file: decider, fn: 'decidedIn' }]);
    expect(decideCallSites(real)).toEqual([command]);
    expect(proposalDecisionViolations(real)).toEqual([]);
  });

  it('keeps the decider out of everything an assistant turn reaches', () => {
    const closure = turnKernelClosure(real);
    expect(closure).toContain('packages/harness/assistants/proposal-drafts.ts');
    expect(closure).toContain('packages/harness/assistants/finish.ts');
    expect(closure).not.toContain(decider);
  });

  it('flags a second writer of the decision anywhere outside the decider', () => {
    const planted = {
      'packages/harness/assistants/quick-yes.ts':
        'export async function quickYes(tx: Tx, d: D) {\n  await tx.assistantProposals.write.decide(d);\n}\n',
      'apps/uw-platform/assistants/sneak.ts':
        "export async function sneak(db: Db) {\n  await db.execute(sql`UPDATE assistant_proposals SET decided_by = 'human:x'`);\n}\n",
    };
    expect(proposalDecisionViolations(withPlanted(planted))).toEqual([
      'apps/uw-platform/assistants/sneak.ts decides a proposal in sneak',
      'packages/harness/assistants/quick-yes.ts decides a proposal in quickYes',
    ]);
  });

  it('flags an MCP verb, a Workflow step or a cron job that asks the kernel to decide', () => {
    const call = 'await context.kernel.assistants.decideProposal(caller, input);\n';
    const planted = {
      'apps/uw-platform/mcp/verbs/accept-proposal.ts': call,
      'apps/uw-platform/assistants/turn/steps-yes.ts': call,
      'apps/uw-platform/cron/auto-accept.ts': call,
    };
    expect(proposalDecisionViolations(withPlanted(planted))).toEqual([
      'apps/uw-platform/assistants/turn/steps-yes.ts asks the kernel to decide a proposal',
      'apps/uw-platform/cron/auto-accept.ts asks the kernel to decide a proposal',
      'apps/uw-platform/mcp/verbs/accept-proposal.ts asks the kernel to decide a proposal',
    ]);
  });

  it('flags the decider reached from a turn', () => {
    const planted = {
      'packages/harness/assistants/proposal-drafts.ts': `import { decideProposal } from './proposal-decide.ts';\n${real.read('packages/harness/assistants/proposal-drafts.ts')}`,
    };
    expect(proposalDecisionViolations(withPlanted(planted))).toEqual([
      `an assistant turn reaches ${decider}`,
    ]);
  });
});
