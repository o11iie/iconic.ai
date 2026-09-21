import type { SemanticId } from '@/lib/semantic-id';
import type { BoundingBox, Vec3 } from '@/types/domain/spatial';

/**
 * Engine-level spatial types. Domain-agnostic by construction: nothing here
 * knows what a heart, a molecule or a truss is.
 */

/**
 * How an object is currently being presented in the viewport.
 *
 * One value per object, resolved from the whole manipulation state — not a
 * collection of independent flags that can contradict each other. The three
 * removal states are distinct although two of them do not render: they are
 * undone by different operations and mean different things to the learner.
 */
export const VISUAL_STATES = [
  'default',
  'hovered',
  'selected',
  'highlighted',
  'isolated',
  'ghosted',
  'peeled',
  'dissected',
  'hidden',
] as const;
export type VisualState = (typeof VISUAL_STATES)[number];

/** States in which an object is not drawn at all. */
export const NON_RENDERING_STATES: ReadonlySet<VisualState> = new Set<VisualState>([
  'hidden',
  'dissected',
]);

/** What a pointer interaction means right now. */
export const INTERACTION_MODES = [
  'inspect', // hover + select to learn
  'orbit', // camera only; pointer never changes selection
  'isolate', // click removes everything else
  'annotate', // click drops a pin
  'measure', // future: distance between structures
  'dissect', // future: progressive removal of layers
] as const;
export type InteractionMode = (typeof INTERACTION_MODES)[number];

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Vertical field of view in degrees. */
  readonly fov: number;
}

export interface FlyToOptions {
  /** Milliseconds. 0 snaps immediately. */
  readonly durationMs?: number;
  /** Multiplier on the fitted distance. >1 pulls the camera back. */
  readonly padding?: number;
  /** Honour prefers-reduced-motion by snapping instead of animating. */
  readonly reducedMotion?: boolean;
}

export interface LoadProgress {
  /** 0..1, or null when the transport cannot report progress. */
  readonly ratio: number | null;
  readonly loadedBytes: number;
  readonly totalBytes: number | null;
  readonly phase: 'idle' | 'downloading' | 'parsing' | 'mapping' | 'ready' | 'failed';
}

export const IDLE_PROGRESS: LoadProgress = {
  ratio: null,
  loadedBytes: 0,
  totalBytes: null,
  phase: 'idle',
};

/** A label or pin anchored to a point in model space. */
export interface SpatialAnnotation {
  readonly id: string;
  readonly objectId: SemanticId | null;
  readonly position: Vec3;
  readonly label: string;
  readonly kind: 'label' | 'pin' | 'note';
}

/** Resolved presentation for the whole scene, consumed by the renderer. */
export interface SceneVisualState {
  readonly states: ReadonlyMap<SemanticId, VisualState>;
  readonly isolatedId: SemanticId | null;
  readonly hiddenLayerIds: ReadonlySet<string>;
  readonly ghostedLayerIds: ReadonlySet<string>;
  readonly peelLevel: number;
  readonly dissectedIds: readonly SemanticId[];
  readonly exploded: boolean;
}

export interface ObjectSummary {
  readonly semanticId: SemanticId;
  readonly name: string;
  readonly parentId: SemanticId | null;
  readonly childIds: readonly SemanticId[];
  readonly boundingBox: BoundingBox | null;
}
