# SLATE — Store Graphics Plan

What Play requires, what exists, and exactly how to capture what does not.

**Status: NOT DONE.** No store graphics have been produced. Every asset below
has to be captured from a real device build, which requires the target-API
upgrade in `SLATE_PLAY_COMPLIANCE.md` §1 first. This document is the
instruction set for when that build exists — not a claim that the work is
finished.

---

## 1. What Play requires

| Asset | Spec | Status |
| --- | --- | --- |
| App icon (store) | 512 × 512 PNG, 32-bit, ≤ 1 MB, no alpha | **Missing** — design work |
| Feature graphic | 1024 × 500 PNG or JPEG, no alpha | **Missing** — design work |
| Phone screenshots | 2–8, 16:9 or 9:16, each side 320–3840 px | **Missing** — capture from device |
| 7-inch tablet | Optional | Skip — portrait phone app |
| 10-inch tablet | Optional | Skip |
| Promo video | Optional | Skip for v1 |

In the app bundle (present, but placeholder-grade): `assets/icon.png`,
`assets/adaptive-icon.png`, `assets/splash.png`. They are valid PNGs at the
right dimensions and the adaptive icon has its background colour configured, so
the build succeeds — but they are not finished brand artwork and should be
redrawn before launch.

---

## 2. Screenshot set — eight, in this order

Play shows the first two or three in search results. Lead with the thing that
distinguishes Slate: all three media types in one place.

### 1 — Discover: all three media types
**Screen:** Discover tab, scrolled so film, TV and game cards are visible
together with live countdowns.
**Caption:** `Films, TV and games. One place.`
**Why first:** it is the entire premise, legible in one glance.
**Setup:** seeded account following several upcoming titles, so countdowns
show days rather than "released".

### 2 — Title detail with countdown
**Screen:** an upcoming film or game with a large countdown, synopsis, hype
score, and Follow / Add to watchlist.
**Caption:** `Follow it. Watch the countdown.`
**Setup:** pick a title whose release date is a real, precise, future date, so
the countdown reads in days. Do not stage a fake date.

### 3 — Release Radar
**Screen:** Release Radar grouped by time window, with entries from all three
media types.
**Caption:** `Everything you're waiting for, in order.`

### 4 — Search across everything
**Screen:** search results for a term that legitimately returns a film, a
series and a game.
**Caption:** `Search once. Get all three.`
**Setup:** test the query on the real build first — the results have to be
genuine.

### 5 — Community with spoiler gate
**Screen:** a title's community feed with at least one spoiler-marked post
still hidden behind its tap-to-reveal state.
**Caption:** `Talk about it. Spoilers stay hidden.`
**Why:** the spoiler gate is the community feature users actually care about,
and showing it signals a moderated, considerate space.
**Setup:** post from a second seeded account so handles differ. Never show a
real user's content.

### 6 — Ask Slate
**Screen:** an Ask Slate conversation with a genuine question and its real
answer.
**Caption:** `Ask about anything you're tracking.`
**Setup:** capture a real exchange from the running app. Do not mock up an
answer the model did not produce.

### 7 — My Slate
**Screen:** the My Slate command centre — what is next, journey progress,
unread alerts.
**Caption:** `Your whole slate at a glance.`

### 8 — Slate Pro
**Screen:** the Pro upgrade screen showing both prices and the benefit list.
**Caption:** `More room to track. Nothing taken away.`
**Critical:** the prices in the screenshot must match the Play Console products
exactly ($7.99 / $59.99). A screenshot showing a stale price is a
misrepresentation. Re-capture this one whenever pricing changes.

---

## 3. Capture procedure

1. Build and install the release-configuration APK on a device or emulator at
   **1080 × 1920** or **1080 × 2400** (both are valid 9:16 ratios inside Play's
   size range).
2. Sign in as the **seeded demo account** from
   `SLATE_PLAY_REVIEWER_GUIDE.md` §1 — never a personal account, and never one
   whose community content belongs to a real user.
3. Set the device clock correctly. A wrong clock produces wrong countdowns,
   which is exactly the kind of inaccuracy this project has avoided everywhere
   else.
4. Clean the status bar: full battery, full signal, no notification icons.
   `adb shell cmd statusbar` demo mode, or Android Studio's screenshot tool.
5. Capture with `adb exec-out screencap -p > NN-name.png`.
6. Do not crop, upscale, or paint UI on top of the capture. Play permits an
   overlaid caption and a device frame; it does not permit inventing UI.
7. Verify every visible date, price and count against the real data before
   uploading.

---

## 4. Feature graphic (1024 × 500)

No screenshot content — it is a banner, and Play crops it unpredictably across
surfaces.

- **Background:** Slate's near-black `#0B0B0F`.
- **Wordmark:** SLATE, generous letter-spacing, centred, well inside the safe
  area (keep the centre ~800 × 400 clear of anything that must survive a crop).
- **Tagline:** `The home of entertainment hype`.
- **Accent:** the app's red `#FF4D4D`, used once — a rule under the wordmark or
  a single countdown motif.
- **Do not** put screenshots, device frames, review quotes, star ratings, or
  the word "Free" in it. Play rejects several of those outright.
- **No alpha channel.**

---

## 5. Store icon (512 × 512)

- Square, no alpha, no rounded corners — Play applies its own mask.
- Must read at 48 px. A full wordmark will not; a single strong mark will.
- Consistent with `assets/adaptive-icon.png` so the store and the launcher
  agree.
- No text beyond a monogram, no screenshots, no "new" or "sale" badges.

---

## 6. Rules these assets must not break

| Rule | Applies to |
| --- | --- |
| No fabricated UI, data, dates or prices | All screenshots |
| No real users' community content | Screenshots 5 and 7 |
| Prices must match Play Console exactly | Screenshot 8 |
| No third-party posters or key art as the primary subject | Feature graphic, icon — TMDB/IGDB artwork is licensed for in-app display, not for Slate's own store marketing |
| No claims the app does not deliver | Every caption |
| No Play Store badges or Google branding | Feature graphic |
| No "Editor's Choice", star ratings, or award claims | All |

---

## 7. Checklist

- [ ] Target-API upgrade done and a release-configuration build installed.
- [ ] Demo account seeded per the reviewer guide.
- [ ] Eight screenshots captured at 1080 × 1920 or 1080 × 2400.
- [ ] Every date, price and count on screen verified against real data.
- [ ] Status bar clean, device clock correct.
- [ ] 512 × 512 store icon produced, no alpha.
- [ ] 1024 × 500 feature graphic produced, no alpha.
- [ ] `assets/icon.png`, `adaptive-icon.png`, `splash.png` replaced with final
      artwork and the app rebuilt.
- [ ] Screenshot 8's prices re-checked against Play Console products.
