/**
 * Slate's public-facing legal and support URLs.
 *
 * These are read from EXPO_PUBLIC_* build-time env vars (set per EAS
 * profile) rather than hardcoded, because the production domain is an
 * operational decision, not a code constant.
 *
 * IMPORTANT: none of these are live yet. `isConfigured` is false until a
 * real domain is supplied, and the UI uses that to avoid presenting a dead
 * link as though it works. Google Play requires the privacy policy and the
 * external account-deletion URL to resolve publicly before submission —
 * see SLATE_PRODUCTION_CONFIGURATION.md.
 */
const BASE = process.env.EXPO_PUBLIC_WEB_BASE_URL;

export const legalLinks = {
  isConfigured: Boolean(BASE),
  privacyPolicy: BASE ? `${BASE}/privacy` : null,
  terms: BASE ? `${BASE}/terms` : null,
  communityGuidelines: BASE ? `${BASE}/community-guidelines` : null,
  copyright: BASE ? `${BASE}/copyright` : null,
  accountDeletion: BASE ? `${BASE}/delete-account` : null,
  support: BASE ? `${BASE}/support` : null,
} as const;

/** Support contact, also build-time configured. Never invent an address. */
export const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? null;
