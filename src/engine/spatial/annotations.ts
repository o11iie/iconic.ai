import type { SemanticId } from '@/lib/semantic-id';
import type { Vec3 } from '@/types/domain/spatial';

/**
 * Labels and pins
 * ===============
 *
 * Both are annotations anchored to a *semantic object*, never to a world
 * coordinate. That distinction is the whole design: a hard-coded position is
 * wrong the moment the asset is re-exported, the model is re-scaled, or a
 * different vendor supplies the geometry. Anchoring to identity means a label
 * authored today still points at the right structure after any of those.
 *
 * Positions are therefore derived at render time from the object's live
 * bounds, through the controller's bounds resolver.
 *
 * Domain-agnostic: an annotation knows a semantic id and some text, and
 * nothing about anatomy, chemistry or any other subject.
 */

/** Where an annotation sits relative to its object's bounds. */
export const ANCHOR_POINTS = ['center', 'top', 'bottom', 'front'] as const;
export type AnchorPoint = (typeof ANCHOR_POINTS)[number];

export interface SpatialLabel {
  readonly id: string;
  readonly semanticId: SemanticId;
  readonly name: string;
  /** Higher wins when labels collide or the budget is exceeded. */
  readonly priority: number;
  readonly visible: boolean;
  readonly anchor: AnchorPoint;
}

export const PIN_KINDS = ['note', 'question', 'bookmark', 'marker'] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export interface SpatialPin {
  readonly id: string;
  readonly semanticId: SemanticId;
  readonly title: string;
  readonly description: string | null;
  readonly kind: PinKind;
  readonly anchor: AnchorPoint;
  /** Author, when the pin came from a learner rather than the model. */
  readonly ownerId: string | null;
}

/** An annotation resolved to a world position, ready to render. */
export interface PositionedAnnotation<T> {
  readonly annotation: T;
  readonly position: Vec3;
}

/**
 * Annotation store.
 *
 * Holds labels and pins for the current model and resolves their positions on
 * demand. Deliberately not a React store: positions change whenever geometry
 * or the camera does, and pushing that through React state would re-render on
 * every frame.
 */
export class AnnotationRegistry {
  private readonly labels = new Map<string, SpatialLabel>();
  private readonly pins = new Map<string, SpatialPin>();

  // ---- labels --------------------------------------------------------------

  addLabel(label: SpatialLabel): void {
    this.labels.set(label.id, label);
  }

  /** Create one label per structure, e.g. from a freshly loaded graph. */
  setLabels(labels: readonly SpatialLabel[]): void {
    this.labels.clear();
    for (const label of labels) this.labels.set(label.id, label);
  }

  removeLabel(id: string): boolean {
    return this.labels.delete(id);
  }

  getLabel(id: string): SpatialLabel | null {
    return this.labels.get(id) ?? null;
  }

  labelsFor(semanticId: SemanticId): SpatialLabel[] {
    return [...this.labels.values()].filter((label) => label.semanticId === semanticId);
  }

  allLabels(): SpatialLabel[] {
    return [...this.labels.values()];
  }

  setLabelVisible(id: string, visible: boolean): boolean {
    const label = this.labels.get(id);
    if (!label) return false;
    this.labels.set(id, { ...label, visible });
    return true;
  }

  /**
   * Labels to draw, highest priority first, capped by a budget.
   *
   * A model with several hundred structures cannot render every label at once
   * without becoming unreadable, so the interface asks for what it can show
   * and the store decides which ones earn the space.
   */
  visibleLabels(budget = Number.POSITIVE_INFINITY): SpatialLabel[] {
    return [...this.labels.values()]
      .filter((label) => label.visible)
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
      .slice(0, budget);
  }

  // ---- pins ----------------------------------------------------------------

  addPin(pin: SpatialPin): void {
    this.pins.set(pin.id, pin);
  }

  removePin(id: string): boolean {
    return this.pins.delete(id);
  }

  getPin(id: string): SpatialPin | null {
    return this.pins.get(id) ?? null;
  }

  pinsFor(semanticId: SemanticId): SpatialPin[] {
    return [...this.pins.values()].filter((pin) => pin.semanticId === semanticId);
  }

  allPins(): SpatialPin[] {
    return [...this.pins.values()];
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Drop annotations whose object is not in the current model.
   *
   * Called after a model change so a label authored against one model cannot
   * float over unrelated geometry in another.
   */
  pruneTo(validIds: ReadonlySet<SemanticId>): number {
    let removed = 0;

    for (const [id, label] of this.labels) {
      if (!validIds.has(label.semanticId)) {
        this.labels.delete(id);
        removed += 1;
      }
    }
    for (const [id, pin] of this.pins) {
      if (!validIds.has(pin.semanticId)) {
        this.pins.delete(id);
        removed += 1;
      }
    }

    return removed;
  }

  clear(): void {
    this.labels.clear();
    this.pins.clear();
  }
}

/** Resolve an anchor point against a bounding box. */
export function anchorPosition(
  box: { readonly min: Vec3; readonly max: Vec3 },
  anchor: AnchorPoint,
): Vec3 {
  const center: Vec3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];

  switch (anchor) {
    case 'top':
      return [center[0], box.max[1], center[2]];
    case 'bottom':
      return [center[0], box.min[1], center[2]];
    case 'front':
      return [center[0], center[1], box.max[2]];
    case 'center':
    default:
      return center;
  }
}

/** Default label set for a model: one per structure, deeper is less important. */
export function defaultLabelsFor(
  objects: readonly { semanticId: SemanticId; name: string; depth: number }[],
): SpatialLabel[] {
  return objects.map((object) => ({
    id: `label:${object.semanticId}`,
    semanticId: object.semanticId,
    name: object.name,
    // Shallower structures are more useful as orientation, so they win the
    // limited label budget over deeply nested detail.
    priority: Math.max(0, 100 - object.depth * 10),
    visible: false,
    anchor: 'top' as const,
  }));
}
