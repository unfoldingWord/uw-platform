import { afterEach, describe, expect, it } from 'vitest';
import { leaf, removePlanted, violations } from './planted-cruise.ts';

afterEach(removePlanted);

const personOnly = {
  'apps/uw-platform/measures/trial.ts': leaf,
  'apps/uw-platform/measures/activation.ts': "import '../pages/gated-flip.ts';",
  'apps/uw-platform/pages/gated-flip.ts': leaf,
};

describe('the trial and the activation of a measure are reached only from its command routes', () => {
  it.each([
    [
      'an MCP verb',
      'apps/uw-platform/mcp/verbs/run-measure.ts',
      "import '../../measures/trial.ts';",
    ],
    [
      'an MCP verb',
      'apps/uw-platform/mcp/verbs/save-measure.ts',
      "import '../../measures/activation.ts';",
    ],
    ['the cron', 'apps/uw-platform/cron/measures.ts', "import '../measures/activation.ts';"],
    ['the run Workflow', 'apps/uw-platform/measures/workflow.ts', "import './trial.ts';"],
    ['the shared run request', 'apps/uw-platform/measures/run-now.ts', "import './trial.ts';"],
  ])('refuses %s importing it', async (_name, path, source) => {
    const found = await violations({ ...personOnly, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(
      'measure-activation-only-from-measure-routes',
    );
  });

  it.each([
    ['the agent page writer', 'apps/uw-platform/pages/agent-write.ts', "import './gated-flip.ts';"],
    ['the gated save', 'apps/uw-platform/pages/gated-save.ts', "import './gated-flip.ts';"],
    [
      'an MCP verb',
      'apps/uw-platform/mcp/verbs/write-page.ts',
      "import '../../pages/gated-flip.ts';",
    ],
  ])('refuses %s importing the gated flip', async (_name, path, source) => {
    const found = await violations({ ...personOnly, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(
      'gated-flip-only-from-measure-activation',
    );
  });

  it('allows the measure command routes, the activation and tests', async () => {
    const found = await violations({
      ...personOnly,
      'apps/uw-platform/measures/routes.ts': "import './trial.ts';\nimport './activation.ts';",
      'apps/uw-platform/measures/commands.pg.test.ts': "import './activation.ts';",
      'apps/uw-platform/pages/gated-flip.pg.test.ts': "import './gated-flip.ts';",
    });
    expect(found).toEqual([]);
  });
});
