import type { Metadata } from 'next';
import { NotConfiguredState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Terms' };

/**
 * Terms of Service.
 *
 * This page states honestly that the final terms are not yet published rather
 * than presenting invented legal text as binding. Fabricated terms would be
 * both misleading and legally hazardous, so what exists today is a factual
 * description of the service and a clear notice that the document is pending
 * legal review.
 */
export default function TermsPage() {
  return (
    <article className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-ink-muted">
          VEO is pre-launch. The binding terms are being prepared.
        </p>
      </header>

      <NotConfiguredState
        title="Final terms are not yet published"
        description="VEO has not yet published its Terms of Service. Rather than present placeholder legal text as if it were binding, this page describes the service as it currently stands. Binding terms will be published here, and existing accounts will be notified, before VEO becomes generally available."
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">What VEO is today</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          VEO is a spatial-learning platform in active development. Accounts created now are
          development accounts. Features may change, and data may be reset while the product is
          pre-launch. Do not rely on VEO as the only copy of anything important to you.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Content and licensing</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Material you upload remains yours. Spatial models shown in VEO are supplied under licence
          from their rights holders, or owned by VEO, and may not be extracted or redistributed.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Not medical or professional advice</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          VEO is an educational tool. Nothing in it is medical, clinical, engineering or other
          professional advice, and it must not be used as the basis for a decision that affects a
          person&rsquo;s health or safety.
        </p>
      </section>
    </article>
  );
}
