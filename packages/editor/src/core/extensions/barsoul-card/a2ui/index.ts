/**
 * BARSOUL: 審査カード摘要部の A2UI 試験導入（v0.9.1）。
 * 公開するのは block.tsx が使う分だけ。
 */
export { ATOMIC_ACTION_WHITELIST, createAtomicActionDispatcher, safeExternalHref } from "./actions";
export type { AtomicActionHandlers, AtomicActionName } from "./actions";
export { BARSOUL_PLANE_CATALOG_ID, barsoulPlaneCatalog } from "./catalog";
export { A2UI_ATOMS_EVENT, A2UI_ATOMS_KEY, readA2uiAtomsFlag, setA2uiAtomsFlag, subscribeA2uiAtomsFlag } from "./flag";
export { AtomicPresentationSurface } from "./surface";
export { buildPresentationMessages, leadingPresentationCount } from "./transform";
export type { CardSpecBlock, PresentationTransformInput } from "./transform";
