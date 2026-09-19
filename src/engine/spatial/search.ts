import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { SpatialObject } from '@/types/domain/spatial';

/**
 * Spatial search
 * ==============
 *
 * A local, indexed search over the loaded model's semantic objects.
 *
 * Searches name, semantic id, system, region, synonyms and string metadata,
 * and every result resolves back to a semantic object — so selecting a result
 * drives exactly the same pipeline a click does. There is no separate
 * "search selection" path.
 *
 * Domain-agnostic: it indexes whatever fields the model supplies and has no
 * knowledge of anatomy or any other subject. Deliberately local and in-memory;
 * a served index is a later problem and would not change this interface.
 */

export const MATCH_FIELDS = ['name', 'semanticId', 'system', 'region', 'synonym', 'metadata'] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

export interface SearchResult {
  readonly semanticId: SemanticId;
  readonly name: string;
  /** Higher is a better match. */
  readonly score: number;
  /** Which field produced the best match, for explaining the result. */
  readonly matchedOn: MatchField;
  readonly system: string | null;
  readonly region: string | null;
}

interface IndexEntry {
  readonly semanticId: SemanticId;
  readonly name: string;
  readonly system: string | null;
  readonly region: string | null;
  /** Lowercased haystacks, one per field, built once at index time. */
  readonly fields: readonly { readonly field: MatchField; readonly text: string; readonly weight: number }[];
}

/**
 * Field weights.
 *
 * A name match is what a learner almost always means. Semantic id is next,
 * because typing an id is deliberate. Metadata is last: it is the widest net
 * and the least specific.
 */
const FIELD_WEIGHT: Record<MatchField, number> = {
  name: 100,
  semanticId: 70,
  synonym: 60,
  system: 35,
  region: 35,
  metadata: 20,
};

export class SpatialSearchIndex {
  private entries: IndexEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  /** Rebuild from the current model. Cheap enough to redo on every load. */
  build(objects: Iterable<SpatialObject>): void {
    const entries: IndexEntry[] = [];

    for (const object of objects) {
      const fields: IndexEntry['fields'] = [
        { field: 'name', text: object.name.toLowerCase(), weight: FIELD_WEIGHT.name },
        { field: 'semanticId', text: object.semanticId.toLowerCase(), weight: FIELD_WEIGHT.semanticId },
        ...object.synonyms.map((synonym) => ({
          field: 'synonym' as const,
          text: synonym.toLowerCase(),
          weight: FIELD_WEIGHT.synonym,
        })),
        ...(object.system
          ? [{ field: 'system' as const, text: object.system.toLowerCase(), weight: FIELD_WEIGHT.system }]
          : []),
        ...(object.region
          ? [{ field: 'region' as const, text: object.region.toLowerCase(), weight: FIELD_WEIGHT.region }]
          : []),
        ...metadataStrings(object.metadata).map((text) => ({
          field: 'metadata' as const,
          text,
          weight: FIELD_WEIGHT.metadata,
        })),
      ];

      entries.push({
        semanticId: object.semanticId,
        name: object.name,
        system: object.system,
        region: object.region,
        fields,
      });
    }

    this.entries = entries;
  }

  clear(): void {
    this.entries = [];
  }

  /**
   * Search the index.
   *
   * Scoring is intentionally simple and explainable: an exact field match
   * beats a prefix match, which beats a substring match, scaled by field
   * weight. Nothing fuzzy — a learner searching "aorta" and getting "aortic
   * valve" first would be worse than getting nothing.
   */
  search(query: string, limit = 12): SearchResult[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const results: SearchResult[] = [];

    for (const entry of this.entries) {
      let best = 0;
      let bestField: MatchField = 'name';

      for (const field of entry.fields) {
        const score = scoreMatch(field.text, needle) * field.weight;
        if (score > best) {
          best = score;
          bestField = field.field;
        }
      }

      if (best > 0) {
        results.push({
          semanticId: entry.semanticId,
          name: entry.name,
          score: best,
          matchedOn: bestField,
          system: entry.system,
          region: entry.region,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
}

/** 1.0 exact, 0.7 prefix, 0.4 substring, 0 otherwise. */
function scoreMatch(haystack: string, needle: string): number {
  if (haystack === needle) return 1;
  if (haystack.startsWith(needle)) return 0.7;
  if (haystack.includes(needle)) return 0.4;

  // A word-boundary match inside a multi-word name is worth more than a
  // mid-word substring: "ventricle" should find "Left ventricle" strongly.
  if (haystack.split(/[\s._-]+/).some((word) => word.startsWith(needle))) return 0.55;

  return 0;
}

/** Flatten string-valued metadata for indexing. Ignores nested structures. */
function metadataStrings(metadata: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];

  for (const value of Object.values(metadata)) {
    if (typeof value === 'string' && value.length > 0) {
      out.push(value.toLowerCase());
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.length > 0) out.push(item.toLowerCase());
      }
    }
  }

  return out;
}

/** Readable label for a result that has no descriptor name. */
export function resultLabel(result: SearchResult): string {
  return result.name || semanticIdToLabel(result.semanticId);
}
