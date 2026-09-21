import { isDescendantOf, type SemanticId } from '@/lib/semantic-id';
import { err, ok, type Result } from '@/lib/result';
import { ANATOMY_DOMAIN } from '../taxonomy';
import {
  manifestSchema,
  unknownRelationshipKinds,
  type AnatomyManifest,
} from './manifest';

/**
 * Manifest validation
 * ===================
 *
 * A manifest is authored by hand against a vendor asset, which means it will
 * be wrong sometimes. The question is whether it is wrong loudly or quietly.
 *
 * A quietly wrong manifest is the worst failure this system has. A structure
 * mapped to the wrong mesh renders perfectly, selects perfectly, and teaches a
 * learner something false — and nothing in the running application looks
 * broken. So every check here exists to convert a silent mislabelling into a
 * refusal to load.
 *
 * Severity matters:
 *   * an ERROR means the model cannot be trusted and is refused
 *   * a WARNING means the model loads but something is worth an author's
 *     attention — an unusual relationship kind, a structure with no citation
 *
 * Warnings never block. A model that is merely incomplete is still useful, and
 * refusing it would push authors towards inventing content to satisfy a
 * validator, which is the opposite of what this is for.
 */

export type ManifestIssueSeverity = 'error' | 'warning';

export interface ManifestIssue {
  readonly severity: ManifestIssueSeverity;
  /** A short, stable code so tooling can filter without parsing prose. */
  readonly code: string;
  readonly message: string;
  /** What the issue is about — a semantic id, a layer id, a path. */
  readonly subject: string | null;
}

export interface ManifestValidation {
  readonly manifest: AnatomyManifest;
  readonly errors: readonly ManifestIssue[];
  readonly warnings: readonly ManifestIssue[];
}

export interface ManifestValidationError {
  readonly message: string;
  readonly issues: readonly string[];
}

/** Facts about the asset, checked against what the manifest claims. */
export interface AssetFacts {
  /** The version the geometry itself reports, when it carries one. */
  readonly modelVersion?: string | null;
  /** Mesh names present in the asset, when they can be read. */
  readonly meshNames?: readonly string[];
}

function issue(
  severity: ManifestIssueSeverity,
  code: string,
  message: string,
  subject: string | null = null,
): ManifestIssue {
  return { severity, code, message, subject };
}

/**
 * Validate an untrusted manifest payload.
 *
 * Returns the full issue list so tooling can report everything at once; a
 * validator that stops at the first problem makes fixing a manifest a game of
 * whack-a-mole.
 */
