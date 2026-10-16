import type { Stage } from '@uw/contracts';
import { bypassesShip, software, type Caller, type Kernel, type KernelOutcome } from '@uw/harness';
import type { AgentAttempt } from './agent-boundary.ts';
import { simCaller } from './fixtures.ts';
import type { World } from './world.ts';

export type StageCommands = Kernel['stages'];

type Edit = {
  readonly label: string;
  run(stages: StageCommands, caller: Caller): Promise<KernelOutcome<unknown>>;
};

function updates(harnessId: string, stages: readonly Stage[]): readonly Edit[] {
  const gated = stages.filter((stage) => stage.exitGate !== 'none');
  const change = (stage: Stage, label: string, edit: Partial<Stage>): Edit => ({
    label: `${stage.key} ${label}`,
    run: (commands, caller) =>
      commands.updateStage(caller, { harnessId, stageKey: stage.key, change: edit }),
  });
  return [
    ...gated.map((stage) => change(stage, 'exitGate none', { exitGate: 'none' })),
    ...gated
      .filter((stage) => stage.exitGate === 'human_approval')
      .map((stage) => change(stage, 'exitGate checks', { exitGate: 'checks' })),
    ...gated.map((stage) => change(stage, 'validators cleared', { validators: [] })),
    ...stages
      .filter((stage) => stage.connector !== 'none')
      .map((stage) => change(stage, 'connector removed', { connector: 'none' })),
  ];
}

const activations = [
  { label: 'a template that bypasses ship', template: bypassesShip },
  { label: 'the software template', template: software },
];

function controls(harnessId: string): readonly Edit[] {
  return [
    {
      label: 'removeStage plan',
      run: (commands, caller) => commands.removeStage(caller, { harnessId, stageKey: 'plan' }),
    },
    {
      label: 'pause a lane',
      run: (commands, caller) => commands.pause(caller, { harnessId, stageKey: 'build' }),
    },
    {
      label: 'resume a lane',
      run: (commands, caller) => commands.resume(caller, { harnessId, stageKey: 'build' }),
    },
    {
      label: 'turn hosted Builder on',
      run: (commands, caller) => commands.setHostedBuilder(caller, { harnessId, enabled: true }),
    },
  ];
}

function structural(world: World, harnessId: string, stages: readonly Stage[]): readonly Edit[] {
  const [first] = stages;
  const order = stages.map((stage) => stage.key).reverse();
  return [
    {
      label: 'reorderStages reversed',
      run: (commands, caller) => commands.reorderStages(caller, { harnessId, order }),
    },
    ...controls(harnessId),
    {
      label: 'createStage ungated',
      run: (commands, caller) => {
        if (first === undefined) throw new Error('the harness has no stages');
        const stage = {
          key: 'sneak',
          title: 'Sneak',
          position: 1,
          bracket: first.bracket,
          agentPickup: 'allowed' as const,
          exitGate: 'none' as const,
          connector: 'none' as const,
          wipLimit: 1,
          instructionsPageId: null,
          validators: [],
          feeds: [],
        };
        return commands.createStage(caller, { harnessId, stage });
      },
    },
    ...activations.map(({ label, template }) => ({
      label: `activate ${label}`,
      run: (commands: StageCommands, caller: Caller) =>
        commands.activate(caller, {
          harnessId: world.adapters.ids.next(),
          harnessKey: 'sneak',
          jdArea: '80-89',
          template,
          repository: null,
          requiredChecks: [],
        }),
    })),
  ];
}

function stageRows(world: World, harnessId: string): Promise<readonly Stage[]> {
  return world.adapters.store.transaction((tx) => tx.harnessStages.read.forHarness(harnessId));
}

function harnessCount(world: World): Promise<number> {
  return world.adapters.store.transaction(async (tx) => (await tx.harnesses.read.list()).length);
}

export async function stageViolations(
  world: World,
  harnessId: string,
  attempts: readonly AgentAttempt[],
  commands: StageCommands,
): Promise<readonly string[]> {
  const before = await stageRows(world, harnessId);
  const activated = await harnessCount(world);
  const edits = [...updates(harnessId, before), ...structural(world, harnessId, before)];
  const violations: string[] = [];
  for (const edit of edits) {
    for (const attempt of attempts) {
      const outcome = await edit.run(commands, simCaller(world, attempt.actor));
      const reason = outcome.status === 'accepted' ? 'accepted' : outcome.reason;
      if (reason !== 'not_permitted') violations.push(`${attempt.label}, ${edit.label}: ${reason}`);
    }
  }
  const after = await stageRows(world, harnessId);
  if (JSON.stringify(after) !== JSON.stringify(before)) violations.push('harness_stages changed');
  if ((await harnessCount(world)) !== activated) violations.push('a harness was activated');
  return violations;
}
