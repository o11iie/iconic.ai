#!/usr/bin/env node
/**
 * Inspects a built Android App Bundle and fails on anything that must not
 * ship. Run it on the artifact before uploading to Play.
 *
 *   node apps/mobile/scripts/verify-aab.mjs path/to/app.aab
 *
 * Why this exists: `expo prebuild` emits Expo's template default, in which
 * the *release* build type uses `signingConfigs.debug`. EAS replaces that at
 * build time, but a local `./gradlew bundleRelease` without configured
 * signing produces a debug-signed artifact that looks completely normal until
 * Play rejects it — or worse, until it is installed and cannot be updated.
 * That is the single most expensive mistake available at this stage, and it
 * is invisible without looking inside the file.
 *
 * WHAT THIS CHECKS (an AAB is a zip, so these need no Android SDK):
 *   - the file really is an app bundle
 *   - it is signed, and NOT with the Android debug key
 *   - the JavaScript bundle contains no server secret, no localhost and no
 *     cleartext http:// endpoint
 *   - the manifest declares no permission outside the expected set
 *
 * WHAT THIS CANNOT CHECK without the Android SDK, and what to run instead:
 *   - exact targetSdk / versionCode / versionName as the platform parses them
 *       bundletool dump manifest --bundle app.aab
 *   - full signature verification including v2/v3 scheme details
 *       apksigner verify --print-certs --verbose app.apks
 * Both are listed in the output so the operator finishes the job properly
 * rather than trusting this script for more than it knows.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node verify-aab.mjs <path-to-.aab>");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`verify-aab: no such file: ${file}`);
  process.exit(2);
}

/** Permissions Slate is expected to ship. Anything else is a finding. */
const EXPECTED_PERMISSIONS = new Set([
  "android.permission.INTERNET",
  "android.permission.VIBRATE",
  "com.android.vending.BILLING",
]);

/** Substrings that must never appear in a shipped JavaScript bundle. */
const FORBIDDEN = [
  { label: "OpenAI key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { label: "Google service-account private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "Supabase service-role key", re: /service_role/ },
  { label: "localhost API host", re: /https?:\/\/localhost[:/]/ },
  { label: "emulator loopback host", re: /https?:\/\/10\.0\.2\.2[:/]/ },
  { label: "reserved placeholder host", re: /https?:\/\/[\w.-]+\.(?:example|invalid|test)\b/ },
];

const failures = [];
const notes = [];
const facts = {};

function run(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// --- structure -------------------------------------------------------------
let listing;
try {
  listing = run("unzip", ["-Z1", file]);
} catch {
  failures.push("not a readable zip archive — an .aab is a zip; this file is not");
  report();
}
const entries = listing.split("\n").filter(Boolean);
facts["entries"] = String(entries.length);

const looksLikeBundle = entries.includes("BundleConfig.pb") && entries.some((e) => e.startsWith("base/"));
if (!looksLikeBundle) {
  failures.push("missing BundleConfig.pb or base/ — this is not an Android App Bundle (an APK, maybe?)");
}

// --- signing (the critical one) --------------------------------------------
const certEntries = entries.filter((e) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e));
if (certEntries.length === 0) {
  failures.push("UNSIGNED — no META-INF signature block. Play will reject this.");
  facts["signing"] = "unsigned";
} else {
  // `-jarfile` reads the PKCS#7 block out of the signed archive itself.
  // Pointing `-printcert -file` at the raw extracted .RSA does not parse, and
  // an earlier version of this script did exactly that, silently fell through
  // to the else-branch, and reported a debug-signed bundle as release-signed —
  // a false PASS on the one check this script exists to perform.
  let printed = "";
  let parsed = false;
  try {
    printed = run("keytool", ["-printcert", "-jarfile", file]);
    parsed = /Owner:/.test(printed);
  } catch {
    parsed = false;
  }

  if (!parsed) {
    // Fail closed. A signing check that cannot read the signature must never
    // report the artifact as correctly signed.
    failures.push(
      "SIGNER UNVERIFIABLE — keytool could not read the certificate. " +
        "Do not upload until `apksigner verify --print-certs` confirms the signer.",
    );
    facts["signing"] = "unverifiable (treated as failure)";
  } else {
    const owner = /Owner:\s*(.+)/.exec(printed)?.[1]?.trim() ?? "unknown";
    const issuer = /Issuer:\s*(.+)/.exec(printed)?.[1]?.trim() ?? "unknown";
    const sha256 = /SHA256:\s*([0-9A-Fa-f:]+)/.exec(printed)?.[1] ?? "unknown";
    facts["signer"] = owner;
    facts["signature SHA-256"] = sha256;

    // The Android debug keystore is a fixed, publicly known identity, so
    // anyone can forge updates for anything signed with it.
    if (/CN=Android Debug/i.test(owner) || /CN=Android Debug/i.test(issuer)) {
      failures.push(
        "DEBUG-SIGNED — signed with the Android debug key (CN=Android Debug). " +
          "Play rejects this, and the key is public. Configure real release signing.",
      );
      facts["signing"] = "DEBUG (invalid for release)";
    } else {
      facts["signing"] = "release";
    }
  }
}

