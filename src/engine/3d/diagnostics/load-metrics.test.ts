import { describe, expect, it } from 'vitest';
import { LoadMetricsRecorder, formatLoadMetrics } from './load-metrics';

/** A controllable clock: real timings would make these tests measure nothing. */
function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('load metrics', () => {
  it('measures each phase against the right baseline', () => {
    const time = clock();
    const recorder = new LoadMetricsRecorder('heart', time.now);

    time.advance(120);
    recorder.mark('manifest');
    time.advance(880);
    recorder.mark('geometry');
    time.advance(40);
    recorder.mark('interactive');

    const metrics = recorder.snapshot();

    expect(metrics.manifestMs).toBe(120);
    // Geometry is measured from the manifest, not from the start: a slow
    // manifest and a slow parse need different fixes.
    expect(metrics.geometryMs).toBe(880);
    // Interactive is measured from the start, because that is what a learner
    // waited through.
    expect(metrics.interactiveMs).toBe(1040);
  });

  it('reports a load that never finished, rather than nothing', () => {
    const time = clock();
    const recorder = new LoadMetricsRecorder('skull', time.now);

    time.advance(200);
    recorder.mark('manifest');

    const metrics = recorder.snapshot();

    expect(metrics.manifestMs).toBe(200);
    expect(metrics.geometryMs).toBeNull();
    expect(metrics.interactiveMs).toBeNull();
  });

  it('ignores a repeated mark, so a re-render cannot rewrite history', () => {
    const time = clock();
    const recorder = new LoadMetricsRecorder('brain', time.now);

    time.advance(100);
    recorder.mark('manifest');
    time.advance(500);
    recorder.mark('manifest');

    expect(recorder.snapshot().manifestMs).toBe(100);
  });

  it('carries the counts that explain a slow load', () => {
    const recorder = new LoadMetricsRecorder('thorax', clock().now);
    recorder.record({ geometries: 412, meshes: 380, textures: 24, drawCalls: 390 });
    recorder.record({ structures: 500, addressable: 380 });

    const metrics = recorder.snapshot();

    expect(metrics.geometries).toBe(412);
    expect(metrics.textures).toBe(24);
    // Structures declared but not addressable are the ones a learner cannot
    // select, which is the number worth noticing.
    expect(metrics.structures).toBe(500);
    expect(metrics.addressable).toBe(380);
  });

  it('formats a line that is readable without the type in front of you', () => {
    const recorder = new LoadMetricsRecorder('heart', clock().now);
    recorder.record({ geometries: 10, structures: 12, addressable: 10 });

    const line = formatLoadMetrics(recorder.snapshot());

    expect(line).toContain('model heart');
    expect(line).toContain('geometries 10');
    expect(line).toContain('10/12 addressable');
    // An unmeasured value reads as absent, never as zero.
    expect(line).toContain('manifest —');
  });
});
