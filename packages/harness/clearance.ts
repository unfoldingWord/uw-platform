import type { Principal } from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';

export function clearanceKey(reader: Principal, at: Date): string {
  const readable = readableAreas(reader, at);
  return readable.kind === 'all' ? 'clearance:all' : `clearance:${readable.areas.join(',')}`;
}
