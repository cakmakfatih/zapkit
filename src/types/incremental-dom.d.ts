// Type declarations for the subset of incremental-dom@0.7.0 that zapkit-tv uses.
// The package ships TypeScript sources but no compiled .d.ts, so we declare the
// public surface here instead of compiling its sources (they do not typecheck
// against the current DOM lib). tsconfig "paths" maps the module to this file.
export type Key = string | number | null | undefined;
export type Statics = unknown[] | null | undefined;
export type NameOrCtorDef = string | (new () => Element);
export type AttrMutator = (el: Element, name: string, value: unknown) => void;

export interface AttrMutatorConfig {
  [name: string]: AttrMutator;
}

export interface PatchConfig {
  matches?: (
    matchNode: Node,
    nameOrCtor: NameOrCtorDef,
    expectedNameOrCtor: NameOrCtorDef,
    key: Key,
    expectedKey: Key
  ) => boolean;
}

export type PatchFunction = <T>(node: Element | DocumentFragment, template: (data: T) => void, data?: T) => Node;

export const attributes: AttrMutatorConfig;
export const symbols: { default: string };
export const notifications: {
  nodesCreated: ((nodes: Node[]) => void) | null;
  nodesDeleted: ((nodes: Node[]) => void) | null;
};

export function applyAttr(el: Element, name: string, value: unknown): void;
export function applyProp(el: Element, name: string, value: unknown): void;

export function elementOpen(nameOrCtor: NameOrCtorDef, key?: Key, statics?: Statics, ...varArgs: unknown[]): HTMLElement;
export function elementOpenStart(nameOrCtor: NameOrCtorDef, key?: Key, statics?: Statics): void;
export function attr(name: string, value: unknown): void;
export function elementOpenEnd(): HTMLElement;
export function elementClose(nameOrCtor: NameOrCtorDef): Element;
export function elementVoid(nameOrCtor: NameOrCtorDef, key?: Key, statics?: Statics, ...varArgs: unknown[]): Element;
export function text(value: string | number | boolean, ...formatters: Array<(v: unknown) => string>): Text;
export function skip(): void;
export function skipNode(): void;
export function currentElement(): Element;
export function currentPointer(): Node | null;
export function open(nameOrCtor: NameOrCtorDef, key?: Key): HTMLElement;
export function close(): Element;

export const patch: PatchFunction;
export const patchInner: PatchFunction;
export const patchOuter: PatchFunction;
export function createPatchInner(config?: PatchConfig): PatchFunction;
export function createPatchOuter(config?: PatchConfig): PatchFunction;

export function setKeyAttributeName(name: string | null): void;
export function importNode(node: Node): void;
export function getKey(node: Node): Key;
export function clearCache(node: Node): void;
