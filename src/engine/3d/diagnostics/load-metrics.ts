/**
 * Load instrumentation.
 *
 * What a real asset will be measured with, built before one arrives so the
 * numbers are available the moment it does rather than reconstructed
 * afterwards from impressions.
 *
 * Measures the two things a learner actually feels:
 *
 *   * how long until something is on screen
 *   * how long until they can do something with it
 *
 * and the counts that explain a bad answer to either: geometry, meshes,
 * textures, draw calls, and how much of the model is addressable. A model that
 * loads slowly because it has 400 000 triangles needs a different fix from one
 * that loads slowly because it ships 40 uncompressed textures, and without the
 * counts both look the same.
 *
 * Deliberately not a performance budget. Numbers are recorded, not enforced:
 * the right threshold depends on an asset nobody has seen yet, and a limit
 * guessed now would either never fire or fire on everything.
 */

export interface LoadMetrics {
  readonly modelRef: string;
  /** Request issued to the manifest resolving. */
  readonly manifestMs: number | null;
  /** Manifest resolved to geometry parsed and on screen. */
  readonly geometryMs: number | null;
  /** Request issued to the learner being able to select something. */
  readonly interactiveMs: number | null;
  readonly geometries: number | null;
  readonly meshes: number | null;
  readonly textures: number | null;
  readonly drawCalls: number | null;
  /** Structures the model declares. */
  readonly structures: number | null;
  /** Structures actually backed by geometry, which is what can be selected. */
  readonly addressable: number | null;
}

type Phase = 'start' | 'manifest' | 'geometry' | 'interactive';

/**
 * Records one model load.
 *
 * Phases are stamped as they happen rather than computed at the end, because
 * a load that fails half way is exactly the one worth measuring and there is
 * no end to compute from.
 */
export class LoadMetricsRecorder {
  private readonly marks = new Map<Phase, number>();
  private counts: Partial<LoadMetrics> = {};

  constructor(
    readonly modelRef: string,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.marks.set('start', this.now());
  }

  mark(phase: Exclude<Phase, 'start'>): void {
    if (this.marks.has(phase)) return;
    this.marks.set(phase, this.now());
  }

  record(counts: Partial<LoadMetrics>): void {
    this.counts = { ...this.counts, ...counts };
  }

  private since(phase: Phase, from: Phase = 'start'): number | null {
    const end = this.marks.get(phase);
    const begin = this.marks.get(from);
    if (end === undefined || begin === undefined) return null;
    return Math.round(end - begin);
  }

  snapshot(): LoadMetrics {
    return {
      modelRef: this.modelRef,
      manifestMs: this.since('manifest'),
      geometryMs: this.since('geometry', 'manifest'),
      interactiveMs: this.since('interactive'),
      geometries: this.counts.geometries ?? null,
      meshes: this.counts.meshes ?? null,
      textures: this.counts.textures ?? null,
      drawCalls: this.counts.drawCalls ?? null,
      structures: this.counts.structures ?? null,
      addressable: this.counts.addressable ?? null,
    };
  }
}

/** One line, for a log or a report. */
export function formatLoadMetrics(metrics: LoadMetrics): string {
  const ms = (value: number | null) => (value === null ? '—' : `${value}ms`);
  const n = (value: number | null) => (value === null ? '—' : String(value));

  return [
    `model ${metrics.modelRef}`,
    `manifest ${ms(metrics.manifestMs)}`,
    `geometry ${ms(metrics.geometryMs)}`,
    `interactive ${ms(metrics.interactiveMs)}`,
    `geometries ${n(metrics.geometries)}`,
    `meshes ${n(metrics.meshes)}`,
    `textures ${n(metrics.textures)}`,
    `draws ${n(metrics.drawCalls)}`,
    `structures ${n(metrics.addressable)}/${n(metrics.structures)} addressable`,
  ].join(' · ');
}
