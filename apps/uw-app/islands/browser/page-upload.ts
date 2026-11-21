import { reasonText } from '@uw/ui/components/text.ts';

export type UploadDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
};

type Placed = { readonly name: string; readonly contentType: string; readonly url: string };

const refusalWords: ReadonlyMap<string, string> = new Map([
  ['file_type_not_allowed', 'this kind of file cannot be stored here'],
  ['file_too_large', 'the file is larger than 20 MB'],
  ['not_wired', 'file storage is not set up yet'],
  ['not_permitted', 'you cannot change this page'],
]);

export function markdownFor(file: Placed): string {
  const name = file.name.replace(/[\\[\]]/g, (bracket) => `\\${bracket}`);
  const link = `[${name}](${file.url})`;
  return file.contentType.startsWith('image/') ? `!${link}` : link;
}

function placedOf(body: unknown): Placed | null {
  if (typeof body !== 'object' || body === null || !('file' in body)) return null;
  const file = body.file;
  if (typeof file !== 'object' || file === null) return null;
  const read = new Map<string, unknown>(Object.entries(file));
  const [name, contentType, url] = [read.get('name'), read.get('contentType'), read.get('url')];
  if (typeof name !== 'string' || typeof contentType !== 'string' || typeof url !== 'string') {
    return null;
  }
  return { name, contentType, url };
}

function reasonOf(body: unknown): string {
  const reason = typeof body === 'object' && body !== null && 'reason' in body ? body.reason : null;
  return typeof reason === 'string' ? reason : 'internal_error';
}

function insert(area: HTMLTextAreaElement, text: string): void {
  const at = area.selectionStart;
  const before = area.value.slice(0, at);
  const after = area.value.slice(area.selectionEnd);
  const lead = before === '' || /\s$/.test(before) ? '' : ' ';
  const trail = after === '' || /^\s/.test(after) ? '' : ' ';
  area.value = `${before}${lead}${text}${trail}${after}`;
  const view = area.ownerDocument.defaultView;
  if (view !== null) area.dispatchEvent(new view.Event('input', { bubbles: true }));
}

async function upload(region: Element, file: File, deps: UploadDeps): Promise<Placed | string> {
  const page = region.getAttribute('data-page') ?? '';
  const name = encodeURIComponent(file.name);
  const url = `/api/files/${deps.uuid()}?page=${encodeURIComponent(page)}&name=${name}`;
  const response = await deps
    .fetch(url, { method: 'PUT', headers: { 'content-type': file.type }, body: file })
    .catch(() => null);
  if (response === null) return 'internal_error';
  const body: unknown = await response.json().catch(() => null);
  return placedOf(body) ?? reasonOf(body);
}

async function onChosen(region: Element, input: HTMLInputElement, deps: UploadDeps): Promise<void> {
  const file = input.files?.[0];
  const status = region.querySelector('[data-upload-status]');
  const area = region
    .closest('form')
    ?.querySelector<HTMLTextAreaElement>('textarea[name="bodyMd"]');
  if (file === undefined || area === null || area === undefined) return;
  const say = (words: string) => {
    if (status !== null) status.textContent = words;
  };
  say(`Adding ${file.name}`);
  const outcome = await upload(region, file, deps);
  if (typeof outcome === 'string') {
    say(`Not added: ${refusalWords.get(outcome) ?? reasonText(outcome).toLowerCase()}.`);
    return;
  }
  insert(area, markdownFor(outcome));
  input.value = '';
  say(`Added ${outcome.name}. Save the page to keep it.`);
}

export function wirePageUpload(document: Document, deps: UploadDeps): void {
  document.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement | null;
    const region = input?.closest?.('[data-upload]') ?? null;
    if (input === null || region === null || !input.hasAttribute('data-upload-input')) return;
    if (region.closest('form')?.hasAttribute('data-editor-active') === true) return;
    void onChosen(region, input, deps);
  });
}
