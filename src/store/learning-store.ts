import { create } from 'zustand';
import type { SemanticId } from '@/lib/semantic-id';
import type { SessionMode } from '@/types/domain/learning';
import type { Course, LearningMaterial, Subject } from '@/types/domain/knowledge';

/**
 * Learning store — where the learner is in the VEO learning loop.
 *
 *   UPLOAD -> UNDERSTAND -> STRUCTURE -> EXPLORE -> ASK
 *          -> CONNECT -> RECALL -> APPLY -> REVIEW -> REMEMBER
 *
 * `loopStage` is explicit so later features can plug into the loop without
 * needing to infer position from a tangle of booleans.
 */

export const LOOP_STAGES = [
  'upload',
  'understand',
  'structure',
  'explore',
  'ask',
  'connect',
  'recall',
  'apply',
  'review',
  'remember',
] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

export const RECALL_MODES = ['flashcards', 'questions', 'spatial_identify', 'mixed'] as const;
export type RecallMode = (typeof RECALL_MODES)[number];

export interface LearningState {
  currentSubject: Subject | null;
  currentCourse: Course | null;
  currentMaterial: LearningMaterial | null;
  selectedConcept: SemanticId | null;
  learningMode: SessionMode;
  recallMode: RecallMode;
  loopStage: LoopStage;
  /** Id of the active LearningSession row, once one has been opened. */
  sessionId: string | null;
  /** Concepts touched in this session; flushed to recall_attempts on end. */
  conceptsStudied: readonly SemanticId[];
}

export interface LearningActions {
  setSubject: (subject: Subject | null) => void;
  setCourse: (course: Course | null) => void;
  setMaterial: (material: LearningMaterial | null) => void;
  setSelectedConcept: (conceptId: SemanticId | null) => void;
  setLearningMode: (mode: SessionMode) => void;
  setRecallMode: (mode: RecallMode) => void;
  setLoopStage: (stage: LoopStage) => void;
  beginSession: (sessionId: string, mode: SessionMode) => void;
  endSession: () => void;
  markConceptStudied: (conceptId: SemanticId) => void;
  reset: () => void;
}

const initialState: LearningState = {
  currentSubject: null,
  currentCourse: null,
  currentMaterial: null,
  selectedConcept: null,
  learningMode: 'explore',
  recallMode: 'mixed',
  loopStage: 'explore',
  sessionId: null,
  conceptsStudied: [],
};

export const useLearningStore = create<LearningState & LearningActions>()((set) => ({
  ...initialState,

  // Changing subject invalidates course and material: keeping a course from a
  // different subject selected is a bug waiting to happen.
  setSubject: (currentSubject) =>
    set({ currentSubject, currentCourse: null, currentMaterial: null, selectedConcept: null }),

  setCourse: (currentCourse) => set({ currentCourse }),
  setMaterial: (currentMaterial) => set({ currentMaterial }),
  setSelectedConcept: (selectedConcept) => set({ selectedConcept }),
  setLearningMode: (learningMode) => set({ learningMode }),
  setRecallMode: (recallMode) => set({ recallMode }),
  setLoopStage: (loopStage) => set({ loopStage }),

  beginSession: (sessionId, learningMode) =>
    set({ sessionId, learningMode, conceptsStudied: [] }),

  endSession: () => set({ sessionId: null, conceptsStudied: [] }),

  markConceptStudied: (conceptId) =>
    set((state) =>
      state.conceptsStudied.includes(conceptId)
        ? state
        : { conceptsStudied: [...state.conceptsStudied, conceptId] },
    ),

  reset: () => set(initialState),
}));

export const useCurrentSubject = () => useLearningStore((s) => s.currentSubject);
export const useCurrentCourse = () => useLearningStore((s) => s.currentCourse);
export const useSelectedConcept = () => useLearningStore((s) => s.selectedConcept);
export const useLoopStage = () => useLearningStore((s) => s.loopStage);
