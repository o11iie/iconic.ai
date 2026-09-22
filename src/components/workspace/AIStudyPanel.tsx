'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { TutorAction } from '@/ai/tutor/tutor-types';

/**
 * AI study bar.
 *
 * Deliberately ONE row tall. This bar sits under the viewport, and every pixel
 * it takes is a pixel the model loses — on a 390px phone an expanded notice
 * here costs a third of the screen and turns the viewport into a thumbnail.
 * So the unconfigured state is a single compact line rather than a full
 * callout, while remaining completely explicit about what is missing.
 *
 * The differentiator is context: the tutor is told which structure is selected
 * and which model is open. This bar states the context it actually has, and
 * never implies a focus it does not.
 */

export type StudyMode =
  | 'explain'
  | 'simplify'
  | 'deep_dive'
  | 'function'
  | 'relationships'
  | 'quiz'
  | 'flashcard';

/**
 * Study modes.
 *
 * `available: false` marks a mode whose behaviour belongs to a later gate. It
 * is shown, disabled, with a reason — rather than hidden, which would make the
 * product look smaller than it is, or enabled, which would make a control that
 * does nothing. A learner who clicks it learns when it arrives.
 */
const MODES: readonly {
  id: StudyMode;
  label: string;
  icon: IconName;
  available: boolean;
  unavailable?: string;
}[] = [
  { id: 'explain', label: 'Explain', icon: 'sparkles', available: true },
  { id: 'simplify', label: 'Simplify', icon: 'info', available: true },
  { id: 'deep_dive', label: 'Deep dive', icon: 'learn', available: true },
  { id: 'function', label: 'Function', icon: 'select', available: true },
  { id: 'relationships', label: 'Relationships', icon: 'link', available: true },
  {
    id: 'quiz',
    label: 'Quiz me',
    icon: 'quiz',
    available: false,
    unavailable: 'Question generation arrives in a later VEO gate.',
  },
  {
    id: 'flashcard',
    label: 'Flashcard',
    icon: 'flashcard',
    available: false,
    unavailable: 'Flashcard generation arrives in a later VEO gate.',
  },
];

/** Study modes that map onto a Gate 10 tutor action. */
export const STUDY_MODE_ACTIONS = {
  explain: 'EXPLAIN',
  simplify: 'SIMPLIFY',
  deep_dive: 'DEEP_DIVE',
  function: 'FUNCTION',
  relationships: 'RELATIONSHIPS',
} as const;

export function AIStudyPanel({
  selectedId,
  modelName,
  aiConfigured,
  hasModel,
  onAsk,
  busy = false,
  className,
}: {
  readonly selectedId: SemanticId | null;
  readonly modelName: string | null;
  readonly aiConfigured: boolean;
  readonly hasModel: boolean;
  /**
   * Ask the tutor. Omitted where the bar is rendered without one — the bar
   * then keeps its honest disabled state rather than throwing on click.
   */
  readonly onAsk?: (action: TutorAction, message?: string) => void;
  readonly busy?: boolean;
  readonly className?: string;
}) {
  const [mode, setMode] = useState<StudyMode>('explain');
  const [question, setQuestion] = useState('');

  const contextLabel = selectedId
    ? `Ask about ${semanticIdToLabel(selectedId)}`
    : hasModel
      ? `Ask about ${modelName ?? 'this model'}`
      : 'Ask about the selected structure';

  // A question needs something to be about. Without a selection the tutor
  // would be a general chatbot, which is the one thing it must not become.
  const disabled = !aiConfigured || !hasModel || !selectedId || !onAsk || busy;

  const runMode = (next: StudyMode) => {
    setMode(next);
    const action = STUDY_MODE_ACTIONS[next as keyof typeof STUDY_MODE_ACTIONS];
    if (!action || disabled) return;
    onAsk?.(action);
  };

  return (
    <section
      aria-label="AI study"
      className={cn(
        'flex flex-col gap-2 border-t border-hairline px-3 py-2.5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {/* Modes scroll rather than wrap: wrapping costs a second row of height. */}
        <div
          role="radiogroup"
          aria-label="Study mode"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {MODES.map((item) => {
            const active = item.id === mode && item.available;
            const usable = item.available && !disabled;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-disabled={!item.available}
                disabled={!usable}
                data-veo-study-mode={item.id}
                data-veo-study-available={item.available ? 'true' : 'false'}
                title={item.available ? item.label : item.unavailable}
                onClick={() => runMode(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-150',
                  active
                    ? 'bg-accent/16 text-accent'
                    : 'text-ink-subtle hover:bg-surface-raised hover:text-ink',
                  !item.available && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-ink-subtle',
                  item.available && disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <Icon name={item.icon} size={14} />
                {item.label}
                {item.available ? null : (
                  <span className="veo-sr-only">{item.unavailable}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* State the real context, so the learner is never misled about it. */}
        <Badge tone={selectedId ? 'cyan' : 'neutral'} className="hidden sm:inline-flex">
          {selectedId ? 'In context' : 'No structure selected'}
        </Badge>
      </div>

      {aiConfigured ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = question.trim();
            if (!text || disabled) return;
            // A typed question is always a follow-up: it arrives with the
            // selected structure as its subject, which is what keeps the
            // tutor spatial rather than general.
            onAsk?.('FOLLOW_UP', text);
            setQuestion('');
          }}
        >
          <label htmlFor="veo-ai-question" className="veo-sr-only">
            {contextLabel}
          </label>
          <input
            id="veo-ai-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={contextLabel}
            disabled={disabled}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-obsidian',
              'px-3 text-sm text-ink placeholder:text-ink-faint',
              'transition-colors hover:border-hairline-strong',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
          <Button type="submit" size="sm" disabled={disabled || question.trim().length === 0}>
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </form>
      ) : (
        /* One compact line: honest, and it does not steal the viewport. */
        <p className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/[0.05] px-2.5 py-1.5 text-xs leading-snug text-ink-muted">
          <Icon name="alert" size={14} className="shrink-0 text-warning" />
          <span className="min-w-0">
            AI tutor is not configured. Set{' '}
            <code className="font-mono text-[11px] text-cyan">OPENAI_API_KEY</code> to
            enable it — the key is server-only and never reaches the browser.
          </span>
        </p>
      )}
    </section>
  );
}
