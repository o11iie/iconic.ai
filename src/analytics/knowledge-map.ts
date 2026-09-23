import type { SemanticId } from '@/lib/semantic-id';
import { semanticIdAncestors, semanticIdToLabel } from '@/lib/semantic-id';
import { isRecalled } from '@/learning/scheduler';
import type { KnowledgeMap, KnowledgeMapNode, MasteryBand, StructureMasteryView } from './contract';
import type { CleanSnapshot } from './integrity';

/**
 * The learner's knowledge, as a tree.
 *
 * ## Where the hierarchy comes from
 *
 * The semantic ids themselves. `veo.anatomy.cardiovascular.heart.left_ventricle`
 * sits inside `veo.anatomy.cardiovascular.heart`, which sits inside
 * `veo.anatomy.cardiovascular` — and that is the entire rule. There is no
 * table of anatomical systems, no list of domains, and nothing here that knows
 * what a heart is. The same code builds a chemistry, engineering, physics or
 * astrophysics map from ids of the same shape.
 *
 * ## Why it does not need a 3D model
 *
 * The map is built from what the learner has STUDIED, not from what VEO can
 * render. With Gate 9 RED no anatomy model loads, and the map is still
 * complete and correct — it simply reports, per node, that the structure
 * cannot currently be opened. Analytics that went blank without geometry would
 * make a learner's history hostage to an asset licence.
 *
 * ## Labels
 *
 * A node's label is its own id segment, humanised. VEO does not invent a
 * display name for a structure: the name belongs to the loaded model, and the
 * UI substitutes the real one when there is one to substitute. Making one up
 * here would be fabricating anatomy in a chart.
 */

interface Totals {
  masterySum: number;
  items: number;
  reviews: number;
  recalled: number;
  dueNow: number;
  reviewedItems: number;
}

function emptyTotals(): Totals {
  return { masterySum: 0, items: 0, reviews: 0, recalled: 0, dueNow: 0, reviewedItems: 0 };
}

interface Options {
  /** Models that can actually be opened. See `canViewInModel`. */
  readonly availableModels: ReadonlySet<string>;
  /** How deep to build. Beyond this, descendants are still counted. */
  readonly maxDepth?: number;
}

export function buildKnowledgeMap(
  snapshot: CleanSnapshot,
  views: readonly StructureMasteryView[],
  options: Options,
): KnowledgeMap {
  const maxDepth = options.maxDepth ?? 4;

  // ---- reviews per structure ---------------------------------------------

  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  const reviewsByStructure = new Map<SemanticId, { total: number; recalled: number }>();

  for (const event of snapshot.events) {
    const semanticId = itemsById.get(event.itemId)?.semanticId;
    if (!semanticId) continue;

    const entry = reviewsByStructure.get(semanticId) ?? { total: 0, recalled: 0 };
    entry.total += 1;
    if (isRecalled(event.rating)) entry.recalled += 1;
    reviewsByStructure.set(semanticId, entry);
  }

  // ---- roll every structure up through its ancestors ----------------------

  const totals = new Map<SemanticId, Totals>();
  const models = new Map<SemanticId, string | null>();

  const accumulate = (id: SemanticId, view: StructureMasteryView) => {
    const entry = totals.get(id) ?? emptyTotals();

    entry.masterySum += view.mastery * view.itemCount;
    entry.items += view.itemCount;
    entry.dueNow += view.dueNow;

    const reviews = reviewsByStructure.get(view.semanticId);
    if (reviews) {
      entry.reviews += reviews.total;
      entry.recalled += reviews.recalled;
    }
    if (view.reviewCount > 0) entry.reviewedItems += view.itemCount;

    totals.set(id, entry);

    // A parent can only offer "view in 3D" when every descendant that names a
    // model names the SAME one. Two models under one node means VEO cannot say
    // which to open, so it offers neither rather than picking.
    if (!models.has(id)) models.set(id, view.modelRef);
    else if (models.get(id) !== view.modelRef) models.set(id, null);
  };

  for (const view of views) {
    accumulate(view.semanticId, view);
    for (const ancestor of semanticIdAncestors(view.semanticId)) accumulate(ancestor, view);
  }

  // ---- build the tree -----------------------------------------------------

  const depthOf = (id: SemanticId) => id.split('.').length - 2;
  const known = [...totals.keys()].sort(
    (a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b),
  );
  const minDepth = known.length > 0 ? depthOf(known[0]!) : 0;

  const childrenOf = (parent: SemanticId) =>
    known.filter(
      (candidate) =>
        candidate.startsWith(`${parent}.`) &&
        !candidate.slice(parent.length + 1).includes('.'),
    );

  const build = (id: SemanticId, level: number): KnowledgeMapNode => {
    const entry = totals.get(id) ?? emptyTotals();
    const mastery = entry.items > 0 ? entry.masterySum / entry.items : 0;
    const modelRef = models.get(id) ?? null;

    return {
      semanticId: id,
      label: semanticIdToLabel(id),
      depth: depthOf(id),
      mastery,
      // Null, not 0: a node nobody has reviewed has no retention, and drawing
      // it at 0% would show total failure where there is simply no evidence.
      retention: entry.reviews === 0 ? null : entry.recalled / entry.reviews,
      itemCount: entry.items,
      reviewCount: entry.reviews,
      dueNow: entry.dueNow,
      band: bandFor(mastery, entry),
      modelRef,
      canViewInModel: modelRef !== null && options.availableModels.has(modelRef),
      children: level >= maxDepth ? [] : childrenOf(id).map((child) => build(child, level + 1)),
    };
  };

  const roots = known.filter((id) => depthOf(id) === minDepth).map((id) => build(id, 1));

  // ---- what could not be placed -------------------------------------------
  //
  // Content with no semantic id, or one that integrity dropped as unparseable.
  // Reported as a count rather than discarded, so the map's totals can be
  // reconciled against the schedule instead of quietly disagreeing with it.
  const unplacedItems = snapshot.items.filter((item) => item.semanticId === null).length;

  return {
    roots,
    totalStructures: views.length,
    totalItems: snapshot.items.length,
    unplacedItems,
  };
}

/**
 * A node's band.
 *
 * Uses the same thresholds as Gate 12's structure banding, applied to the
 * rolled-up figure. A node nobody has reviewed is `untouched` — not
 * `struggling`, which would tell a learner they are failing at something they
 * have never been shown.
 */
function bandFor(mastery: number, totals: Totals): MasteryBand {
  if (totals.reviews === 0) return 'untouched';
  if (mastery >= 0.8) return 'strong';
  if (mastery <= 0.5) return 'struggling';
  return 'developing';
}

/** Flatten a map for a list view, depth-first, preserving order. */
export function flattenMap(nodes: readonly KnowledgeMapNode[]): KnowledgeMapNode[] {
  const out: KnowledgeMapNode[] = [];
  const walk = (list: readonly KnowledgeMapNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
