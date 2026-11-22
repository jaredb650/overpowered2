/**
 * The cheat panel's lists in alphabetical order of what their buttons say (owner, 2026-11-22). A label can be several parts,
 * compared one after another: a mod sorts by its gun's name and then its own, so one gun's mods sit together.
 */
const cmp = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

export function byLabel<T>(items: readonly T[], label: (item: T) => string | readonly string[]): T[] {
  const keyed = items.map((item, i) => {
    const l = label(item);
    return { item, parts: typeof l === 'string' ? [l] : l, i };
  });
  keyed.sort((a, b) => {
    for (let k = 0; k < Math.max(a.parts.length, b.parts.length); k++) {
      const c = cmp(a.parts[k] ?? '', b.parts[k] ?? '');
      if (c !== 0) return c;
    }
    return a.i - b.i;
  });
  return keyed.map(x => x.item);
}
