'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Search } from '@/components/ui/Search';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { CONTENT_STATUS_LABEL, SUBJECTS, type SubjectDefinition } from '@/data/subjects';

/**
 * Learn — subject and category discovery.
 *
 * Renders the content catalogue with its real status attached to every entry.
 * A category whose licensed assets are not published says so and cannot be
 * opened, which is why the interface never implies production 3D anatomy
 * exists before it does.
 */
export function SubjectBrowser() {
  const [activeSubject, setActiveSubject] = useState<string>(SUBJECTS[0]?.slug ?? 'anatomy');
  const [query, setQuery] = useState('');

  return (
    <div className="flex flex-col gap-5">
      <Search
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        placeholder="Search categories"
        label="Search categories"
        className="max-w-sm"
      />

      <Tabs
        label="Subjects"
        value={activeSubject}
        onChange={setActiveSubject}
        items={SUBJECTS.map((subject) => ({
          id: subject.slug,
          label: subject.name,
          icon: subject.icon as IconName,
        }))}
      />

      {SUBJECTS.map((subject) => (
        <TabPanel key={subject.slug} id={subject.slug} active={subject.slug === activeSubject}>
          <SubjectDetail subject={subject} query={query} />
        </TabPanel>
      ))}
    </div>
  );
}

function SubjectDetail({
  subject,
  query,
}: {
  readonly subject: SubjectDefinition;
  readonly query: string;
}) {
  const needle = query.trim().toLowerCase();
  const categories = subject.categories.filter(
    (category) =>
      needle.length === 0 ||
      category.name.toLowerCase().includes(needle) ||
      category.description.toLowerCase().includes(needle),
  );

  if (subject.categories.length === 0) {
    return (
      <EmptyState
        title={`${subject.name} is planned`}
        description={`${subject.description} VEO's engine is domain-agnostic, so this subject needs content rather than new code.`}
        icon={<Icon name={subject.icon as IconName} size={22} />}
      />
    );
  }

  if (categories.length === 0) {
    return (
      <EmptyState
        title="No categories match that search"
        description="Try a different term, or clear the search to see everything in this subject."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-5">
      <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
        {subject.description}
      </p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => {
          const openable = category.contentStatus === 'available' && category.modelRefs.length > 0;
          const firstModel = category.modelRefs[0];

          const inner = (
            <>
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-ink">{category.name}</span>
                <Badge tone={openable ? 'success' : 'warning'}>
                  {CONTENT_STATUS_LABEL[category.contentStatus]}
                </Badge>
              </span>

              <span className="text-xs leading-relaxed text-ink-subtle">
                {category.description}
              </span>

              {category.modelRefs.length > 0 ? (
                <span className="mt-auto flex items-center gap-1.5 pt-1 text-[11px] text-ink-faint">
                  <Icon name="explore" size={12} />
                  {category.modelRefs.length} model
                  {category.modelRefs.length === 1 ? '' : 's'} defined
                </span>
              ) : null}
            </>
          );

          const shell = cn(
            'flex h-full flex-col gap-2 rounded-xl border border-hairline bg-surface p-4',
            openable
              ? 'transition-colors hover:border-accent/40'
              : 'opacity-80',
          );

          return (
            <li key={category.id}>
              {openable && firstModel ? (
                <Link href={`/explore?model=${encodeURIComponent(firstModel)}`} className={shell}>
                  {inner}
                </Link>
              ) : (
                <div className={shell} aria-disabled="true">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
