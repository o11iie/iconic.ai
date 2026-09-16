'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useActionState, useState } from 'react';
import { completeOnboardingAction } from '@/app/onboarding/actions';
import { EMPTY_ONBOARDING_STATE } from '@/app/onboarding/state';
import { ONBOARDING_DOMAINS, ONBOARDING_GOALS, ONBOARDING_LEVELS } from '@/data/onboarding';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, NotConfiguredState } from '@/components/ui/states';
import { motionSafe, riseIn } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/store/ui-store';

/**
 * Onboarding.
 *
 * Three short steps, because friction here costs more than the data is worth.
 * Only two answers change what VEO shows a learner — what they want to learn
 * and at what level — so only those are required; the goal is optional.
 *
 * All answers live in local state until the final submit, which posts them to
 * a server action in one request. Nothing is claimed about personalisation
 * beyond what these values actually drive.
 */

const STEPS = [
  { id: 'you', label: 'You' },
  { id: 'subject', label: 'Subject' },
  { id: 'level', label: 'Level' },
] as const;

export function OnboardingFlow({
  defaultName,
  canPersist,
}: {
  readonly defaultName: string;
  readonly canPersist: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    completeOnboardingAction,
    EMPTY_ONBOARDING_STATE,
  );
  const reducedMotion = useReducedMotion();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(defaultName);
  const [domain, setDomain] = useState<string>('');
  const [level, setLevel] = useState<string>('');
  const [goal, setGoal] = useState<string>('');

  const canAdvance = [name.trim().length > 0, domain.length > 0, level.length > 0][step] ?? false;
  const isLast = step === STEPS.length - 1;

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {/* Values from earlier steps travel with the final submit. */}
      <input type="hidden" name="displayName" value={name} />
      <input type="hidden" name="domain" value={domain} />
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="goal" value={goal} />

      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEPS.map((item, index) => (
          <li key={item.id} className="flex flex-1 items-center gap-2">
            <span
              aria-current={index === step ? 'step' : undefined}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                index <= step ? 'bg-accent' : 'bg-hairline',
              )}
            />
            <span className="veo-sr-only">
              {`Step ${index + 1} of ${STEPS.length}: ${item.label}`}
              {index === step ? ' (current)' : ''}
            </span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={motionSafe(riseIn, reducedMotion)}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="flex min-h-[19rem] flex-col gap-6"
        >
          {step === 0 ? (
            <>
              <StepHeading
                title="What should we call you?"
                subtitle="This is how VEO will address you."
              />
              <Input
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                autoFocus
                placeholder="Ada Lovelace"
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <StepHeading
                title="What do you want to learn?"
                subtitle="This sets where VEO starts you. You can change it later."
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ONBOARDING_DOMAINS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    selected={domain === option.id}
                    icon={option.icon as IconName}
                    title={option.label}
                    description={option.description}
                    onSelect={() => setDomain(option.id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <StepHeading
                title="Where are you working at?"
                subtitle="Sets the depth of explanations and the difficulty of recall material."
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ONBOARDING_LEVELS.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    selected={level === option.value}
                    title={option.label}
                    description={option.description}
                    onSelect={() => setLevel(option.value)}
                  />
                ))}
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-ink-muted">
                  What are you hoping for? <span className="text-ink-faint">(optional)</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {ONBOARDING_GOALS.map((option) => {
                    const selected = goal === option.label;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setGoal(selected ? '' : option.label)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                          selected
                            ? 'border-accent/50 bg-accent/12 text-accent'
                            : 'border-hairline-strong text-ink-subtle hover:text-ink',
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {!canPersist && step === STEPS.length - 1 ? (
        <NotConfiguredState
          title="Your answers cannot be saved yet"
          description="Profiles are stored in Supabase. Without a project connected, VEO will not pretend to remember these preferences."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      ) : null}

      {state.error ? <ErrorState title="Could not save" description={state.error} /> : null}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((value) => Math.max(0, value - 1))}
          disabled={step === 0}
        >
          Back
        </Button>

        {isLast ? (
          <Button type="submit" size="lg" loading={pending} disabled={!canAdvance}>
            Finish setup
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            disabled={!canAdvance}
            onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
          >
            Continue
          </Button>
        )}
      </div>
    </form>
  );
}

function StepHeading({ title, subtitle }: { readonly title: string; readonly subtitle: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
        {title}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{subtitle}</p>
    </div>
  );
}

function ChoiceCard({
  selected,
  icon,
  title,
  description,
  onSelect,
}: {
  readonly selected: boolean;
  readonly icon?: IconName;
  readonly title: string;
  readonly description: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors duration-150',
        selected
          ? 'border-accent/50 bg-accent/[0.07]'
          : 'border-hairline bg-surface hover:border-hairline-strong',
      )}
    >
      {icon ? (
        <span
          className={cn(
            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
            selected
              ? 'bg-accent/16 text-accent'
              : 'bg-surface-raised text-ink-subtle',
          )}
        >
          <Icon name={icon} size={16} />
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">
          {description}
        </span>
      </span>

      {selected ? <Icon name="check" size={16} className="mt-1 text-accent" /> : null}
    </button>
  );
}
