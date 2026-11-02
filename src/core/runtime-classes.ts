/*
 * Classes added to elements at runtime (focus state and the like). The
 * renderer keeps them when it rewrites an element's `class` attribute, so a
 * re-render never drops e.g. `kb-focused` from the focused element.
 */
export const runtimeClasses = new Set<string>();

export function preserveClass(...names: string[]): void {
  for (const n of names) if (n) runtimeClasses.add(n);
}
