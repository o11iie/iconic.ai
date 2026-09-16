export { SpatialCanvas, type SpatialCanvasProps } from './canvas/SpatialCanvas';
export { SpatialCameraRig, type SpatialCameraRigProps } from './camera/SpatialCameraRig';
export { SpatialSceneRoot, type SpatialSceneRootProps } from './scene/SpatialSceneRoot';
export { ModelLoader, preloadModel, useClonedGLTF, useLoaderProgress } from './scene/ModelLoader';
export {
  buildDiagnosticScene,
  DIAGNOSTIC_LABEL,
  DIAGNOSTIC_MODEL_REF,
  DIAGNOSTIC_DOMAIN,
  DIAGNOSTIC_NODES,
  type DiagnosticNodeSpec,
} from './diagnostics/diagnostic-scene';
export { detectWebGL, resetWebGLDetection, type WebGLSupport } from './webgl';
export { boundsOf, boundsOfAll, centerOf } from './bounds';
export * from './camera/camera-math';
export {
  MaterialStateManager,
  DEFAULT_PALETTE,
  type VisualColorPalette,
} from './materials/material-state';
export {
  disposeObject3D,
  disposeMaterial,
  clearScene,
  countResources,
  type DisposalReport,
} from './disposal';
export {
  configureRenderer,
  resolveDevicePixelRatio,
  shouldAntialias,
  resolveClippingPlanes,
  TONE_MAPPING_POLICY,
  FRAMELOOP,
} from './renderer/renderer-config';
export {
  isClick,
  resolveHit,
  nextSelection,
  modeAllowsHover,
  modeAllowsSelection,
  CLICK_SLOP_PX,
  type PointerOrigin,
} from './interaction/pointer';