export function validateManifest(input: unknown, asset: AssetFacts = {}): ManifestValidation | ManifestValidationError {
  const parsed = manifestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      message: 'Anatomy manifest failed schema validation.',
      issues: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }

  const manifest = parsed.data;
  const issues: ManifestIssue[] = [];

  const ids = new Set<string>();
  const duplicated = new Set<string>();
  for (const object of manifest.objects) {
    if (ids.has(object.semanticId)) duplicated.add(object.semanticId);
    ids.add(object.semanticId);
  }
  for (const id of duplicated) {
    issues.push(issue('error', 'duplicate_semantic_id', `Duplicate semanticId "${id}".`, id));
  }

  // ---- hierarchy ----------------------------------------------------------
  const parentOf = new Map<string, string | null>();
  for (const object of manifest.objects) parentOf.set(object.semanticId, object.parentId);

  for (const object of manifest.objects) {
    if (object.parentId !== null && !ids.has(object.parentId)) {
      issues.push(
        issue(
          'error',
          'orphaned_parent',
          `"${object.semanticId}" declares parent "${object.parentId}", which this manifest does not contain.`,
          object.semanticId,
        ),
      );
    }
  }

  for (const id of detectCycles(parentOf)) {
    issues.push(
      issue('error', 'circular_hierarchy', `"${id}" is its own ancestor.`, id),
    );
  }

  if (!ids.has(manifest.rootObjectId)) {
    issues.push(
      issue(
        'error',
        'missing_root',
        `rootObjectId "${manifest.rootObjectId}" is not present in objects.`,
        manifest.rootObjectId,
      ),
    );
  }

  // ---- identity -----------------------------------------------------------
  for (const object of manifest.objects) {
    if (!object.semanticId.startsWith(`veo.${manifest.domain}.`)) {
      issues.push(
        issue(
          'error',
          'foreign_namespace',
          `"${object.semanticId}" is outside this manifest's domain "${manifest.domain}".`,
          object.semanticId,
        ),
      );
    }

    /*
     * A structure with neither a mesh nor a provider id has no geometry to
     * bind to. Grouping nodes legitimately have neither — they are declared
     * structure, not drawn structure — so only a leaf is faulted.
     */
    const hasChildren = manifest.objects.some((other) => other.parentId === object.semanticId);
    if (!hasChildren && object.meshes.length === 0 && object.providerId === null) {
      issues.push(
        issue(
          'error',
          'unresolvable_geometry',
          `"${object.semanticId}" is a leaf but declares neither a mesh nor a providerId, so nothing can render or select it.`,
          object.semanticId,
        ),
      );
    }
  }

  // A mesh mapped to two structures makes selection ambiguous.
  const meshOwners = new Map<string, string[]>();
  for (const object of manifest.objects) {
    for (const mesh of object.meshes) {
      const owners = meshOwners.get(mesh) ?? [];
      owners.push(object.semanticId);
      meshOwners.set(mesh, owners);
    }
  }
  for (const [mesh, owners] of meshOwners) {
    if (owners.length > 1) {
      issues.push(
        issue(
          'error',
          'ambiguous_mesh',
          `Mesh "${mesh}" is claimed by ${owners.length} structures: ${owners.join(', ')}.`,
          mesh,
        ),
      );
    }
  }

  const providerOwners = new Map<string, string[]>();
  for (const object of manifest.objects) {
    if (!object.providerId) continue;
    const owners = providerOwners.get(object.providerId) ?? [];
    owners.push(object.semanticId);
    providerOwners.set(object.providerId, owners);
  }
  for (const [providerId, owners] of providerOwners) {
    if (owners.length > 1) {
      issues.push(
        issue(
          'error',
          'ambiguous_provider_id',
          `providerId "${providerId}" is claimed by ${owners.length} structures: ${owners.join(', ')}.`,
          providerId,
        ),
      );
    }
  }

  // ---- references between collections -------------------------------------
  const layerIds = new Set(manifest.layers.map((layer) => layer.id));
  for (const object of manifest.objects) {
    for (const layer of object.layers) {
      if (!layerIds.has(layer)) {
        issues.push(
          issue(
            'error',
            'unresolved_layer',
            `"${object.semanticId}" belongs to layer "${layer}", which this manifest does not declare.`,
            object.semanticId,
          ),
        );
      }
    }
  }

  for (const relationship of manifest.relationships) {
    if (!ids.has(relationship.source)) {
      issues.push(
        issue(
          'error',
          'unresolved_relationship',
          `Relationship source "${relationship.source}" is not a structure in this manifest.`,
          relationship.source,
        ),
      );
    }
    if (!ids.has(relationship.target)) {
      issues.push(
        issue(
          'error',
          'unresolved_relationship',
          `Relationship target "${relationship.target}" is not a structure in this manifest.`,
          relationship.target,
        ),
      );
    }
  }

  for (const region of manifest.regions) {
    for (const objectId of region.objectIds) {
      if (!ids.has(objectId)) {
        issues.push(
          issue(
            'error',
            'unresolved_region_member',
            `Region "${region.id}" lists "${objectId}", which this manifest does not contain.`,
            region.id,
          ),
        );
      }
    }
  }

  for (const group of manifest.explosion) {
    for (const objectId of group.objectIds) {
      if (!ids.has(objectId)) {
        issues.push(
          issue(
            'error',
            'unresolved_explosion_member',
            `Exploded group "${group.id}" lists "${objectId}", which this manifest does not contain.`,
            group.id,
          ),
        );
      }
    }
  }

  // ---- declared systems and regions must be real --------------------------
  const systemsPresent = new Set<string>();
  for (const object of manifest.objects) {
    if (object.system !== null) systemsPresent.add(object.system);
  }
  for (const system of manifest.systems) {
    if (!systemsPresent.has(system.id)) {
      issues.push(
        issue(
          'error',
          'empty_declared_system',
          `System "${system.id}" is declared but no structure is tagged with it.`,
          system.id,
        ),
      );
    }
  }

  const regionsPresent = new Set<string>();
  for (const object of manifest.objects) {
    if (object.region !== null) regionsPresent.add(object.region);
  }
  for (const region of manifest.regions) {
    if (!regionsPresent.has(region.id) && region.objectIds.length === 0) {
      issues.push(
        issue(
          'error',
          'empty_declared_region',
          `Region "${region.id}" is declared but contains no structures.`,
          region.id,
        ),
      );
    }
  }

  // ---- capability consistency ---------------------------------------------
  issues.push(...capabilityIssues(manifest));

  // ---- version agreement --------------------------------------------------
  if (
    asset.modelVersion !== undefined &&
    asset.modelVersion !== null &&
    asset.modelVersion !== manifest.modelVersion
  ) {
    issues.push(
      issue(
        'error',
        'version_mismatch',
        `The asset reports model version "${asset.modelVersion}" but the manifest describes "${manifest.modelVersion}". Semantic data from one revision must never be applied to geometry from another.`,
        manifest.modelId,
      ),
    );
  }

  if (asset.meshNames && asset.meshNames.length > 0) {
    const present = new Set(asset.meshNames);
    for (const [mesh, owners] of meshOwners) {
      if (!present.has(mesh)) {
        issues.push(
          issue(
            'error',
            'missing_mesh',
            `Mesh "${mesh}" is mapped by ${owners[0]} but is not present in the asset.`,
            mesh,
          ),
        );
      }
    }
  }

  // ---- warnings -----------------------------------------------------------
  for (const kind of unknownRelationshipKinds(manifest)) {
    issues.push(
      issue(
        'warning',
        'unknown_relationship_kind',
        `Relationship kind "${kind}" is outside VEO's vocabulary. It will still load; add it to the taxonomy if it is meant to be first-class.`,
        kind,
      ),
    );
  }

  for (const object of manifest.objects) {
    if ((object.description || object.function) && object.references.length === 0) {
      issues.push(
        issue(
          'warning',
          'unsourced_claim',
          `"${object.semanticId}" carries descriptive content with no reference. Anatomical claims should cite their source.`,
          object.semanticId,
        ),
      );
    }
  }

  if (manifest.domain === ANATOMY_DOMAIN && manifest.systems.length === 0) {
    issues.push(
      issue(
        'warning',
        'no_declared_systems',
        'No systems are declared. The system filter will be derived from structure tags instead.',
      ),
    );
  }

  return {
    manifest,
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}

