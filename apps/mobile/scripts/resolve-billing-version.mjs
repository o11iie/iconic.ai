#!/usr/bin/env node
/**
 * Reports the Google Play Billing Library version Slate will actually link,
 * by walking the real artifact chain:
 *
 *   react-native-iap  ->  openiap-versions.json (google)
 *                     ->  io.github.hyochan.openiap:openiap-google:<v>
 *                     ->  its POM's com.android.billingclient dependency
 *
 * Why this exists: since react-native-iap 14 the Billing Library is a
 * transitive dependency of openiap-google, so it appears in no file in this
 * repository. `./gradlew :app:dependencies` is the authoritative check, but it
 * needs a full Android toolchain; this needs only Maven Central and answers
 * the one question that matters for Play compliance.
 *
 * Google's enforced minimum rises on a published schedule, so run this before
 * every release and compare against Play Console.
 *
 * Usage:  node apps/mobile/scripts/resolve-billing-version.mjs [--min 8]
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const MAVEN = "https://repo1.maven.org/maven2";

function fail(message) {
  console.error(`resolve-billing-version: ${message}`);
  process.exit(1);
}

const minMajorArg = process.argv.indexOf("--min");
const minMajor = minMajorArg !== -1 ? Number(process.argv[minMajorArg + 1]) : null;

let iapRoot;
try {
  iapRoot = dirname(require.resolve("react-native-iap/package.json"));
} catch {
  fail("react-native-iap is not installed.");
}

const iapVersion = JSON.parse(readFileSync(join(iapRoot, "package.json"), "utf8")).version;

// react-native-iap 12/13 pinned the Billing version directly in their own
// gradle.properties; 14+ delegate to openiap.
let source;
let openiapVersion = null;
try {
  openiapVersion = JSON.parse(readFileSync(join(iapRoot, "openiap-versions.json"), "utf8")).google;
  source = `openiap-google:${openiapVersion}`;
} catch {
  const props = readFileSync(join(iapRoot, "android", "gradle.properties"), "utf8");
  const pinned = /RNIap_playBillingSdkVersion\s*=\s*([\d.]+)/.exec(props);
  if (!pinned) fail("could not determine how this react-native-iap resolves Play Billing.");
  report(iapVersion, "pinned in react-native-iap's own gradle.properties", `com.android.billingclient:billing-ktx`, pinned[1]);
}

const pomUrl = `${MAVEN}/io/github/hyochan/openiap/openiap-google/${openiapVersion}/openiap-google-${openiapVersion}.pom`;
const res = await fetch(pomUrl);
if (!res.ok) fail(`could not fetch ${pomUrl} (HTTP ${res.status}).`);
const pom = await res.text();

const dependency = [...pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)]
  .map((m) => m[1])
  .map((body) => ({
    groupId: /<groupId>(.*?)<\/groupId>/.exec(body)?.[1],
    artifactId: /<artifactId>(.*?)<\/artifactId>/.exec(body)?.[1],
    version: /<version>(.*?)<\/version>/.exec(body)?.[1],
    scope: /<scope>(.*?)<\/scope>/.exec(body)?.[1] ?? "compile",
  }))
  .find((d) => d.groupId === "com.android.billingclient");

if (!dependency) fail(`no com.android.billingclient dependency found in ${pomUrl}.`);

report(iapVersion, source, `${dependency.groupId}:${dependency.artifactId}`, dependency.version, dependency.scope);

function report(iap, via, coordinate, version, scope) {
  const major = Number(String(version).split(".")[0]);
  console.log(`react-native-iap      ${iap}`);
  console.log(`resolves via          ${via}`);
  console.log(`Play Billing Library  ${coordinate}:${version}${scope ? ` (${scope})` : ""}`);

  if (minMajor !== null) {
    if (Number.isNaN(major) || major < minMajor) {
      console.error(`\nFAIL: Billing Library ${version} is below the required major ${minMajor}.`);
      process.exit(1);
    }
    console.log(`\nOK: Billing Library major ${major} meets the required minimum ${minMajor}.`);
  }
  process.exit(0);
}
