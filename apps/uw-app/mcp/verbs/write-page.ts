import { writePageAsAgent } from '../../pages/agent-write.ts';
import { externalWriter } from './external-writer.ts';
import { gatedHandler, refusal, type VerbInput, type VerbRefusal } from '../handler.ts';
import type { VerbContext } from '../context.ts';
import { hiddenPage, storedPageArea } from './page-scene.ts';

type WriteInput = VerbInput<'write_page'>;

function hiddenWrite(input: WriteInput): VerbRefusal {
  return input.expectedVersion === null ? refusal('not_permitted') : hiddenPage(input);
}

async function writeArea(context: VerbContext, input: WriteInput) {
  if (input.expectedVersion !== null) return storedPageArea(context, input);
  return { resource: { kind: 'area' as const, area: input.jdArea }, found: null };
}

export const writePageVerb = gatedHandler({
  name: 'write_page',
  hidden: hiddenWrite,
  resource: writeArea,
  run: async (context, input) => {
    const { db, principal, traceId, at, kernel } = context;
    const writer = input.type === 'learning' ? await externalWriter(context) : null;
    const request = { traceId, at, instructions: kernel.reads, writer };
    const written = await writePageAsAgent(db, principal, input, request);
    if (!written.ok) {
      if (written.reason === 'page_not_found') return hiddenPage(input);
      return refusal(written.reason, 'detail' in written ? written.detail : {});
    }
    const { page } = written;
    return {
      status: 'accepted',
      output: { pageId: page.id, version: page.version, status: page.status },
    };
  },
});
