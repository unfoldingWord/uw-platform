export const CONTRACT_VERSION = '12.0.0';

export function assertLiveContractVersion(pinned: string): void {
  if (pinned !== CONTRACT_VERSION) {
    throw new Error(`stale contract version ${pinned}; the live version is ${CONTRACT_VERSION}`);
  }
}
