import { RESEARCH_SOURCES_MOST } from '@uw/contracts';
import { lockKeys } from '../lock-keys.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import type { TurnAddress, TurnScene } from './reminder-turn.ts';

type SourcePorts = Pick<Ports, 'store'>;

const WRITTEN_ADDRESS = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[)\].,;:!?'"]+$/;
const WEB_ADDRESS = /^(https?):\/\/([^/?#\s]+)([^\s]*)$/i;

export function webAddressOf(text: string): string | null {
  const parts = WEB_ADDRESS.exec(text.trim());
  if (parts === null) return null;
  const [, scheme = '', host = '', rest = ''] = parts;
  const path = rest.startsWith('/') ? rest : `/${rest}`;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${path}`;
}

export function writtenAddresses(text: string): readonly string[] {
  const found = text.match(WRITTEN_ADDRESS) ?? [];
  return found.flatMap((each) => {
    const address = webAddressOf(each.replace(TRAILING, ''));
    return address === null ? [] : [address];
  });
}

export function offeredOnly(url: string) {
  return async (scene: TurnScene): Promise<Refused | null> => {
    const address = webAddressOf(url);
    const { tx, request } = scene;
    const searched = await tx.assistantRequests.read.researchSources(request.id);
    const offered = new Set([...writtenAddresses(request.note), ...searched]);
    if (address !== null && offered.has(address)) return null;
    return refused('not_permitted', { why: 'address_not_offered' });
  };
}

export function recordSources(
  ports: SourcePorts,
  input: TurnAddress,
  urls: readonly string[],
): Promise<void> {
  const addresses = urls.flatMap((url) => {
    const address = webAddressOf(url);
    return address === null ? [] : [address];
  });
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.assistantRequest(input.requestId));
    await tx.assistantRequests.write.addResearchSources(
      input.requestId,
      addresses.slice(0, RESEARCH_SOURCES_MOST),
    );
  });
}
