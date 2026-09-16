import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/states';
import { Badge } from '@/components/ui/Badge';
import { RECALL_MODES } from '@/store/learning-store';

export const metadata: Metadata = { title: 'Recall' };

const MODE_LABELS: Record<string, string> = {
  flashcards: 'Flashcards',
  questions: 'Questions',
  spatial_identify: 'Identify in 3D',
  mixed: 'Mixed',
};

/**
 * RECALL — retrieval practice and spaced repetition.
 *
 * `spatial_identify` is the mode that only VEO can offer: the prompt is a
 * question and the answer is a structure you click in the model. It is
 * represented in the domain types (`QuestionKind`) and scheduled through
 * `memory_states` against semantic ids.
 */
export default function RecallPage() {
  return (
    <AppShell
      title="Recall"
      subtitle="Retrieve it from memory, not from the page. VEO schedules each concept to return just before you would forget it."
    >
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader
            title="Recall modes"
            description="How you want to be tested. Each mode writes to the same memory model."
          />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {RECALL_MODES.map((mode) => (
                <li key={mode}>
                  <Badge tone={mode === 'spatial_identify' ? 'cyan' : 'neutral'}>
                    {MODE_LABELS[mode] ?? mode}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Today's queue" description="Concepts due for review." />
          <CardBody>
            <EmptyState
              title="Nothing due yet"
              description="Your review queue is built from real recall attempts. It stays empty until you have studied something — VEO will not seed it with placeholder cards."
              action={
                <ButtonLink href="/explore" size="sm">
                  Start exploring
                </ButtonLink>
              }
            />
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
