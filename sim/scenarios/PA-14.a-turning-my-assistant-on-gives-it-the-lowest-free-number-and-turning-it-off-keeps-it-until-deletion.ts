import assert from 'node:assert/strict';
import {
  accountEvents,
  disable,
  enable,
  passDays,
  retire,
  staffPerson,
} from '../assistant-account-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'PA-14',
  title:
    'a person turns on their own assistant and gets 10.51, the next gets 10.52, a repeat changes nothing, turning off and on keeps the number, and final deletion frees the lowest number for reuse; one assistant per person',
  run: async (world) => {
    const ana = await staffPerson(world, 61);
    const ben = await staffPerson(world, 62);
    const cy = await staffPerson(world, 64);
    const first = value(await enable(world, ana, 'barnabas'));
    const second = value(await enable(world, ben, 'silas'));
    assert.deepEqual([first.jdId, second.jdId], ['10.51', '10.52']);
    assert.deepEqual(value(await enable(world, ana, 'barnabas')), { ...first, created: false });
    const another = await enable(world, ana, 'tychicus');
    assert.equal(another.status, 'error');
    value(await disable(world, ana));
    assert.equal(value(await enable(world, ana, 'barnabas')).jdId, '10.51');
    value(await disable(world, ana));
    passDays(world, 30);
    assert.equal(value(await retire(world, first.harnessId)).jdId, '10.51');
    const reused = value(await enable(world, cy, 'lydia'));
    assert.equal(reused.jdId, '10.51');
    const back = value(await enable(world, ana, 'tychicus'));
    assert.equal(back.harnessId, first.harnessId);
    assert.equal(back.jdId, '10.53');
    return {
      state: {
        numbers: { ana: back.jdId, ben: second.jdId, cy: reused.jdId },
        events: (await accountEvents(world, first.harnessId)).map((event) => event.name),
      },
    };
  },
});
