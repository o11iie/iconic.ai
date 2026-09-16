import type { Metadata } from 'next';
import { NotConfiguredState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Privacy' };

/**
 * Privacy notice.
 *
 * Describes only data handling that the codebase actually implements today.
 * Nothing here is aspirational: each statement maps to real code in
 * `src/lib/supabase`, `src/ai` and `supabase/migrations`.
 */
export default function PrivacyPage() {
  return (
    <article className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-ink-muted">
          What VEO stores, and where it goes.
        </p>
      </header>

      <NotConfiguredState
        title="Final privacy policy is not yet published"
        description="VEO is pre-launch and has not published a final privacy policy. What follows describes the data handling the application actually implements today. A complete policy will be published here before general availability."
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">What is stored</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-ink-muted">
          <li>Your account email and password, handled by Supabase Auth. VEO never sees your password.</li>
          <li>Your profile: display name, locale, timezone, learning level and chosen domains.</li>
          <li>Material you upload, in a private storage bucket scoped to your account.</li>
          <li>Your learning activity: sessions, notes, flashcards and recall history.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Who can read it</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Row Level Security policies in the database restrict every row to the account that owns
          it, and storage policies restrict uploaded files to your own folder. These are enforced by
          the database, not by the application, so a bug in the interface cannot expose another
          account&rsquo;s data.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">AI processing</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          When you use the tutor, the text of your question and the context of what you are looking
          at are sent to the configured model provider to generate a response. Requests are proxied
          through VEO&rsquo;s servers; your account credentials are never sent.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Deleting your data</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Deleting your account removes your profile, material, notes and learning history. Database
          records are removed by cascade from your account row.
        </p>
      </section>
    </article>
  );
}
