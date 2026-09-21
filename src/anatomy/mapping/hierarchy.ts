import type { SemanticId } from '@/lib/semantic-id';
import {
  ANATOMY_REGION_LABELS,
  ANATOMY_SYSTEM_LABELS,
  anatomyRegionId,
  anatomySystemId,
  type AnatomyRegion,
  type AnatomySystem,
} from '../taxonomy';
import type { AnatomyManifest, ManifestObject } from './manifest';

/**
 * Hierarchy normalisation
 * =======================
 *
 * VEO's anatomical hierarchy is:
 *
 *     Body → System → Region → Structure → Substructure
 *
 * No provider ships exactly that. One nests by dissection order, another by
 * mesh grouping, a third gives a flat list with tags. The adapter's job is to
 * present the same shape to the learner whatever the source did.
 *
 * ## What this does and does not invent
 *
 * The grouping nodes this produces — "Cardiovascular", "Thorax" — are derived
 * entirely from tags the manifest already declares on real structures. Nothing
 * is added that the manifest did not say. They carry no geometry, no
 * description and no anatomical claim: they are navigation, not content.
 *
 * Crucially this builds a VIEW. It does not touch the object graph, so a
 * structure's real parent stays whatever the manifest said, and a manifest
 * that already declares its own grouping tree keeps it. Two hierarchies over
 * the same structures is the point: a learner navigating by system and a
 * learner navigating by containment are asking different questions.
 */

export interface HierarchyNode {
  readonly semanticId: SemanticId;
  readonly name: string;
  /** What this node is in the canonical hierarchy. */
  readonly level: 'body' | 'system' | 'region' | 'structure';
  /** True when the node exists only to group, with no geometry of its own. */
  readonly synthetic: boolean;
  readonly children: readonly HierarchyNode[];
  /** How many real structures sit beneath this node. */
  readonly structureCount: number;
}

/**
 * Build the canonical navigation tree for a manifest.
 *
 * Structures with no system tag are grouped under the body directly rather
 * than dropped, and structures with no region tag hang off their system. A
 * model that tags nothing produces a flat body → structures tree, which is the
 * honest rendering of a model that declares no grouping.
 */
export function normalizeHierarchy(manifest: AnatomyManifest): HierarchyNode {
  const childrenOf = new Map<string, ManifestObject[]>();
  for (const object of manifest.objects) {
    if (object.parentId === null) continue;
    const siblings = childrenOf.get(object.parentId) ?? [];
    siblings.push(object);
    childrenOf.set(object.parentId, siblings);
  }

  /** The structure subtree as the manifest actually declares it. */
  function structureNode(object: ManifestObject, depth = 0): HierarchyNode {
    // A malformed manifest is refused before this runs, but a depth bound
    // means a bug here degrades to a truncated tree rather than a hung tab.
    const children =
      depth > 64 ? [] : (childrenOf.get(object.semanticId) ?? []).map((child) => structureNode(child, depth + 1));

    return {
      semanticId: object.semanticId as SemanticId,
      name: object.name,
      level: 'structure',
      synthetic: false,
      children,
      structureCount: 1 + children.reduce((total, child) => total + child.structureCount, 0),
    };
  }

  /*
   * The structures to group are the model root's own children, plus anything
   * parentless that is not the root itself. The root becomes the body node —
   * nesting it beneath itself would put the whole model one level too deep.
   *
   * Only this top level is grouped. Grouping every structure would flatten the
   * containment tree the manifest declares, which is information a learner
   * needs: a chamber belongs inside a heart, not beside it.
   */
  const topLevel = manifest.objects.filter(
    (object) =>
      object.semanticId !== manifest.rootObjectId &&
      (object.parentId === null || object.parentId === manifest.rootObjectId),
  );

  const bySystem = new Map<AnatomySystem | null, Map<AnatomyRegion | null, ManifestObject[]>>();
  for (const object of topLevel) {
    const system = object.system as AnatomySystem | null;
    const region = object.region as AnatomyRegion | null;

    const regions = bySystem.get(system) ?? new Map<AnatomyRegion | null, ManifestObject[]>();
    const members = regions.get(region) ?? [];
    members.push(object);
    regions.set(region, members);
    bySystem.set(system, regions);
  }

  const systemNodes: HierarchyNode[] = [];
  for (const [system, regions] of bySystem) {
    const regionNodes: HierarchyNode[] = [];

    for (const [region, members] of regions) {
      const structures = members.map((object) => structureNode(object));

      if (region === null) {
        // No region declared: the structures belong to the system directly.
        regionNodes.push(...structures);
        continue;
      }

      regionNodes.push({
        semanticId: anatomyRegionId(region),
        name: ANATOMY_REGION_LABELS[region],
        level: 'region',
        synthetic: true,
        children: structures,
        structureCount: structures.reduce((total, child) => total + child.structureCount, 0),
      });
    }

    if (system === null) {
      systemNodes.push(...regionNodes);
      continue;
    }

    systemNodes.push({
      semanticId: anatomySystemId(system),
      name: ANATOMY_SYSTEM_LABELS[system],
      level: 'system',
      synthetic: true,
      children: regionNodes,
      structureCount: regionNodes.reduce((total, child) => total + child.structureCount, 0),
    });
  }

  return {
    semanticId: manifest.rootObjectId as SemanticId,
    name: manifest.name,
    level: 'body',
    synthetic: false,
    children: systemNodes,
    structureCount: systemNodes.reduce((total, child) => total + child.structureCount, 0),
  };
}

/** Depth-first walk, for flattening a tree into a list. */
export function walkHierarchy(node: HierarchyNode): readonly HierarchyNode[] {
  return [node, ...node.children.flatMap((child) => walkHierarchy(child))];
}

/** The systems a manifest's structures are actually tagged with. */
export function systemsPresent(manifest: AnatomyManifest): readonly AnatomySystem[] {
  const present = new Set<string>();
  for (const object of manifest.objects) {
    if (object.system) present.add(object.system);
  }
  return (Object.keys(ANATOMY_SYSTEM_LABELS) as AnatomySystem[]).filter((system) =>
    present.has(system),
  );
}

/** The regions a manifest's structures are actually tagged with. */
export function regionsPresent(manifest: AnatomyManifest): readonly AnatomyRegion[] {
  const present = new Set<string>();
  for (const object of manifest.objects) {
    if (object.region) present.add(object.region);
  }
  return (Object.keys(ANATOMY_REGION_LABELS) as AnatomyRegion[]).filter((region) =>
    present.has(region),
  );
}