// --- shipped JavaScript ----------------------------------------------------
const bundleEntry = entries.find((e) => /assets\/index\.android\.bundle$/.test(e));
if (!bundleEntry) {
  notes.push("no index.android.bundle found — if this build uses a different bundler output, check it by hand");
} else {
  const js = run("unzip", ["-p", file, bundleEntry]);
  facts["js bundle bytes"] = String(js.length);
  for (const { label, re } of FORBIDDEN) {
    const hit = re.exec(js);
    if (hit) failures.push(`${label} found in the shipped JS bundle: ${hit[0].slice(0, 60)}`);
  }
  const httpsHosts = [...new Set([...js.matchAll(/https:\/\/[\w.-]+/g)].map((m) => m[0]))];
  const httpHosts = [...new Set([...js.matchAll(/http:\/\/[\w.-]+/g)].map((m) => m[0]))]
    .filter((h) => !/127\.0\.0\.1|localhost/.test(h));
  if (httpHosts.length > 0) {
    failures.push(`cleartext http:// endpoint(s) in the bundle: ${httpHosts.slice(0, 3).join(", ")}`);
  }
  facts["https hosts in bundle"] = String(httpsHosts.length);
}

// --- manifest permissions --------------------------------------------------
// The manifest is protobuf-encoded in an AAB, but permission names survive as
// plain strings, which is enough to spot one that should not be there.
const manifestEntry = entries.find((e) => e === "base/manifest/AndroidManifest.xml");
if (!manifestEntry) {
  notes.push("base/manifest/AndroidManifest.xml not found — check permissions with bundletool");
} else {
  const raw = run("unzip", ["-p", file, manifestEntry]);
  const found = [...new Set([...raw.matchAll(/(?:android|com\.android\.vending)\.permission\.[A-Z_]+/g)].map((m) => m[0]))];
  const unexpected = found.filter((p) => !EXPECTED_PERMISSIONS.has(p));
  facts["permissions"] = found.join(", ") || "none detected";
  if (unexpected.length > 0) {
    failures.push(`unexpected permission(s): ${unexpected.join(", ")}`);
  }
}

report();

function report() {
  console.log(`verify-aab: ${file}\n`);
  for (const [k, v] of Object.entries(facts)) console.log(`  ${k.padEnd(24)} ${v}`);
  if (notes.length) {
    console.log("\n  notes:");
    for (const n of notes) console.log(`    - ${n}`);
  }
  console.log("\n  still to run with the Android SDK (this script cannot):");
  console.log("    bundletool dump manifest --bundle <aab>      # targetSdk, versionCode, versionName");
  console.log("    apksigner verify --print-certs --verbose     # full v2/v3 signature verification");

  if (failures.length > 0) {
    console.error(`\nFAIL — ${failures.length} problem(s):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log("\nPASS — no blocking problem found in what this script can inspect.");
  process.exit(0);
}
