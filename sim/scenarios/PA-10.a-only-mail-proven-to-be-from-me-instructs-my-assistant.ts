import assert from 'node:assert/strict';
import type { InboundMail, KernelOutcome } from '@uw/harness';
import { simProvisioner } from '../assistant-account-fixtures.ts';
import {
  assistantLog,
  assistantNames,
  beginTurn,
  finishTurn,
  grantedScene,
  replyWith,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { simCaller, simSystem } from '../fixtures.ts';
import { inboundMail, MAIL_OWNER } from '../mail-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const reply = 'I will remind you on Monday at nine.';

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

async function bindMail(scene: AssistantScene): Promise<void> {
  value(
    await scene.world.kernel.assistants.bindAddress(simCaller(scene.world, simProvisioner()), {
      personId: personOf(scene.person),
      channel: 'email',
      address: MAIL_OWNER,
    }),
  );
  scene.world.adapters.directMessages.bind(personOf(scene.person), 'email', MAIL_OWNER);
}

async function declined(scene: AssistantScene): Promise<readonly unknown[]> {
  const answers: unknown[] = [];
  for (const name of ['spoofed-from', 'forged-lower-authentication-results', 'colleague']) {
    const outcome = await admit(scene, inboundMail(name));
    answers.push(outcome.status === 'error' ? outcome.detail['why'] : outcome.status);
  }
  return answers;
}

async function answeredByMail(scene: AssistantScene): Promise<void> {
  const { requestId } = value(await admit(scene, inboundMail('owner-verified')));
  const turn = value(await beginTurn(scene, requestId));
  assert.ok(turn.loop.prompt.includes('Please remind me about this on Monday at nine.'));
  scene.world.adapters.modelEngine.respondNextWith(replyWith(reply, 20_000));
  await finishTurn(scene, requestId, turn);
  const sent = scene.world.adapters.directMessages.sent();
  assert.deepEqual(
    sent.map((message) => [message.channel, message.replyAddress, message.threadKey, message.text]),
    [['email', MAIL_OWNER, 'gmail-owner-verified', reply]],
  );
}

export const scenario = defineScenario({
  id: 'PA-10',
  title:
    'mail instructs my assistant only when it comes from my own address and the top Google Authentication-Results header proves it: a spoofed From, a forged lower result and a colleague are each declined with a closed reason and start no turn, and my verified mail is answered by one email to my bound address, with the forwarded original fenced as untrusted',
  run: async (world) => {
    const scene = await grantedScene(world);
    await bindMail(scene);
    const answers = await declined(scene);
    assert.deepEqual(answers, ['unverified_sender', 'unverified_sender', 'other_sender']);
    assert.equal(world.adapters.directMessages.sent().length, 0);
    await answeredByMail(scene);
    const names = assistantNames(await assistantLog(scene));
    assert.ok(!names.slice(0, 3).includes('assistant_turn_started'));
    return { state: { answers, events: names } };
  },
});
