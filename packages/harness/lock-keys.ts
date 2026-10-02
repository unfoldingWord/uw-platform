export const lockKeys = {
  stageClaims: (stageId: string) => `harness-stage-claims:${stageId}`,
  harnessStages: (harnessId: string) => `harness-stages:${harnessId}`,
  harnessEvents: (harnessId: string) => `harness_events:${harnessId}`,
  githubIssue: (githubId: number) => `github-issue:${githubId}`,
  personaActivation: (pageId: string) => `persona-activation:${pageId}`,
};
