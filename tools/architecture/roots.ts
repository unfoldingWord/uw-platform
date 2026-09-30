export const architectureRoots = ['apps', 'packages', 'sim', 'tests'];

export function presentRoots(exists: (root: string) => boolean): string[] {
  return architectureRoots.filter(exists);
}
