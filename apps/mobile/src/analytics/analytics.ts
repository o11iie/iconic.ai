import { api } from "../api/client";

/**
 * Slate's analytics facade. Product code calls `track(...)` and never talks
 * to a vendor SDK directly, so swapping or adding a provider (Amplitude,
 * PostHog, Firebase) later means implementing `AnalyticsProvider` once
 * rather than editing every call site.
 *
 * Events are queued and flushed in batches so a burst of interactions
 * doesn't fire a request per tap, and a failed flush never surfaces to the
 * user — analytics must never break the product.
 */
export type AnalyticsEventName =
  | "app_open"
  | "signup"
  | "login"
  | "onboarding_complete"
  | "search"
  | "title_view"
  | "trailer_view"
  | "follow"
  | "unfollow"
  | "watchlist_add"
  | "watchlist_remove"
  | "countdown_view"
  | "countdown_share"
  | "community_post"
  | "community_comment"
  | "community_reaction"
  | "community_report"
  | "ai_open"
  | "ai_message"
  | "ai_limit_reached"
  | "paywall_view"
  | "purchase_started"
  | "purchase_completed"
  | "purchase_failed"
  | "purchase_restored"
  | "notification_opened";

export type AnalyticsProperties = Record<string, string | number | boolean | null>;

interface QueuedEvent {
  name: AnalyticsEventName;
  properties?: AnalyticsProperties;
  occurredAt: string;
}

export interface AnalyticsProvider {
  track(event: QueuedEvent): void;
  flush(): Promise<void>;
}

const FLUSH_INTERVAL_MS = 10_000;
const MAX_BATCH = 50;

/** Sends events to Slate's own backend. The only provider wired up for V1. */
class SlateBackendProvider implements AnalyticsProvider {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  track(event: QueuedEvent) {
    this.queue.push(event);
    // Cap the queue so a long offline session can't grow unbounded; oldest go first.
    if (this.queue.length > MAX_BATCH * 4) this.queue = this.queue.slice(-MAX_BATCH * 4);
    this.ensureTimer();
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch(() => undefined);
    }, FLUSH_INTERVAL_MS);
  }

  async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.slice(0, MAX_BATCH);
    this.queue = this.queue.slice(batch.length);
    try {
      await api.post("/analytics/events", { events: batch });
    } catch {
      // Re-queue so the events aren't lost on a transient network failure,
      // but never retry forever — the cap in track() bounds this.
      this.queue = [...batch, ...this.queue];
    }
  }
}

const provider: AnalyticsProvider = new SlateBackendProvider();

export function track(name: AnalyticsEventName, properties?: AnalyticsProperties) {
  provider.track({ name, properties, occurredAt: new Date().toISOString() });
}

export function flushAnalytics() {
  return provider.flush();
}
