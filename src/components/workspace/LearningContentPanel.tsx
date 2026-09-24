'use client';

import { useId, useState } from 'react';
import type { ValidatedFlashcard, ValidatedQuestion } from '@/ai/learning/learning-types';
import type { LearningContentState } from '@/hooks/useLearningContent';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type { SemanticId } from '@/lib/semantic-id';
import {
  DIFFICULTIES,
  LEARNING_OBJECTIVES,
  type ContentSourceStatus,
  type Difficulty,
  type LearningObjectiveType,
} from '@/types/domain/learning';

/**
 * Generated study material, in the workspace.
 *
 * Gate 11 is CONTENT, not a recall session. So this panel presents items and
 * reveals answers — and deliberately keeps no score, no streak and no history.
 *
 * That restraint is a design decision rather than an omission. A score kept
 * here would be a learner's performance record living in component state: it
 * would vanish on navigation, disagree with whatever the real memory model
 * later stores, and be the reason someone eventually asks why their progress
 * reset. The recall experience and the memory model arrive together, in their
 * own gates, or not at all.
 */

const OBJECTIVE_LABELS: Record<LearningObjectiveType, string> = {
  IDENTIFY: 'Identify it',
  DEFINE: 'Define it',
  FUNCTION: 'What it does',
  RELATE: 'How it connects',
  DISTINGUISH: 'Tell it apart',
  LOCATE: 'Where it sits',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const SOURCE_BADGE: Record<
  ContentSourceStatus,
  { readonly tone: 'cyan' | 'neutral' | 'warning'; readonly label: string; readonly title: string }
> = {
  grounded: {
    tone: 'cyan',
    label: 'From this model',
    title: 'Every item rests on descriptive content the loaded model supplies.',
  },
  'partially-grounded': {
    tone: 'neutral',
    label: 'Structural only',
    title:
      'The model supplies hierarchy and relationships but no descriptions, so these test structure rather than meaning.',
  },
  'insufficient-context': {
    tone: 'warning',
    label: 'Not enough in this model',
    title: 'The model does not carry enough to build reliable study material.',
  },
};

/**
 * Whether a failure is the learner's plan rather than a fault.
 *
 * The codes come from `@/billing/access`; listed rather than imported because
 * this is a client component and the billing server module is not reachable
 * from one. A code that is not one of these is a genuine error.
 */
function isPlanRefusal(code: string | undefined): boolean {
  return code === 'plan_required' || code === 'quota_exhausted' || code === 'unauthenticated';
}

export interface LearningContentPanelProps {
  readonly state: LearningContentState;
  readonly objective: LearningObjectiveType;
  readonly difficulty: Difficulty;
  readonly onObjectiveChange: (objective: LearningObjectiveType) => void;
  readonly onDifficultyChange: (difficulty: Difficulty) => void;
  readonly onGenerate: () => void;
  readonly onRetry: () => void;
  readonly onExploreStructure: (semanticId: SemanticId) => void;
  /**
   * Put what was generated into the review schedule.
   *
   * Optional: where recall is not configured the affordance is simply absent,
   * rather than present and failing when tapped.
   */
  readonly onAddToSchedule?: () => void;
  /** What the schedule reported back. Null until an attempt has been made. */
  readonly scheduleState?: ScheduleState;
  readonly className?: string;
}

/** The state of adding generated content to the schedule. */
export type ScheduleState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adding' }
  | { readonly kind: 'added'; readonly added: number; readonly failed: number }
  | { readonly kind: 'failed'; readonly message: string };

export function LearningContentPanel({
  state,
  objective,
  difficulty,
  onObjectiveChange,
  onDifficultyChange,
  onGenerate,
  onRetry,
  onExploreStructure,
  onAddToSchedule,
  scheduleState = { kind: 'idle' },
  className,
}: LearningContentPanelProps) {
  const objectiveId = useId();
  const difficultyId = useId();

  const kind = state.contentType === 'flashcard' ? 'flashcards' : 'questions';

  return (
    <section
      aria-label="Generated study material"
      data-veo-learning
      data-veo-learning-status={state.status}
      className={cn('flex min-h-0 flex-col gap-3', className)}
    >
      {/* ---- what to generate ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={objectiveId} className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Focus
          </label>
          <select
            id={objectiveId}
            data-veo-learning-objective
            value={objective}
            onChange={(event) => onObjectiveChange(event.target.value as LearningObjectiveType)}
            className={cn(
              'h-8 w-full min-w-0 rounded-lg border border-hairline bg-obsidian px-2 text-xs text-ink',
              'transition-colors hover:border-hairline-strong focus:border-accent focus:outline-none',
            )}
          >
            {LEARNING_OBJECTIVES.map((value) => (
              <option key={value} value={value}>
                {OBJECTIVE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={difficultyId} className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Level
          </label>
          <select
            id={difficultyId}
            data-veo-learning-difficulty
            value={difficulty}
            onChange={(event) => onDifficultyChange(event.target.value as Difficulty)}
            className={cn(
              'h-8 rounded-lg border border-hairline bg-obsidian px-2 text-xs text-ink',
              'transition-colors hover:border-hairline-strong focus:border-accent focus:outline-none',
            )}
          >
            {DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {DIFFICULTY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={onGenerate}
          disabled={state.status === 'loading'}
          data-veo-learning-generate
        >
          {state.status === 'loading' ? 'Generating…' : 'Generate'}
        </Button>
      </div>

      {state.status === 'idle' ? (
        <p className="rounded-lg border border-hairline bg-surface-raised/40 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
          <Icon name="sparkles" size={14} className="mr-1.5 inline-block align-[-2px] text-accent" />
          VEO will build {kind} about the selected structure, using only what this model
          actually says about it.
        </p>
      ) : null}

      {state.status === 'loading' ? <LearningLoading kind={kind} /> : null}

      {state.status === 'unavailable' ? (
        <LearningNotice
          tone="warning"
          title="Generation unavailable"
          body={state.error?.message ?? 'Content generation has not been configured for this environment yet.'}
        />
      ) : null}

      {/*
        A refusal by the learner's PLAN is not a failure, and must not be
        dressed as one. "VEO couldn't generate that — try again" against a
        spent allowance invites somebody to keep pressing a button that
        cannot work, and reads as a fault in the product rather than a
        boundary of their account.

        So the two cases are separated, and each offers the remedy that
        actually applies: wait, upgrade, or sign in.
      */}
      {state.status === 'error' && isPlanRefusal(state.error?.code) ? (
        <LearningNotice
          tone="warning"
          title={
            state.error?.code === 'quota_exhausted'
              ? "That is today's free allowance"
              : state.error?.code === 'unauthenticated'
                ? 'Sign in to generate study material'
                : 'Included on a paid plan'
          }
          body={state.error?.message ?? ''}
          action={
            <ButtonLink
              href={state.error?.code === 'unauthenticated' ? '/login?next=/explore' : '/plans'}
              size="sm"
              variant="secondary"
              data-veo-plan-refusal={state.error?.code}
            >
              {state.error?.code === 'unauthenticated' ? 'Sign in' : 'See plans'}
            </ButtonLink>
          }
        />
      ) : null}

      {state.status === 'error' && !isPlanRefusal(state.error?.code) ? (
        <LearningNotice
          tone="danger"
          title="VEO couldn't generate that"
          body={state.error?.message ?? 'Something went wrong. Try again.'}
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state.status === 'empty' ? (
        <LearningNotice
          tone="warning"
          title="Nothing VEO could stand behind"
          body="Everything that came back failed VEO's checks, so it produced nothing rather than something unreliable."
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state.status === 'ready' ? (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto" data-veo-learning-results>
          {state.sourceStatus ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                tone={SOURCE_BADGE[state.sourceStatus].tone}
                title={SOURCE_BADGE[state.sourceStatus].title}
                data-veo-learning-source={state.sourceStatus}
              >
                {SOURCE_BADGE[state.sourceStatus].label}
              </Badge>
              <span className="text-[11px] text-ink-faint">
                {state.questions.length + state.flashcards.length} {kind}
              </span>
            </div>
          ) : null}

          {onAddToSchedule && state.questions.length + state.flashcards.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" data-veo-schedule>
              <Button
                variant="secondary"
                size="sm"
                loading={scheduleState.kind === 'adding'}
                disabled={scheduleState.kind === 'adding' || scheduleState.kind === 'added'}
                onClick={onAddToSchedule}
                data-veo-schedule-add
              >
                <Icon name="clock" size={14} />
                {scheduleState.kind === 'added' ? 'In your schedule' : 'Add to schedule'}
              </Button>

              {/*
                Partial success is reported as partial success. Adding nine of
                ten is not "added", and the nine are not discarded.
              */}
              {scheduleState.kind === 'added' ? (
                <span className="text-[11px] text-ink-muted" data-veo-schedule-result>
                  {scheduleState.added} added
                  {scheduleState.failed > 0 ? ` · ${scheduleState.failed} could not be added` : ''}
                </span>
              ) : null}

              {scheduleState.kind === 'failed' ? (
                <span className="text-[11px] text-warn" role="alert" data-veo-schedule-result>
                  {scheduleState.message}
                </span>
              ) : null}
            </div>
          ) : null}

          {state.questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              onExploreStructure={onExploreStructure}
            />
          ))}

          {state.flashcards.map((card) => (
            <FlashcardCard key={card.id} card={card} onExploreStructure={onExploreStructure} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function LearningLoading({ kind }: { readonly kind: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-veo-learning-loading
      className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised/40 px-3 py-3"
    >
      <p className="flex items-center gap-2 text-xs text-ink-muted">
        <span
          aria-hidden
          className="size-3 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
        />
        VEO is writing {kind} from this model…
      </p>
      <div className="flex flex-col gap-1.5" aria-hidden>
        <span className="h-2 w-full animate-pulse rounded bg-surface-raised" />
        <span className="h-2 w-[82%] animate-pulse rounded bg-surface-raised" />
      </div>
    </div>
  );
}

function LearningNotice({
  tone,
  title,
  body,
  action,
}: {
  readonly tone: 'warning' | 'danger';
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-veo-learning-notice={tone}
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2.5',
        tone === 'warning' ? 'border-warning/25 bg-warning/[0.05]' : 'border-danger/25 bg-danger/[0.05]',
      )}
    >
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
        <Icon
          name="alert"
          size={14}
          className={cn('mt-0.5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-danger')}
        />
        <span className="min-w-0">
          <strong className="font-medium text-ink">{title}.</strong> {body}
        </span>
      </p>
      {action}
    </div>
  );
}

/**
 * One question.
 *
 * Choosing an option reveals whether it was right, and the explanation. That
 * is the whole interaction: nothing is recorded, and re-selecting is allowed,
 * because this is material being previewed rather than a test being taken.
 */
function QuestionCard({
  question,
  onExploreStructure,
}: {
  readonly question: ValidatedQuestion;
  readonly onExploreStructure: (semanticId: SemanticId) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hintShown, setHintShown] = useState(false);

  const answer = question.answer;
  const isChoice = question.kind === 'multiple_choice';
  const showResult = revealed || chosen !== null;

  return (
    <article
      data-veo-question={question.id}
      data-veo-question-kind={question.kind}
      className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-surface-raised/30 p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral" className="text-[10px]">
          {OBJECTIVE_LABELS[question.objective]}
        </Badge>
        <Badge tone="neutral" className="text-[10px]">
          {DIFFICULTY_LABELS[question.difficulty]}
        </Badge>
      </div>

      <p className="text-xs font-medium leading-relaxed text-ink" data-veo-question-prompt>
        {question.prompt}
      </p>

      {isChoice ? (
        <ul className="flex flex-col gap-1.5" data-veo-question-options>
          {question.options.map((option) => {
            const picked = chosen === option.id;
            const reveal = showResult;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  data-veo-option={option.id}
                  data-veo-option-correct={option.correct ? 'true' : 'false'}
                  onClick={() => setChosen(option.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs',
                    'transition-colors',
                    reveal && option.correct && 'border-success/40 bg-success/10 text-ink',
                    reveal && picked && !option.correct && 'border-danger/40 bg-danger/10 text-ink',
                    !reveal && 'border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink',
                    reveal && !option.correct && !picked && 'border-hairline text-ink-faint',
                  )}
                >
                  {reveal ? (
                    <Icon
                      name={option.correct ? 'check' : picked ? 'close' : 'info'}
                      size={13}
                      className={cn(
                        'mt-0.5 shrink-0',
                        option.correct ? 'text-success' : picked ? 'text-danger' : 'text-ink-faint',
                      )}
                    />
                  ) : null}
                  <span className="min-w-0">{option.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {question.kind === 'true_false' && answer.kind === 'boolean' ? (
        <div className="flex gap-1.5" data-veo-question-options>
          {[true, false].map((value) => {
            const picked = chosen === String(value);
            const correct = answer.value === value;
            const reveal = showResult;
            return (
              <button
                key={String(value)}
                type="button"
                data-veo-option={String(value)}
                data-veo-option-correct={correct ? 'true' : 'false'}
                onClick={() => setChosen(String(value))}
                className={cn(
                  'flex-1 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors',
                  reveal && correct && 'border-success/40 bg-success/10 text-ink',
                  reveal && picked && !correct && 'border-danger/40 bg-danger/10 text-ink',
                  !reveal && 'border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink',
                  reveal && !correct && !picked && 'border-hairline text-ink-faint',
                )}
              >
                {value ? 'True' : 'False'}
              </button>
            );
          })}
        </div>
      ) : null}

      {question.kind === 'free_recall' && answer.kind === 'text' && showResult ? (
        <p className="rounded-lg border border-success/25 bg-success/[0.06] px-2.5 py-2 text-xs leading-relaxed text-ink-muted">
          <strong className="font-medium text-ink">Answer.</strong> {answer.text}
        </p>
      ) : null}

      {question.kind === 'identify_structure' && answer.kind === 'spatial' && showResult ? (
        <button
          type="button"
          data-veo-question-target={answer.semanticId}
          onClick={() => onExploreStructure(answer.semanticId)}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-success/25 bg-success/[0.06] px-2.5 py-2',
            'text-left text-xs text-ink-muted transition-colors hover:border-success/40',
          )}
        >
          <Icon name="select" size={13} className="shrink-0 text-success" />
          <span className="min-w-0">
            <strong className="font-medium text-ink">{answer.name}</strong> — show it in the model
          </span>
        </button>
      ) : null}

      {/* ---- hint and reveal ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {question.hint && !hintShown && !showResult ? (
          <button
            type="button"
            data-veo-question-hint-toggle
            onClick={() => setHintShown(true)}
            className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
          >
            Show hint
          </button>
        ) : null}
        {!showResult ? (
          <button
            type="button"
            data-veo-question-reveal
            onClick={() => setRevealed(true)}
            className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
          >
            Reveal answer
          </button>
        ) : null}
      </div>

      {hintShown && !showResult && question.hint ? (
        <p className="text-[11px] leading-relaxed text-ink-faint" data-veo-question-hint>
          {question.hint}
        </p>
      ) : null}

      {showResult ? (
        <p
          className="rounded-lg bg-obsidian/60 px-2.5 py-2 text-[11px] leading-relaxed text-ink-muted"
          data-veo-question-explanation
        >
          {question.explanation}
        </p>
      ) : null}
    </article>
  );
}

/** Front, reveal, back. Keyboard and pointer both work. */
function FlashcardCard({
  card,
  onExploreStructure,
}: {
  readonly card: ValidatedFlashcard;
  readonly onExploreStructure: (semanticId: SemanticId) => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <article
      data-veo-flashcard={card.id}
      data-veo-flashcard-revealed={revealed ? 'true' : 'false'}
      className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-surface-raised/30 p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral" className="text-[10px]">
          {OBJECTIVE_LABELS[card.objective]}
        </Badge>
        <Badge tone="neutral" className="text-[10px]">
          {DIFFICULTY_LABELS[card.difficulty]}
        </Badge>
      </div>

      <p className="text-xs font-medium leading-relaxed text-ink" data-veo-flashcard-front>
        {card.front}
      </p>

      {revealed ? (
        <p
          className="rounded-lg border border-accent/20 bg-accent/[0.06] px-2.5 py-2 text-xs leading-relaxed text-ink-muted"
          data-veo-flashcard-back
        >
          {card.back}
        </p>
      ) : (
        <button
          type="button"
          data-veo-flashcard-reveal
          onClick={() => setRevealed(true)}
          className={cn(
            'w-full rounded-lg border border-dashed border-hairline-strong px-2.5 py-2.5',
            'text-[11px] font-medium text-ink-muted transition-colors',
            'hover:border-accent/40 hover:text-ink focus:border-accent focus:outline-none',
          )}
        >
          Reveal answer
        </button>
      )}

      {card.hint && !revealed ? (
        <p className="text-[11px] leading-relaxed text-ink-faint" data-veo-flashcard-hint>
          {card.hint}
        </p>
      ) : null}

      {revealed && card.relatedSemanticIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {card.relatedSemanticIds.map((id) => (
            <button
              key={id}
              type="button"
              data-veo-flashcard-related={id}
              onClick={() => onExploreStructure(id)}
              className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              Show related structure
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
