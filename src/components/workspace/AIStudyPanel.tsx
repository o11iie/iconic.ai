'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';

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

export type StudyMode = 'explain' | 'teach' | 'ask' | 'quiz' | 'hint';

const MODES: readonly { id: StudyMode; label: string; icon: IconName }[] = [
  { id: 'explain', label: 'Explain', icon: 'sparkles' },
  { id: 'teach', label: 'Teach me', icon: 'learn' },
  { id: 'ask', label: 'Ask', icon: 'quiz' },
  { id: 'quiz', label: 'Quiz me', icon: 'flashcard' },
  { id: 'hint', label: 'Give me a hint', icon: 'info' },
];

export function AIStudyPanel({
  selectedId,
  modelName,
  aiConfigured,
  hasModel,
  className,
}: {
  readonly selectedId: SemanticId | null;
  readonly modelName: string | null;
  readonly aiConfigured: boolean;
  readonly hasModel: boolean;
  readonly className?: string;
}) {
  const [mode, setMode] = useState<StudyMode>('ask');
  const [question, setQuestion] = useState('');

  const contextLabel = selectedId
    ? `Ask about ${semanticIdToLabel(selectedId)}`
    : hasModel
      ? `Ask about ${modelName ?? 'this model'}`
      : 'Ask about the selected structure';

  const disabled = !aiConfigured || !hasModel;

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
            const active = item.id === mode;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-150',
                  active
                    ? 'bg-accent/16 text-accent'
                    : 'text-ink-subtle hover:bg-surface-raised hover:text-ink',
                )}
              >
                <Icon name={item.icon} size={14} />
                {item.label}
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
            // Tutor responses are wired in the gate that implements generation.
            // Until then the control is disabled rather than silently no-op.
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
            Ask
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
