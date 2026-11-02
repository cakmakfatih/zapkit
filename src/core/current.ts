import type { Instance } from './component';

/** @internal The component instance whose render() is currently running. */
export const current: { instance: Instance | null; pass: number } = { instance: null, pass: 0 };
