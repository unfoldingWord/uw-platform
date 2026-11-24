import { storeFile } from '../../pages/files.ts';
import { gatedHandler, refusal, type VerbInput } from '../handler.ts';
import { hiddenPage, storedPageArea } from './page-scene.ts';

type AttachInput = VerbInput<'attach_file'>;

function bytesOf(input: AttachInput): Uint8Array {
  return Uint8Array.from(atob(input.contentBase64), (char) => char.charCodeAt(0));
}

export const attachFileVerb = gatedHandler({
  name: 'attach_file',
  hidden: hiddenPage,
  resource: storedPageArea,
  run: async (context, input) => {
    if (!context.files) return refusal('not_wired');
    const reader = { actor: context.principal, at: context.at };
    const upload = {
      fileId: input.fileId,
      pageId: input.pageId,
      name: input.name,
      contentType: input.contentType,
      bytes: bytesOf(input),
    };
    const stored = await storeFile(context.db, context.files, reader, upload);
    if (stored.ok) return { status: 'accepted', output: { file: stored.file } };
    return stored.reason === 'page_not_found' ? hiddenPage(input) : refusal(stored.reason);
  },
});
