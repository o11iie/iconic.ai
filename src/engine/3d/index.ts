export { SpatialCanvas } from './canvas/SpatialCanvas';
export { SpatialCameraRig } from './camera/SpatialCameraRig';
export { MappedModel, preloadModel } from './scene/MappedModel';
export { PipelineDiagnostic } from './diagnostics/PipelineDiagnostic';
export { detectWebGL, resetWebGLDetection, type WebGLSupport } from './webgl';
export * from './camera/camera-math';
export {
  applyVisualState,
  restoreMaterials,
  disposeClonedMaterials,
  DEFAULT_PALETTE,
  type VisualColorPalette,
} from './materials/visual-materials';
