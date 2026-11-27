import type { Executor } from '@uw/db/client';
import { accepted, refused } from '@uw/harness';
import { readTeam } from '../people/team-reads.ts';
import { harnessFreshness } from './freshness.ts';
import { kernelSources, type ChartSources, type KernelReader } from './sources.ts';

export function platformSources(db: Executor, reader: KernelReader): ChartSources {
  const { at } = reader;
  return kernelSources(reader, {
    freshness: () => harnessFreshness(db, at),
    team: async () => {
      const read = await readTeam(db, reader.caller.actor, at);
      return read === null ? refused('not_permitted') : accepted(read);
    },
  });
}
