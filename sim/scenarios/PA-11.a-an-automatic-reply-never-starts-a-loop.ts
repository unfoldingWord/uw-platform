import assert from 'node:assert/strict';
import type { InboundMail, KernelOutcome } from '@uw/harness';
import { simProvisioner } from '../assistant-account-fixtures.ts';
import { assistantLog, grantedScene, type AssistantScene } from '../assistant-fixtures.ts';
import { simCaller, simSystem } from '../fixtures.ts';
import { inboundMail, MAIL_OWNER } from '../mail-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const REQUESTS_PER_HOUR = 30;

function admit(
  scene: AssistantScene,
  mail: InboundMail,
): Promise<KernelOutcome<{ requestId: string }>> {
  return scene.world.kernel.assistants.admitMail(simCaller(scene.world, simSystem()), {
    personId: personOf(scene.person),
    mail,
    instructions: 'on',
  });
}

function why(outcome: KernelOutcome<unknown>): unknown {
  return outcome.status === 'error' ? outcome.detail['why'] : outcome.status;
}

async function automatedDeclined(scene: AssistantScene): Promise<readonly unknown[]> {
  const ownReply = inboundMail('owner-verified', {
    externalId: 'gmail-own-reply',
    headers: [
      ...inboundMail('owner-verified').headers,
      { name: 'Auto-Submitted', value: 'auto-replied' },
    ],
  });
  const fromAssistant = inboundMail('owner-verified', {
    externalId: 'gmail-assistant',
    fromAssistant: true,
  });
  return [
    why(await admit(scene, inboundMail('out-of-office'))),
    why(await admit(scene, ownReply)),
    why(await admit(scene, fromAssistant)),
  ];
}

async function capped(scene: AssistantScene): Promise<unknown> {
  for (let n = 0; n < REQUESTS_PER_HOUR; n += 1) {
    value(await admit(scene, inboundMail('owner-verified', { externalId: `gmail-${String(n)}` })));
  }
  return why(await admit(scene, inboundMail('owner-verified', { externalId: 'gmail-31' })));
}

export const scenario = defineScenario({
  id: 'PA-11',
  title:
    "an automatic reply never starts a loop: an out-of-office from my own address, mail marked Auto-Submitted (as my assistant's own replies are) and mail from another assistant are declined as automated_sender before anything is recorded, and the thirty-first request in an hour is refused requests_capped",
  run: async (world) => {
    const scene = await grantedScene(world);
    value(
      await world.kernel.assistants.bindAddress(simCaller(world, simProvisioner()), {
        personId: personOf(scene.person),
        channel: 'email',
        address: MAIL_OWNER,
      }),
    );
    const automated = await automatedDeclined(scene);
    assert.deepEqual(automated, ['automated_sender', 'automated_sender', 'automated_sender']);
    const declined = (await assistantLog(scene)).filter(
      (event) => event.name === 'assistant_mail_declined',
    );
    assert.equal(declined.length, 3);
    const thirtyFirst = await capped(scene);
    assert.equal(thirtyFirst, 'requests_capped');
    return { state: { automated, thirtyFirst } };
  },
});
