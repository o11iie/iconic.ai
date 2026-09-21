export * from './taxonomy';
export * from './providers/anatomy-provider';
export * from './providers/registry';
export * from './models/catalog';
export { buildMeshMapping, buildProviderMapping } from './mapping/manifest';
export type { AnatomyManifest, ManifestObject, SpatialManifest } from './mapping/manifest';
export { parseManifest, validateManifest } from './mapping/validation';
export type { ManifestIssue, ManifestValidation } from './mapping/validation';
