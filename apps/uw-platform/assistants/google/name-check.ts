import { assistantAddressOf } from '@uw/contracts';
import type { Directory } from './directory.ts';

export type NameCheckSide = { readonly directory: Directory; readonly domain: string };

export async function assistantNameTaken(
  side: NameCheckSide,
  name: string,
  ownHarnessId: string | null,
): Promise<boolean> {
  const address = assistantAddressOf(name, side.domain);
  const user = await side.directory.user(address);
  const owned = ownHarnessId !== null && user.ok && user.value?.harnessId === ownHarnessId;
  if (user.ok && user.value !== null && !owned) return true;
  const group = await side.directory.group(address);
  return group.ok && group.value !== null;
}
