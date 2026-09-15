/**
 * Ad provider abstraction. Product code renders <AdSlot/> and never touches
 * a vendor SDK, so wiring up AdMob later means implementing this interface
 * once rather than editing screens.
 *
 * No real ad network is wired up yet: AdMob requires a Google AdMob account,
 * an app ID, and ad unit IDs, plus the react-native-google-mobile-ads native
 * module (which needs a development build, not Expo Go). Until those exist,
 * `NoOpAdProvider` is active and ads render nothing at all — deliberately,
 * rather than shipping a fake "Your ad here" placeholder that would look
 * broken to real users. See SLATE_RISKS.md.
 */
export type AdPlacement = "home_feed" | "discover_feed" | "community_feed";

export interface AdProvider {
  readonly isConfigured: boolean;
  /** Returns true if an ad is available to render for this placement right now. */
  canShow(placement: AdPlacement): boolean;
}

class NoOpAdProvider implements AdProvider {
  readonly isConfigured = false;
  canShow() {
    return false;
  }
}

export const adProvider: AdProvider = new NoOpAdProvider();

/**
 * How many content items appear between ad slots in a feed. Kept here so
 * ad density is one number to tune, not a decision re-made per screen.
 * Slate's cinematic feel matters more than squeezing in impressions.
 */
export const AD_FREQUENCY = {
  home_feed: 6,
  discover_feed: 8,
  community_feed: 5,
} as const satisfies Record<AdPlacement, number>;
