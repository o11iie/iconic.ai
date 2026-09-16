import type { AnatomyRegion, AnatomySystem } from '../taxonomy';
import { anatomySemanticId } from '../taxonomy';
import type { SemanticId } from '@/lib/semantic-id';

/**
 * Declared anatomy model catalog.
 *
 * This is a catalogue of models VEO is *built to load*, not a claim that the
 * geometry is present. `licensedAssetRequired: true` means the entry renders as
 * an explicit "awaiting licensed asset" state until a manifest exists for it at
 * the configured asset host.
 *
 * This deliberately does NOT ship synthetic stand-in geometry. VEO's promise is
 * that what a learner sees is anatomically true; a procedurally generated
 * "heart" made of primitives would break that promise while looking complete.
 */
export interface AnatomyModelCatalogEntry {
  /** Provider-facing reference: the folder under the asset base URL. */
  readonly modelRef: string;
  readonly name: string;
  readonly description: string;
  readonly rootObjectId: SemanticId;
  readonly systems: readonly AnatomySystem[];
  readonly regions: readonly AnatomyRegion[];
  /** True until a licensed asset + manifest is published for this entry. */
  readonly licensedAssetRequired: boolean;
}

export const ANATOMY_MODEL_CATALOG: readonly AnatomyModelCatalogEntry[] = [
  {
    modelRef: 'heart',
    name: 'Heart',
    description:
      'Chambers, valves, coronary circulation and conduction pathway, with blood-flow relationships.',
    rootObjectId: anatomySemanticId('heart'),
    systems: ['cardiovascular'],
    regions: ['thorax'],
    licensedAssetRequired: true,
  },
  {
    modelRef: 'skull',
    name: 'Skull',
    description: 'Cranial and facial bones, sutures, foramina and their transmitted structures.',
    rootObjectId: anatomySemanticId('skull'),
    systems: ['skeletal'],
    regions: ['head_and_neck'],
    licensedAssetRequired: true,
  },
  {
    modelRef: 'brain',
    name: 'Brain',
    description: 'Lobes, deep grey matter, ventricular system, brainstem and cranial nerves.',
    rootObjectId: anatomySemanticId('brain'),
    systems: ['nervous'],
    regions: ['head_and_neck'],
    licensedAssetRequired: true,
  },
  {
    modelRef: 'thorax',
    name: 'Thorax',
    description: 'Thoracic cage, lungs, mediastinum and great vessels.',
    rootObjectId: anatomySemanticId('thorax'),
    systems: ['respiratory', 'cardiovascular', 'skeletal'],
    regions: ['thorax'],
    licensedAssetRequired: true,
  },
];

export function findCatalogEntry(modelRef: string): AnatomyModelCatalogEntry | null {
  return ANATOMY_MODEL_CATALOG.find((entry) => entry.modelRef === modelRef) ?? null;
}
