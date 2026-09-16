import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MaterialStateManager } from './materials/material-state';
import { countResources, disposeObject3D } from './disposal';
import {
  resolveClippingPlanes,
  resolveDevicePixelRatio,
  shouldAntialias,
  TONE_MAPPING_POLICY,
} from './renderer/renderer-config';
import { isClick, modeAllowsHover, modeAllowsSelection, nextSelection, resolveHit } from './interaction/pointer';
import { boundsOf, boundsOfAll, centerOf } from './bounds';
import {
  DIAGNOSTIC_DOMAIN,
  DIAGNOSTIC_LABEL,
  DIAGNOSTIC_NODES,
  buildDiagnosticScene,
} from './diagnostics/diagnostic-scene';
import { readTag } from '@/engine/spatial/object-registry';
import { parseSemanticId, type SemanticId } from '@/lib/semantic-id';
import { isKnownKnowledgeDomain } from '@/types/domain/primitives';

function texturedMesh(): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ color: 0x336699 });
  material.map = new THREE.Texture();
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
}

describe('MaterialStateManager', () => {
  it('never mutates the authored material', () => {
    const mesh = texturedMesh();
    const original = mesh.material as THREE.MeshStandardMaterial;
    const originalColor = original.color.getHex();

    const manager = new MaterialStateManager();
    manager.apply(mesh, 'selected');
    manager.apply(mesh, 'ghosted');

    expect(original.color.getHex()).toBe(originalColor);
    expect(original.opacity).toBe(1);
    expect(original.transparent).toBe(false);
  });

  it('allocates at most ONE override per mesh across many state changes', () => {
    // The defect this prevents: cloning a material on every hover, so a minute
    // of pointer movement leaves hundreds of orphaned GPU resources behind.
    const mesh = texturedMesh();
    const manager = new MaterialStateManager();

    for (let i = 0; i < 50; i += 1) {
      manager.apply(mesh, 'hovered');
      manager.apply(mesh, 'default');
      manager.apply(mesh, 'selected');
      manager.apply(mesh, 'ghosted');
    }

    expect(manager.overrideCount).toBe(1);
    expect(manager.trackedCount).toBe(1);
  });

  it('restores the authored material by reference', () => {
    const mesh = texturedMesh();
    const original = mesh.material;
    const manager = new MaterialStateManager();

    manager.apply(mesh, 'selected');
    expect(mesh.material).not.toBe(original);

    manager.apply(mesh, 'default');
    expect(mesh.material).toBe(original);
  });

  it('reports whether a change actually happened, so idle frames stay idle', () => {
    const mesh = texturedMesh();
    const manager = new MaterialStateManager();

    expect(manager.apply(mesh, 'selected')).toBe(true);
    expect(manager.apply(mesh, 'selected')).toBe(false);
  });

  it('drives mesh visibility from the hidden state', () => {
    const mesh = texturedMesh();
    const manager = new MaterialStateManager();

    manager.apply(mesh, 'hidden');
    expect(mesh.visible).toBe(false);

    manager.apply(mesh, 'default');
    expect(mesh.visible).toBe(true);
  });

  it('restoreAll returns every tracked mesh to default', () => {
    const a = texturedMesh();
    const b = texturedMesh();
    const originalA = a.material;
    const manager = new MaterialStateManager();

    manager.apply(a, 'selected');
    manager.apply(b, 'ghosted');
    manager.restoreAll();

    expect(a.material).toBe(originalA);
    expect(manager.stateOf(a)).toBe('default');
    expect(manager.stateOf(b)).toBe('default');
  });

  it('disposes its overrides and leaves the authored materials alone', () => {
    const mesh = texturedMesh();
    const original = mesh.material as THREE.MeshStandardMaterial;
    let originalDisposed = false;
    original.addEventListener('dispose', () => {
      originalDisposed = true;
    });

    const manager = new MaterialStateManager();
    manager.apply(mesh, 'selected');
    manager.dispose();

    expect(manager.overrideCount).toBe(0);
    expect(manager.trackedCount).toBe(0);
    // The asset's own material belongs to the scene's disposal pass, not ours:
    // disposing it here would break a material shared with another mesh.
    expect(originalDisposed).toBe(false);
  });
});

