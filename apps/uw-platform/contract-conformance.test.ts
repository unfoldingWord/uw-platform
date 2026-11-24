import { describe, it } from 'vitest';
import { assertLiveContractVersion } from '@uw/contracts/version';
import manifest from './package.json' with { type: 'json' };

describe('contract conformance', () => {
  it('is pinned to the live contract version', () => {
    assertLiveContractVersion(manifest.contractVersion);
  });
});
