import type { WindowsBuildConfig } from '@shared/types.js';

export type ConfigUpdater = (mutate: (draft: WindowsBuildConfig) => void) => void;

/** Structured clone keeps updates immutable without pulling in a state library. */
export function updateConfig(config: WindowsBuildConfig, mutate: (draft: WindowsBuildConfig) => void): WindowsBuildConfig {
  const draft = structuredClone(config);
  mutate(draft);
  return draft;
}

export function issueFor(issues: Array<{ field: string; message: string; severity: string }>, field: string): string | undefined {
  return issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;
}

export function warningsFor(issues: Array<{ field: string; message: string; severity: string }>): string[] {
  return issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message);
}