describe('disposal', () => {
  it('frees geometries, materials and textures beneath a root', () => {
    const root = new THREE.Group();
    root.add(texturedMesh(), texturedMesh());

    expect(countResources(root)).toEqual({ geometries: 2, materials: 2, textures: 0 });

    const report = disposeObject3D(root);

    expect(report.geometries).toBe(2);
    expect(report.materials).toBe(2);
    expect(report.textures).toBe(2);
  });

  it('disposes a shared material exactly once', () => {
    const shared = new THREE.MeshStandardMaterial();
    let disposeCount = 0;
    shared.addEventListener('dispose', () => {
      disposeCount += 1;
    });

    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), shared),
      new THREE.Mesh(new THREE.BoxGeometry(), shared),
    );

    disposeObject3D(root);
    expect(disposeCount).toBe(1);
  });

  it('detaches the root and empties it, so nothing stale remains mounted', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.add(texturedMesh());
    scene.add(root);

    disposeObject3D(root);

    expect(scene.children).not.toContain(root);
    expect(root.children).toHaveLength(0);
  });

  it('is safe to call twice and on null', () => {
    const root = new THREE.Group();
    root.add(texturedMesh());

    expect(() => {
      disposeObject3D(root);
      disposeObject3D(root);
      disposeObject3D(null);
    }).not.toThrow();
  });

  it('leaves nothing behind after repeated model replacement', () => {
    // Model replacement is where leaks actually happen; this asserts the
    // count returns to zero every cycle rather than accumulating.
    const scene = new THREE.Scene();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const model = new THREE.Group();
      model.add(texturedMesh(), texturedMesh());
      scene.add(model);
      expect(countResources(scene).geometries).toBe(2);

      disposeObject3D(model);
      expect(countResources(scene).geometries).toBe(0);
      expect(scene.children).toHaveLength(0);
    }
  });
});

