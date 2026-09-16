import { beforeEach, describe, expect, it } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import { useViewerStore } from './viewer-store';
import { useLearningStore } from './learning-store';
import { useAuthStore } from './auth-store';
import { useUIStore } from './ui-store';
import type { Subject } from '@/types/domain/knowledge';
import type { User } from '@/types/domain/user';

const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
const rv = 'veo.anatomy.heart.right_ventricle' as SemanticId;

describe('viewerStore', () => {
  beforeEach(() => useViewerStore.getState().reset());

  it('tracks selection and hover independently', () => {
    useViewerStore.getState().select(lv);
    useViewerStore.getState().hover(rv);

    expect(useViewerStore.getState().selectedObject).toBe(lv);
    expect(useViewerStore.getState().hoveredObject).toBe(rv);
  });

  it('does not add the same hidden object twice', () => {
    useViewerStore.getState().hide(lv);
    useViewerStore.getState().hide(lv);
    expect(useViewerStore.getState().hiddenObjects).toEqual([lv]);

    useViewerStore.getState().show(lv);
    expect(useViewerStore.getState().hiddenObjects).toEqual([]);
  });

  it('toggles layer visibility', () => {
    useViewerStore.getState().toggleLayer('cardiovascular');
    expect(useViewerStore.getState().hiddenLayers).toEqual(['cardiovascular']);

    useViewerStore.getState().toggleLayer('cardiovascular');
    expect(useViewerStore.getState().hiddenLayers).toEqual([]);
  });

  it('clears emphasis on resetView but keeps the loaded model', () => {
    useViewerStore.getState().setModelRef('heart');
    useViewerStore.getState().select(lv);
    useViewerStore.getState().isolate(lv);

    useViewerStore.getState().resetView();

    expect(useViewerStore.getState().selectedObject).toBeNull();
    expect(useViewerStore.getState().isolatedObject).toBeNull();
    expect(useViewerStore.getState().modelRef).toBe('heart');
  });

  it('clears loading when an error is set, so a spinner cannot hang forever', () => {
    useViewerStore.getState().setLoading(true);
    useViewerStore.getState().setError('Asset 404');

    expect(useViewerStore.getState().loading).toBe(false);
    expect(useViewerStore.getState().error).toBe('Asset 404');
  });
});

describe('learningStore', () => {
  beforeEach(() => useLearningStore.getState().reset());

  const subject = { id: 'subject-1', name: 'Cardiac anatomy' } as unknown as Subject;

  it('invalidates course and material when the subject changes', () => {
    useLearningStore.getState().setCourse({ id: 'course-1' } as never);
    useLearningStore.getState().setSelectedConcept(lv);

    useLearningStore.getState().setSubject(subject);

    expect(useLearningStore.getState().currentSubject?.id).toBe('subject-1');
    expect(useLearningStore.getState().currentCourse).toBeNull();
    expect(useLearningStore.getState().currentMaterial).toBeNull();
    expect(useLearningStore.getState().selectedConcept).toBeNull();
  });

  it('records each studied concept once per session', () => {
    useLearningStore.getState().beginSession('session-1', 'recall');
    useLearningStore.getState().markConceptStudied(lv);
    useLearningStore.getState().markConceptStudied(lv);
    useLearningStore.getState().markConceptStudied(rv);

    expect(useLearningStore.getState().conceptsStudied).toEqual([lv, rv]);

    useLearningStore.getState().endSession();
    expect(useLearningStore.getState().conceptsStudied).toEqual([]);
    expect(useLearningStore.getState().sessionId).toBeNull();
  });
});

describe('authStore', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('derives status from the presence of a user', () => {
    const user = { id: 'user-1', email: 'a@b.test' } as User;

    useAuthStore.getState().setSession(user, null);
    expect(useAuthStore.getState().status).toBe('authenticated');

    useAuthStore.getState().setSession(null, null);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('clears the session completely on sign out', () => {
    useAuthStore.getState().setSession({ id: 'user-1' } as User, null);
    useAuthStore.getState().setEntitlements([{ key: 'ai.tutor', granted: true } as never]);

    useAuthStore.getState().clear();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().entitlements).toEqual([]);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});

describe('uiStore', () => {
  beforeEach(() => useUIStore.getState().clearToasts());

  it('keeps error toasts until dismissed', () => {
    useUIStore.getState().pushToast({ tone: 'error', title: 'Model failed to load' });
    const [toast] = useUIStore.getState().toasts;

    // A failure that vanishes after three seconds is a failure nobody can act on.
    expect(toast?.durationMs).toBeNull();
  });

  it('auto-dismisses non-error toasts', () => {
    useUIStore.getState().pushToast({ tone: 'success', title: 'Saved' });
    expect(useUIStore.getState().toasts[0]?.durationMs).toBe(5000);
  });

  it('dismisses by id', () => {
    const id = useUIStore.getState().pushToast({ tone: 'info', title: 'Hello' });
    useUIStore.getState().dismissToast(id);
    expect(useUIStore.getState().toasts).toEqual([]);
  });
});
