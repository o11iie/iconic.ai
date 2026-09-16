'use client';

import { useCallback } from 'react';
import type { Box3 } from 'three';
import { MappedModel } from '@/engine/3d/scene/MappedModel';
import { SpatialCameraRig } from '@/engine/3d/camera/SpatialCameraRig';
import { SpatialCanvas } from '@/engine/3d/canvas/SpatialCanvas';
import { PipelineDiagnostic } from '@/engine/3d/diagnostics/PipelineDiagnostic';
import { ErrorState } from '@/components/ui/states';
import type { CameraCommand } from '@/engine/spatial/base-provider';
import type { SceneVisualState } from '@/engine/spatial/types';
import type { SemanticId } from '@/lib/semantic-id';
import type { BoundingBox } from '@/types/domain/spatial';

/**
 * The 3D stage: purely presentational.
 *
 * It owns no loading logic and no provider. The workspace resolves the model
 * once and passes the result down, so mounting the stage twice can never
 * trigger two downloads of the same asset.
 */

export interface SpatialStageProps {
  readonly assetUrl: string | null;
  readonly meshMapping: ReadonlyMap<string, SemanticId>;
  readonly visual: SceneVisualState;
  readonly camera: CameraCommand | null;
  readonly modelBox: BoundingBox | null;
  readonly reducedMotion: boolean;
  /** When false, pointer interaction never changes selection (orbit mode). */
  readonly selectable: boolean;
  readonly resolveBox: (id: string) => BoundingBox | null;
  readonly onSelect: (id: SemanticId | null) => void;
  readonly onHover: (id: SemanticId | null) => void;
  readonly onModelBounds: (box: BoundingBox) => void;
  readonly onUnmappedMeshes: (names: readonly string[]) => void;
  /** Renders the isolated, explicitly non-anatomical calibration object. */
  readonly diagnostic?: boolean;
}

export function SpatialStage({
  assetUrl,
  meshMapping,
  visual,
  camera,
  modelBox,
  reducedMotion,
  selectable,
  resolveBox,
  onSelect,
  onHover,
  onModelBounds,
  onUnmappedMeshes,
  diagnostic = false,
}: SpatialStageProps) {
  const handleBounds = useCallback(
    (box: Box3) => {
      onModelBounds({
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
      });
    },
    [onModelBounds],
  );

  return (
    <SpatialCanvas
      className="size-full"
      ariaLabel={
        diagnostic
          ? 'Render pipeline diagnostic — abstract calibration object, not anatomical content'
          : 'Interactive 3D model viewport'
      }
      unsupported={(reason) => (
        <div className="grid size-full place-items-center p-6">
          <ErrorState title="3D is unavailable on this device" description={reason} />
        </div>
      )}
    >
      {diagnostic ? <PipelineDiagnostic /> : null}

      {!diagnostic && assetUrl ? (
        <MappedModel
          assetUrl={assetUrl}
          meshMapping={meshMapping}
          visual={visual}
          onSelect={selectable ? onSelect : undefined}
          onHover={selectable ? onHover : undefined}
          onUnmappedMeshes={onUnmappedMeshes}
          onModelBounds={handleBounds}
        />
      ) : null}

      <SpatialCameraRig
        command={camera}
        resolveBox={resolveBox}
        modelBox={modelBox}
        reducedMotion={reducedMotion}
      />
    </SpatialCanvas>
  );
}