describe('renderer policy', () => {
  it('caps device pixel ratio, because fill rate scales with its square', () => {
    expect(resolveDevicePixelRatio(3)).toBe(2);
    expect(resolveDevicePixelRatio(1.5)).toBe(1.5);
    expect(resolveDevicePixelRatio(1)).toBe(1);
  });

  it('caps harder on low-power devices, where a context loss is the failure mode', () => {
    expect(resolveDevicePixelRatio(3, { lowPower: true })).toBe(1.5);
  });

  it('never returns a nonsensical ratio', () => {
    expect(resolveDevicePixelRatio(0)).toBe(1);
    expect(resolveDevicePixelRatio(Number.NaN)).toBe(1);
    expect(resolveDevicePixelRatio(-2)).toBe(1);
  });

  it('drops antialiasing once resolution does the same job', () => {
    expect(shouldAntialias(1)).toBe(true);
    expect(shouldAntialias(1.5)).toBe(true);
    expect(shouldAntialias(2)).toBe(false);
  });

  it('uses neutral tone mapping at exposure 1, so colour is not editorialised', () => {
    expect(TONE_MAPPING_POLICY.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(TONE_MAPPING_POLICY.toneMappingExposure).toBe(1);
    expect(TONE_MAPPING_POLICY.outputColorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('derives clipping planes from model size to protect depth precision', () => {
    const small = resolveClippingPlanes(0.01);
    const large = resolveClippingPlanes(1000);

    expect(small.near).toBeLessThan(large.near);
    expect(large.far).toBeGreaterThan(small.far);
    expect(resolveClippingPlanes(0).near).toBeGreaterThan(0);
    expect(Number.isFinite(resolveClippingPlanes(Number.NaN).far)).toBe(true);
  });
});

describe('pointer rules', () => {
  it('treats a small movement as a click and a drag as not', () => {
    const origin = { x: 100, y: 100, time: 0 };

    expect(isClick(origin, { x: 102, y: 101 })).toBe(true);
    expect(isClick(origin, { x: 140, y: 100 })).toBe(false);
    expect(isClick(null, { x: 100, y: 100 })).toBe(false);
  });

  it('suppresses selection and hover in orbit mode', () => {
    // Orbiting must not change what is selected just because the drag ended
    // over a structure.
    expect(modeAllowsSelection('inspect')).toBe(true);
    expect(modeAllowsSelection('orbit')).toBe(false);
    expect(modeAllowsHover('orbit')).toBe(false);
  });

  it('resolves a hit only to identities the registry knows', () => {
    const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
    const node = { name: 'LV', parent: null, children: [], userData: { veoSemanticId: lv } };

    expect(resolveHit(node, (id) => id === lv)).toBe(lv);
    expect(resolveHit(node, () => false)).toBeNull();
  });

  it('clears selection on a miss rather than leaving a stale highlight', () => {
    const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
    expect(nextSelection(lv, null)).toBeNull();
    expect(nextSelection(null, lv)).toBe(lv);
    // Re-clicking the selection keeps it, so a double click does not deselect.
    expect(nextSelection(lv, lv)).toBe(lv);
  });
});

describe('bounds', () => {
  it('computes world bounds from real geometry', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.position.set(5, 0, 0);

    const box = boundsOf(mesh);
    expect(box).not.toBeNull();
    expect(centerOf(box!)[0]).toBeCloseTo(5, 5);
  });

  it('returns null for an empty object rather than a box at the origin', () => {
    expect(boundsOf(new THREE.Group())).toBeNull();
    expect(boundsOf(null)).toBeNull();
  });

  it('unions bounds across several objects', () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    a.position.set(-3, 0, 0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    b.position.set(3, 0, 0);

    const box = boundsOfAll([a, b]);
    expect(box!.min[0]).toBeCloseTo(-3.5, 5);
    expect(box!.max[0]).toBeCloseTo(3.5, 5);
  });
});

describe('diagnostic scene', () => {
  it('is labelled as an engine test, never as subject content', () => {
    expect(DIAGNOSTIC_LABEL).toBe('VEO SPATIAL ENGINE TEST');
    expect(buildDiagnosticScene().name).toBe(DIAGNOSTIC_LABEL);
  });

  it('uses a reserved namespace that is NOT a knowledge domain', () => {
    // This is what stops diagnostic geometry ever being reachable from the
    // learning catalogue, or mistaken for a subject model.
    expect(isKnownKnowledgeDomain(DIAGNOSTIC_DOMAIN)).toBe(false);

    for (const spec of DIAGNOSTIC_NODES) {
      const parsed = parseSemanticId(spec.semanticId);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.value.domain).toBe('diagnostic');
      expect(isKnownKnowledgeDomain(parsed.value.domain)).toBe(false);
    }
  });

  it('carries no anatomical or subject naming', () => {
    const text = JSON.stringify(DIAGNOSTIC_NODES).toLowerCase();
    for (const word of ['heart', 'bone', 'muscle', 'organ', 'anatomy', 'ventricle', 'skull']) {
      expect(text).not.toContain(word);
    }
    expect(DIAGNOSTIC_NODES.every((spec) => /^Node [A-Z]$/.test(spec.label))).toBe(true);
  });

  it('tags every selectable node so the registry can resolve it', () => {
    const root = buildDiagnosticScene();
    const meshes: THREE.Mesh[] = [];
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
    });

    expect(meshes).toHaveLength(DIAGNOSTIC_NODES.length);
    for (const mesh of meshes) {
      expect(readTag(mesh as never)).toMatch(/^veo\.diagnostic\./);
    }
  });

  it('produces geometry with real bounds, so fitting is verifiable', () => {
    const box = boundsOf(buildDiagnosticScene());
    expect(box).not.toBeNull();
    expect(box!.max[0] - box!.min[0]).toBeGreaterThan(1);
  });

  it('disposes completely, like any loaded model', () => {
    const root = buildDiagnosticScene();
    const report = disposeObject3D(root);

    expect(report.geometries).toBeGreaterThanOrEqual(DIAGNOSTIC_NODES.length);
    expect(report.materials).toBeGreaterThanOrEqual(DIAGNOSTIC_NODES.length);
  });
});
