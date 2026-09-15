/**
 * Slate public site configuration.
 *
 * EVERY VALUE BELOW IS DELIBERATELY BLANK. Slate's legal entity, contact
 * address, domain and governing jurisdiction are business facts that only
 * the operator knows — inventing them would put false representations in
 * front of users and Google Play reviewers.
 *
 * Fill these in, then run `node web/verify-config.mjs` before deploying.
 * The pages render a loud warning banner and refuse to submit the deletion
 * form while anything required is still blank.
 */
window.SLATE_CONFIG = {
  /** Registered name of the entity that operates Slate. */
  legalEntity: "",

  /** Monitored inbox for privacy, support and general enquiries. */
  contactEmail: "",

  /** Inbox for DMCA / copyright notices. May be the same as contactEmail. */
  copyrightEmail: "",

  /** Origin of the Slate API, e.g. "https://api.example.com". No trailing slash. */
  apiBaseUrl: "",

  /** Public origin of this site, e.g. "https://example.com". No trailing slash. */
  siteBaseUrl: "",

  /** Governing law for the Terms, e.g. "England and Wales". */
  jurisdiction: "",

  /** ISO date these documents took effect, e.g. "2026-01-31". */
  effectiveDate: "",

  /** Play Store listing URL, filled in once the app is published. */
  playStoreUrl: "",
};
