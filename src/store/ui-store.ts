import { create } from 'zustand';

/**
 * UI store — chrome and ephemeral interface state only.
 *
 * Nothing in here is persisted server-side, and nothing here affects what the
 * learner knows. Keeping it separate means a toast cannot re-render the
 * viewport, and the viewport cannot accidentally own navigation state.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  /** Milliseconds; null keeps the toast until dismissed (used for errors). */
  readonly durationMs: number | null;
}

export interface UIState {
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  inspectorOpen: boolean;
  /** Mirrors prefers-reduced-motion; damps camera and panel animation. */
  reducedMotion: boolean;
  toasts: readonly Toast[];
}

export interface UIActions {
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  setReducedMotion: (reduced: boolean) => void;
  /** `id` and `durationMs` are optional: both are defaulted by the store. */
  pushToast: (
    toast: Omit<Toast, 'id' | 'durationMs'> & { id?: string; durationMs?: number | null },
  ) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState & UIActions>()((set) => ({
  sidebarOpen: true,
  commandPaletteOpen: false,
  inspectorOpen: true,
  reducedMotion: false,
  toasts: [],

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),

  pushToast: (toast) => {
    toastCounter += 1;
    const id = toast.id ?? `toast-${toastCounter}`;
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id,
          tone: toast.tone,
          title: toast.title,
          ...(toast.description === undefined ? {} : { description: toast.description }),
          // Errors persist until dismissed: a failure that vanishes after three
          // seconds is a failure the user never gets to act on.
          durationMs: toast.durationMs ?? (toast.tone === 'error' ? null : 5000),
        },
      ],
    }));
    return id;
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clearToasts: () => set({ toasts: [] }),
}));

export const useSidebarOpen = () => useUIStore((s) => s.sidebarOpen);
export const useToasts = () => useUIStore((s) => s.toasts);
export const useReducedMotion = () => useUIStore((s) => s.reducedMotion);
