#!/usr/bin/env node
/**
 * Pre-deployment check for Slate's public site.
 *
 * Google Play reviewers open these pages. A page that still says
 * "[NOT CONFIGURED: legalEntity]" is a rejection, and an account-deletion
 * page whose form cannot reach an API is a policy violation. This script
 * fails the build rather than letting either ship.
 *
 * Usage:  node web/verify-config.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const REQUIRED = {
  legalEntity: "Registered name of the entity operating Slate.",
  contactEmail: "Monitored inbox for privacy and support enquiries.",
  copyrightEmail: "Inbox for copyright notices (may equal contactEmail).",
  apiBaseUrl: "Origin of the Slate API — the deletion form posts here.",
  siteBaseUrl: "Public origin of this site.",
  jurisdiction: "Governing law named in the Terms.",
  effectiveDate: "ISO date the legal documents took effect.",
};

/** Filled in only once the app is live; warned about, not fatal. */
const OPTIONAL = {
  playStoreUrl: "Play Store listing URL — fill in after the app is published.",
};

function loadConfig() {
  const source = readFileSync(join(here, "config.js"), "utf8");
  const sandbox = { window: {} };
  // config.js is a plain assignment to window.SLATE_CONFIG with no imports.
  new Function("window", source)(sandbox.window);
  if (!sandbox.window.SLATE_CONFIG) {
    throw new Error("config.js did not set window.SLATE_CONFIG");
  }
  return sandbox.window.SLATE_CONFIG;
}

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

const cfg = loadConfig();
const errors = [];
const warnings = [];

for (const [key, why] of Object.entries(REQUIRED)) {
  if (isBlank(cfg[key])) errors.push(`config.js: "${key}" is blank — ${why}`);
}
for (const [key, why] of Object.entries(OPTIONAL)) {
  if (isBlank(cfg[key])) warnings.push(`config.js: "${key}" is blank — ${why}`);
}

for (const key of ["apiBaseUrl", "siteBaseUrl", "playStoreUrl"]) {
  const value = cfg[key];
  if (isBlank(value)) continue;
  if (!/^https:\/\//.test(value)) {
    errors.push(`config.js: "${key}" must be an https:// URL (got "${value}")`);
  }
  if (/\/$/.test(value)) {
    errors.push(`config.js: "${key}" must not end with a trailing slash`);
  }
}

if (!isBlank(cfg.effectiveDate) && !/^\d{4}-\d{2}-\d{2}$/.test(cfg.effectiveDate)) {
  errors.push(`config.js: "effectiveDate" must be YYYY-MM-DD (got "${cfg.effectiveDate}")`);
}

for (const key of ["contactEmail", "copyrightEmail"]) {
  const value = cfg[key];
  if (!isBlank(value) && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value)) {
    errors.push(`config.js: "${key}" does not look like an email address (got "${value}")`);
  }
}

// Every page Play policy or the app links to must exist on disk.
const REQUIRED_PAGES = [
  "index.html",
  "privacy.html",
  "terms.html",
  "community-guidelines.html",
  "copyright.html",
  "delete-account.html",
  "support.html",
];
const present = new Set(readdirSync(here));
for (const file of REQUIRED_PAGES) {
  if (!present.has(file)) errors.push(`missing page: web/${file}`);
}

// Catch a {{token}} that no config key can ever fill.
const known = new Set([...Object.keys(REQUIRED), ...Object.keys(OPTIONAL)]);
for (const file of REQUIRED_PAGES.filter((f) => present.has(f))) {
  const html = readFileSync(join(here, file), "utf8");
  for (const [, token] of html.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!known.has(token)) errors.push(`web/${file}: unknown placeholder {{${token}}}`);
  }
}

for (const w of warnings) console.warn(`WARN  ${w}`);

if (errors.length > 0) {
  console.error(`\nweb/ is NOT ready to deploy — ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  ERROR ${e}`);
  console.error("\nFill these in in web/config.js and run this again.\n");
  process.exit(1);
}

console.log(`web/ is ready to deploy${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`);
