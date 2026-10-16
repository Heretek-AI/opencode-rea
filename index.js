// Packaging entrypoint: the host resolves a local plugin directory via a
// root index.js and ignores package.json main/exports — without this file a
// packed+extracted dir is silently never loaded (no LoadError; T14 probe:
// 12 builtin tools only, no rea_readiness; with this re-export: 13 tools,
// rea_readiness completes). Same shape as the T11 wrapper / T12 staging fix.
export { default } from "./dist/index.js";
export * from "./dist/index.js";
