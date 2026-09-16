'use client';

import { useState } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/states';
import { Badge } from '@/components/ui/Badge';
import { MATERIAL_KINDS } from '@/types/domain/knowledge';

/**
 * Library.
 *
 * Four collections, each with an honest empty state. Counts are omitted rather
 * than shown as zero-with-a-trend, because a fabricated metric is worse than no
 * metric — and there is no persisted data to count yet.
 */

type LibraryTabId = 'models' | 'materials' | 'notes' | 'flashcards';

const TABS: readonly { id: LibraryTabId; label: string; icon: IconName }[] = [
  { id: 'models', label: 'Saved models', icon: 'explore' },
  { id: 'materials', label: 'Materials', icon: 'note' },
  { id: 'notes', label: 'Notes', icon: 'learn' },
  { id: 'flashcards', label: 'Flashcards', icon: 'flashcard' },
];

export function LibraryTabs() {
  const [tab, setTab] = useState<LibraryTabId>('models');

  return (
    <div className="flex flex-col gap-5">
      <Tabs label="Library" value={tab} onChange={(id) => setTab(id as LibraryTabId)} items={TABS} />

      <TabPanel id="models" active={tab === 'models'}>
        <EmptyState
          title="Your saved models will appear here"
          description="Save a model from the workspace to keep it within reach. Saved models remember the structure you were last looking at."
          icon={<Icon name="explore" size={22} />}
          action={
            <ButtonLink href="/explore" size="sm">
              Open the workspace
            </ButtonLink>
          }
        />
      </TabPanel>

      <TabPanel id="materials" active={tab === 'materials'}>
        <div className="flex flex-col gap-4">
          <EmptyState
            title="Nothing uploaded yet"
            description="Add a lecture PDF or your own notes. VEO extracts the concepts, links them to spatial structures where they exist, and builds recall material from them."
            icon={<Icon name="note" size={22} />}
          />
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              Supported formats
            </h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {MATERIAL_KINDS.map((kind) => (
                <li key={kind}>
                  <Badge>{kind.replace(/_/g, ' ')}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </TabPanel>

      <TabPanel id="notes" active={tab === 'notes'}>
        <EmptyState
          title="No notes yet"
          description="Notes can be anchored to a structure in a model, so they come back when you are looking at the thing they describe."
          icon={<Icon name="learn" size={22} />}
          action={
            <ButtonLink href="/explore" variant="secondary" size="sm">
              Explore a model
            </ButtonLink>
          }
        />
      </TabPanel>

      <TabPanel id="flashcards" active={tab === 'flashcards'}>
        <EmptyState
          title="No flashcards yet"
          description="Generate cards from your material, or create one from any structure in the workspace. Cards can carry a spatial anchor so reviewing one flies the camera to it."
          icon={<Icon name="flashcard" size={22} />}
          action={
            <ButtonLink href="/recall" variant="secondary" size="sm">
              Go to Recall
            </ButtonLink>
          }
        />
      </TabPanel>
    </div>
  );
}
