#!/usr/bin/env node
/**
 * Fails a release build that is not pointed at real infrastructure.
 *
 * Without this, a `production` build succeeds with EXPO_PUBLIC_API_BASE_URL
 * unset or left at a placeholder, and the failure only appears once the AAB
 * is on a user's device — after review, after rollout. Metro inlines these
 * values at bundle time, so the only place to catch it is before the bundle
 * is built.
 *
 * Runs automatically as EAS's `eas-build-pre-install` hook. Only release
 * profiles are checked; development builds legitimately point at a local
 * emulator address.
 */

const profile = process.env.EAS_BUILD_PROFILE ?? "";
const RELEASE_PROFILES = new Set(["production", "preview"]);

if (!RELEASE_PROFILES.has(profile)) {
  console.log(`check-release-env: profile "${profile || "(none)"}" is not a release profile — skipping.`);
  process.exit(0);
}

/** Hosts reserved by RFC 2606/6761 for documentation. Never real infrastructure. */
const PLACEHOLDER_TLDS = [".example", ".invalid", ".test", ".localhost"];

const errors = [];

function checkUrl(name, { required, mustBeHttps }) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    if (required) {
      errors.push(`${name} is not set. A ${profile} build must point at real infrastructure.`);
    }
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${name} is not a valid URL: "${value}"`);
    return;
  }

  if (mustBeHttps && url.protocol !== "https:") {
    errors.push(`${name} must use https:// — Android blocks cleartext traffic and Slate release builds refuse it. Got "${value}".`);
  }

  if (PLACEHOLDER_TLDS.some((tld) => url.hostname.endsWith(tld))) {
    errors.push(`${name} points at a reserved placeholder host ("${url.hostname}"). Replace it with the real host before building.`);
  }

  if (url.hostname === "localhost" || /^(10\.|127\.|192\.168\.)/.test(url.hostname)) {
    errors.push(`${name} points at a local address ("${url.hostname}"), which no user's device can reach.`);
  }
}

checkUrl("EXPO_PUBLIC_API_BASE_URL", { required: true, mustBeHttps: true });
// Optional: without it the app hides its legal links rather than showing
// dead ones. A production build should still have it — Play requires the
// privacy policy and account-deletion pages to be reachable.
checkUrl("EXPO_PUBLIC_WEB_BASE_URL", { required: profile === "production", mustBeHttps: true });

if (errors.length > 0) {
  console.error(`\ncheck-release-env: refusing to build profile "${profile}" — ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  ERROR ${e}`);
  console.error("\nSet these as EAS environment variables or secrets and build again.\n");
  process.exit(1);
}

console.log(`check-release-env: profile "${profile}" is pointed at real infrastructure.`);
