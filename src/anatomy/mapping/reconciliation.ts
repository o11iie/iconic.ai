import type { SemanticId } from '@/lib/semantic-id';
import type { AnatomyManifest } from './manifest';

/**
 * Asset ↔ manifest reconciliation
 * ===============================
 *
 * The check that runs when geometry actually arrives.
 *
 * `validate:anatomy` checks a manifest against an asset offline, before
 * anything is published. This is the same question asked at load time, against
 * the scene the renderer really received — which is not always the file the
 * author validated. A CDN serves a stale revision, a deploy ships the manifest
 * before the asset, a vendor re-exports and renames three meshes.
 *
 * ## What goes wrong without it
 *
 * A structure whose mesh is missing from the asset stays in the semantic graph
 * with a name, a parent, relationships and a context panel — and no geometry.
 * It can be searched for and navigated to, and it can never be seen or
 * selected. Nothing throws. The learner concludes the structure does not exist,
 * or worse, clicks a neighbouring structure and reads the missing one's label.
 *
 * So a load reports three separate facts, which mean different things:
 *
 *   * `missingMeshes` — the manifest promised geometry the asset does not have.
 *     The model is mislabelled. This is an ERROR.
 *   * `unmappedMeshes` — the asset contains geometry the manifest does not
 *     name. It renders but cannot be selected. Worth an author's attention,
 *     not a refusal: an asset legitimately carries scenery, helpers and
 *     armature nodes.
 *   * `versionMismatch` — the asset stamps a different revision from the one
 *     the manifest describes. Every mapping is then suspect.
 */

export interface AssetInventory {
  /** Every node and mesh name present in the loaded scene. */
  readonly names: ReadonlySet<string>;
  /** The version the asset stamps on itself, when it carries one. */
  readonly modelVersion: string | null;
}

export interface Reconciliation {
  /** Mapped by the manifest, absent from the asset. Mislabels the model. */
  readonly missingMeshes: readonly string[];
  /** Structures left with no geometry because of the above. */
  readonly unrenderableStructures: readonly SemanticId[];
  /** Present in the asset, named by no structure. Renders, unselectable. */
  readonly unmappedMeshes: readonly string[];
  /** Set when the asset and the manifest describe different revisions. */
  readonly versionMismatch: { readonly asset: string; readonly manifest: string } | null;
  /** True when the model can be trusted to teach from. */
  readonly ok: boolean;
}

/**
 * Compare what the manifest promised with what the asset delivered.
 *
 * Structures addressed only by `providerId` are not faulted here: a hosted
 * provider resolves those itself, and this function sees meshes.
 */
export function reconcile(
  manifest: AnatomyManifest,
  inventory: AssetInventory,
): Reconciliation {
  const missingMeshes: string[] = [];
  const unrenderableStructures: SemanticId[] = [];
  const mapped = new Set<string>();

  for (const object of manifest.objects) {
    if (object.meshes.length === 0) continue;

    let found = 0;
    for (const mesh of object.meshes) {
      mapped.add(mesh);
      if (inventory.names.has(mesh)) {
        found += 1;
      } else {
        missingMeshes.push(mesh);
      }
    }

    // A structure with SOME of its meshes still renders, partially. One with
    // none of them is a name attached to nothing.
    if (found === 0) unrenderableStructures.push(object.semanticId as SemanticId);
  }

  const unmappedMeshes: string[] = [];
  for (const name of inventory.names) {
    if (!mapped.has(name)) unmappedMeshes.push(name);
  }

  const versionMismatch =
    inventory.modelVersion !== null && inventory.modelVersion !== manifest.modelVersion
      ? { asset: inventory.modelVersion, manifest: manifest.modelVersion }
      : null;

  return {
    missingMeshes,
    unrenderableStructures,
    unmappedMeshes,
    versionMismatch,
    ok: missingMeshes.length === 0 && versionMismatch === null,
  };
}

/** A reader's summary of a failed reconciliation. Shown, not logged. */
export function describeReconciliation(result: Reconciliation): string | null {
  if (result.ok) return null;

  if (result.versionMismatch) {
    return `This model's geometry reports version ${result.versionMismatch.asset} but its semantic data describes version ${result.versionMismatch.manifest}. VEO will not label one revision's geometry with another's names.`;
  }

  const count = result.unrenderableStructures.length;
  return `This model's geometry is missing ${result.missingMeshes.length} part${
    result.missingMeshes.length === 1 ? '' : 's'
  } that its semantic data describes, leaving ${count} structure${
    count === 1 ? '' : 's'
  } unable to be shown or selected. VEO will not present an incomplete model as complete.`;
}
