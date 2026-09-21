import type { SemanticId } from '@/lib/semantic-id';
import type { ManipulationAction, ManipulationState } from './manipulation';

/**
 * Manipulation history.
 *
 * Remembers semantic intents, not frames. Taking a model apart is a sequence
 * of decisions — hide this, peel that, dissect the thing underneath — and a
 * learner who goes one step too far should be able to step back rather than
 * start over.
 *
 * Each entry holds the action and the state it produced. Storing the resulting
 * state rather than an inverse operation is what makes undo exact: there is no
 * inverse to re-derive and no chance of an operation that almost undoes
 * itself. The states are small — a few sets, three scalars — so the whole
 * stack costs less than one frame of geometry.
 *
 * This is deliberately not a document-editing history. There are no merges, no
 * transactions and no persistence; it is bounded, in memory, and belongs to
 * the loaded model.
 */

export interface ManipulationEntry {
  readonly action: ManipulationAction;
  readonly state: ManipulationState;
  /** The selection in force when this state was produced. */
  readonly selectedId: SemanticId | null;
}

/** Deep enough to cover a session's exploration, bounded so it cannot grow. */
export const HISTORY_LIMIT = 50;

export class ManipulationHistory {
  private entries: ManipulationEntry[] = [];
  /** Index of the current entry. -1 is the pristine state before any action. */
  private cursor = -1;

  private readonly limit: number;

  constructor(limit: number = HISTORY_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  get length(): number {
    return this.entries.length;
  }

  get position(): number {
    return this.cursor;
  }

  canUndo(): boolean {
    return this.cursor >= 0;
  }

  canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  /** The action that produced the current state, for labelling undo. */
  currentAction(): ManipulationAction | null {
    return this.entries[this.cursor]?.action ?? null;
  }

  nextAction(): ManipulationAction | null {
    return this.entries[this.cursor + 1]?.action ?? null;
  }

  /**
   * Record a state transition.
   *
   * Recording after an undo drops the abandoned future, which is what every
   * learner already expects from an undo stack.
   */
  push(entry: ManipulationEntry): void {
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(entry);

    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(this.entries.length - this.limit);
    }
    this.cursor = this.entries.length - 1;
  }

  /**
   * Step back one entry.
   *
   * Returns the state to restore, or null when there is nothing to undo.
   * Undoing the first action returns null for the entry and the caller falls
   * back to the pristine state, so the stack never needs a synthetic entry
   * standing in for "nothing had happened yet".
   */
  undo(): ManipulationEntry | 'pristine' | null {
    if (!this.canUndo()) return null;
    this.cursor -= 1;
    return this.cursor < 0 ? 'pristine' : (this.entries[this.cursor] as ManipulationEntry);
  }

  redo(): ManipulationEntry | null {
    if (!this.canRedo()) return null;
    this.cursor += 1;
    return this.entries[this.cursor] as ManipulationEntry;
  }

  clear(): void {
    this.entries = [];
    this.cursor = -1;
  }
}
