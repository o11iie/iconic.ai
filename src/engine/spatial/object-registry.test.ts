import { describe, expect, it } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import {
  SpatialObjectRegistry,
  buildRegistryFromMapping,
  collectMeshes,
  readTag,
  resolveSelectable,
  tagNode,
  type SceneNode,
} from './object-registry';

/** Minimal scene node, so registry rules are tested without a WebGL context. */
function node(name: string, options: { isMesh?: boolean } = {}): SceneNode {
  return {
    name,
    parent: null,
    children: [],
    userData: {},
    ...(options.isMesh === undefined ? {} : { isMesh: options.isMesh }),
  };
}

function attach(parent: SceneNode, child: SceneNode): SceneNode {
  (parent.children as SceneNode[]).push(child);
  child.parent = parent;
  return child;
}

const heart = 'veo.anatomy.heart' as SemanticId;
const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;

describe('resolveSelectable', () => {
  it('returns the identity on the hit node itself', () => {
    const mesh = node('Heart_LV_001', { isMesh: true });
    tagNode(mesh, lv);
    expect(resolveSelectable(mesh)).toBe(lv);
  });

  it('walks up to the nearest tagged ancestor', () => {
    const group = node('HeartGroup');
    tagNode(group, heart);
    const untagged = attach(group, node('Wrapper'));
    const mesh = attach(untagged, node('Mesh', { isMesh: true }));

    expect(resolveSelectable(mesh)).toBe(heart);
  });

  it('prefers the nearest tag, so a child wins over its group', () => {
    // This is the rule that stops every click selecting the whole model.
    const group = node('HeartGroup');
    tagNode(group, heart);
    const mesh = attach(group, node('LV', { isMesh: true }));
    tagNode(mesh, lv);

    expect(resolveSelectable(mesh)).toBe(lv);
  });

  it('returns null when nothing on the path is selectable', () => {
    const group = node('Untagged');
    const mesh = attach(group, node('Mesh', { isMesh: true }));
    expect(resolveSelectable(mesh)).toBeNull();
    expect(resolveSelectable(null)).toBeNull();
  });

  it('terminates on a cyclic graph rather than hanging', () => {
    const a = node('A');
    const b = node('B');
    a.parent = b;
    b.parent = a;
    expect(resolveSelectable(a)).toBeNull();
  });
});

describe('SpatialObjectRegistry', () => {
  it('registers and resolves a structure', () => {
    const registry = new SpatialObjectRegistry();
    const mesh = node('LV', { isMesh: true });

    expect(registry.register(lv, mesh)).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.has(lv)).toBe(true);
    expect(registry.get(lv)?.node).toBe(mesh);
    expect(registry.resolve(mesh)).toBe(lv);
  });

  it('rejects a malformed semantic id instead of storing something unreachable', () => {
    const registry = new SpatialObjectRegistry();
    expect(registry.register('Heart_LV_001' as SemanticId, node('x'))).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('does not resolve a stale tag from a previous model', () => {
    // A node still carrying an id the registry no longer knows must not
    // resolve, or a model swap leaves phantom selectable geometry.
    const registry = new SpatialObjectRegistry();
    const orphan = node('Old', { isMesh: true });
    tagNode(orphan, lv);

    expect(resolveSelectable(orphan)).toBe(lv);
    expect(registry.resolve(orphan)).toBeNull();
  });

  it('collects every mesh beneath a node', () => {
    const group = node('Group');
    attach(group, node('A', { isMesh: true }));
    const nested = attach(group, node('Nested'));
    attach(nested, node('B', { isMesh: true }));

    expect(collectMeshes(group).map((mesh) => mesh.name).sort()).toEqual(['A', 'B']);
  });

  it('clears completely', () => {
    const registry = new SpatialObjectRegistry();
    registry.register(lv, node('LV', { isMesh: true }));
    registry.recordUnmapped('Unknown_Mesh');

    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.unmappedNames()).toEqual([]);
  });
});

describe('buildRegistryFromMapping', () => {
  it('groups several vendor meshes under one semantic structure', () => {
    const root = node('Scene');
    attach(root, node('Heart_LV_001', { isMesh: true }));
    attach(root, node('Heart_LV_002', { isMesh: true }));
    attach(root, node('Heart_Root', { isMesh: true }));

    const registry = buildRegistryFromMapping(
      root,
      new Map([
        ['Heart_LV_001', lv],
        ['Heart_LV_002', lv],
        ['Heart_Root', heart],
      ]),
    );

    expect(registry.size).toBe(2);
    expect(registry.meshesFor(lv)).toHaveLength(2);
    expect(registry.meshesFor(heart)).toHaveLength(1);
  });

  it('records unmapped meshes and leaves them unselectable', () => {
    const root = node('Scene');
    const mapped = attach(root, node('Heart_LV_001', { isMesh: true }));
    const unmapped = attach(root, node('mesh_0442', { isMesh: true }));

    const registry = buildRegistryFromMapping(root, new Map([['Heart_LV_001', lv]]));

    expect(registry.unmappedNames()).toEqual(['mesh_0442']);
    expect(readTag(unmapped)).toBeNull();
    expect(registry.resolve(unmapped)).toBeNull();
    expect(registry.resolve(mapped)).toBe(lv);
  });
});