/**
 * Capabilities a manifest may not claim.
 *
 * Gate 7's rule, enforced at the source: a manifest can only ever switch
 * something off. Here that means a `true` for something the data cannot
 * support is an error rather than a silently ignored field, because an author
 * who wrote it believed it would do something.
 */
function capabilityIssues(manifest: AnatomyManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const declared = manifest.capabilities;

  const peelable = manifest.layers.filter((layer) => layer.peelable).length;
  const hasExplosion =
    manifest.explosion.length > 0 ||
    manifest.objects.some(
      (object) => object.explodedOffset !== null && object.explodedOffset.some((v) => v !== 0),
    );

  const impossible: readonly [keyof typeof declared, boolean, string][] = [
    ['supportsLayers', manifest.layers.length > 0, 'the manifest declares no layers'],
    ['supportsPeeling', peelable >= 2, 'fewer than two peelable layers are declared'],
    ['supportsExplosion', hasExplosion, 'no exploded offsets or groups are declared'],
    [
      'supportsRelationships',
      manifest.relationships.length > 0,
      'the manifest declares no relationships',
    ],
    ['supportsIsolation', manifest.objects.length > 1, 'the manifest declares a single structure'],
    ['supportsDissection', manifest.objects.length > 1, 'the manifest declares a single structure'],
  ];

  for (const [key, possible, why] of impossible) {
    if (declared[key] === true && !possible) {
      issues.push(
        issue(
          'error',
          'unsupported_capability_claim',
          `Manifest claims ${key} but ${why}. A manifest may switch a capability off, never on.`,
          key,
        ),
      );
    }
  }

  return issues;
}

/** Semantic ids that are their own ancestor. */
function detectCycles(parentOf: ReadonlyMap<string, string | null>): readonly string[] {
  const cyclic: string[] = [];

  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start]);
    let current = parentOf.get(start) ?? null;
    let depth = 0;

    while (current !== null && depth < parentOf.size + 1) {
      if (seen.has(current)) {
        cyclic.push(start);
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
      depth += 1;
    }
  }

  return cyclic;
}

/**
 * Load-time entry point.
 *
 * Errors refuse the model; warnings are returned for reporting but never
 * block. Keeps the shape the provider already expects.
 */
export function parseManifest(
  input: unknown,
  asset: AssetFacts = {},
): Result<AnatomyManifest, ManifestValidationError> {
  const result = validateManifest(input, asset);

  if ('issues' in result) return err(result);

  if (result.errors.length > 0) {
    return err({
      message: 'Anatomy manifest is internally inconsistent.',
      issues: result.errors.map((i) => `${i.code}: ${i.message}`),
    });
  }

  return ok(result.manifest);
}

/** True when `candidate` sits beneath `ancestor` by semantic path. */
export function isBeneath(candidate: SemanticId, ancestor: SemanticId): boolean {
  return isDescendantOf(candidate, ancestor);
}
