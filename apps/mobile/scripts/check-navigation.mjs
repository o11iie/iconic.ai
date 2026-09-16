#!/usr/bin/env node
/**
 * Fails if any screen calls `navigation.navigate("X")` for a route the stack
 * it is registered in does not declare.
 *
 * React Navigation does not catch this at compile time when a screen is
 * reused across several stacks — the types come from the stack's own
 * ParamList, and a screen typed against one stack still renders in another.
 * The failure only appears when a user taps, as "The action NAVIGATE was not
 * handled by any navigator".
 *
 * This has now bitten Slate twice: AskSlate/ProUpgrade missing from Search and
 * Watchlist, and NewPost/PostDetail missing from MySlate. Both were found by
 * inspection rather than by a test, which is why this exists.
 *
 * Usage: node apps/mobile/scripts/check-navigation.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const componentToFile = {};
for (const dir of ["screens/main", "screens/auth"]) {
  for (const file of readdirSync(join(root, dir))) {
    if (!file.endsWith(".tsx")) continue;
    const path = join(root, dir, file);
    for (const m of readFileSync(path, "utf8").matchAll(/export function (\w+)/g)) {
      componentToFile[m[1]] = path;
    }
  }
}

const problems = [];
for (const file of readdirSync(join(root, "navigation"))) {
  if (!/Stack\.tsx$/.test(file)) continue;
  const src = readFileSync(join(root, "navigation", file), "utf8");
  const screens = [...src.matchAll(/<Stack\.Screen\s+name="(\w+)"\s+component=\{(\w+)\}/g)];
  const registered = new Set(screens.map((m) => m[1]));

  for (const [, , component] of screens) {
    const path = componentToFile[component];
    if (!path) continue;
    const targets = new Set(
      [...readFileSync(path, "utf8").matchAll(/navigation\.navigate\(\s*"(\w+)"/g)].map((m) => m[1]),
    );
    for (const target of targets) {
      if (!registered.has(target)) {
        problems.push(`${file}: ${component} navigates to "${target}", which this stack does not register`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`check-navigation: ${problems.length} unreachable navigation target(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nRegister the route in that stack, or the tap will do nothing at runtime.\n");
  process.exit(1);
}
console.log("check-navigation: every navigation target is registered in its stack.");
