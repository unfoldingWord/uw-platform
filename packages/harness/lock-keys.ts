export const lockKeys = {
  stageClaims: (stageId: string) => `harness-stage-claims:${stageId}`,
  harnessStages: (harnessId: string) => `harness-stages:${harnessId}`,
};
