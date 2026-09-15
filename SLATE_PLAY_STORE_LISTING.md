# SLATE — Google Play Store Listing

Copy for Play Console → Store presence → Main store listing. Every claim below
describes a feature that ships in this build. Nothing here promises push
notifications (not built), ads-free-as-a-benefit (there are no ads in this
release), or any feature behind a flag.

`[OPERATOR]` marks a value only the operator can supply.

---

## App name (30 characters max)

```
Slate: Movies, TV & Games
```
25 characters.

Alternative if that name is taken:

```
Slate — Entertainment Hype
```
26 characters.

---

## Short description (80 characters max)

```
Track every movie, show and game you're hyped for. Countdowns, alerts, hype.
```
75 characters.

Alternatives:

```
The home of entertainment hype. Movies, TV and games in one countdown.
```
70 characters.

```
One watchlist for films, series and games. Never miss a release again.
```
69 characters.

---

## Full description (4000 characters max)

```
THE HOME OF ENTERTAINMENT HYPE

Films, television and games all have release dates worth waiting for — but
they live in different apps, different calendars and different corners of the
internet. Slate puts all three in one place, and keeps the wait interesting.

Follow what you're excited about. Watch the countdown. Find out the moment
something changes.

ONE WATCHLIST FOR ALL THREE
Films, series and games sit side by side, not in separate tabs pretending to
be one app. Search once and get results across everything. Mark things as
want to watch, watching, completed or dropped, and see the whole list in one
place.

REAL COUNTDOWNS, HONEST DATES
Follow a title and Slate counts down to it. When a studio only says "Q3" or
"2027", Slate says that too — it never invents a date to make a countdown look
tidy. Film and television information comes from TMDB; game information comes
from IGDB.

RELEASE RADAR
Everything you're tracking, grouped by when it lands, across all three media
types at once. It's the answer to "what's actually coming soon?" without
opening three apps.

HYPE SCORE
How much anticipation a title is actually carrying, built from real signals
rather than a number someone made up.

WATCH AND PLAY JOURNEYS
Want to get through a franchise before the new one lands? Slate builds the
order from real release and franchise data and tracks how far you've got,
using what you've actually marked completed.

ASK SLATE
An assistant for what you're tracking. Ask what to watch next, what a series
is about, or what you need to have seen before a sequel. It sticks to
entertainment and tells you when it doesn't know instead of making something
up.

A COMMUNITY THAT MARKS ITS SPOILERS
Post theories, predictions and reviews about the things you're waiting for.
Spoilers are marked and hidden behind a tap based on your own setting — so you
can join a conversation about a series you're three episodes behind on.
Report anything that breaks the rules, and block anyone you'd rather not see.

SLATE PRO
Slate is a complete app before you pay anything: full discovery, search,
details, countdowns, the community, a real watchlist and a two-week Release
Radar. Nothing free gets taken away.

Pro is for people tracking a lot:
• Unlimited follows and an unlimited watchlist
• A full year of Release Radar instead of two weeks
• Unlimited saved journeys
• Far more Ask Slate every day
• Personalised recommendations and the full My Slate command centre
• Per-title spoiler controls instead of one global setting

Monthly or annual. Billed through Google Play, cancel any time in the Play
Store.

YOUR DATA
Slate asks for two Android permissions: internet, and billing. No location, no
camera, no microphone, no contacts, no advertising ID. This version contains
no ads. You can delete your account and your data from inside the app, or from
Slate's website without installing anything — immediately, without emailing
anyone.

Slate uses the TMDB API but is not endorsed or certified by TMDB. Game data is
provided by IGDB. Slate is not endorsed or certified by IGDB or Twitch.
```

Approximately 2,750 characters — within the 4,000 limit with room for
localisation growth.

---

## Subscription product setup

Create both in Play Console → Monetise → Subscriptions. Base plan prices must
match `apps/backend/src/config/products.ts`, which is the single source of
truth the app reads.

| Product ID | Price (USD) | Period | Notes |
| --- | --- | --- | --- |
| `SLATE_PRO_MONTHLY` | 7.99 | P1M | Auto-renewing |
| `SLATE_PRO_YEARLY` | 59.99 | P1Y | Auto-renewing |

The annual saving Slate displays — **37%**, **$35.89**, **$5.00/month
equivalent** — is *computed* from these two numbers by `annualSavings()`, not
written down anywhere. Change a price in Play Console and in `products.ts`
together and the marketing claim follows automatically. Never hardcode a price
in copy.

**Subscription description (Play Console field):**

```
Slate Pro removes every limit on how much you track: unlimited follows and
watchlist, a full year of Release Radar, unlimited journeys, far more Ask
Slate, personalised recommendations and per-title spoiler controls. Renews
automatically; cancel any time in the Play Store.
```

---

## Categorisation and contact

| Field | Value |
| --- | --- |
| App category | Entertainment |
| Tags | Movies, TV, Video games, Entertainment news |
| Content rating | From the questionnaire — see `SLATE_PLAY_COMPLIANCE.md` §3.14. Expect Teen/PEGI 12, driven by the social feature |
| Target audience | 13+ — not a Families app |
| Contains ads | **No** |
| In-app purchases | **Yes** — $7.99–$59.99 per item |
| Email address | `[OPERATOR]` |
| Website | `[OPERATOR]` `https://<your-domain>` |
| Phone | Optional — omit unless a monitored line exists |
| Privacy policy | `[OPERATOR]` `https://<your-domain>/privacy` |

---

## Store listing keywords

Play does not have a keyword field; the listing text itself is indexed. These
terms are already worked into the copy naturally rather than stuffed:

movie tracker · TV show tracker · game release dates · watchlist · countdown ·
upcoming releases · release calendar · what to watch · anticipated games ·
entertainment news · spoiler-free · franchise watch order

---

## Release notes — version 1.0.0

```
The first release of Slate.

Track films, TV and games in one watchlist. Follow what you're waiting for and
watch the countdown. Release Radar shows everything that's coming. Ask Slate
answers questions about what you're tracking. Join spoiler-marked discussions
with people waiting for the same things.
```

---

## Claims deliberately left out, and why

Written down so nobody adds them back without adding the feature first.

| Not claimed | Reason |
| --- | --- |
| "Get push notifications the moment a date changes" | This version has in-app notifications only. Claiming push would be a misrepresentation and a likely rejection |
| "Ad-free with Pro" | There are no ads in this release, so it is not a benefit. The Pro tier does carry an ad-free flag for when a network is added; the listing will change at the same time |
| "AI-powered recommendations" | Recommendations are computed from genres and tracking history. Ask Slate is the AI feature and is described as what it is |
| Any specific title, studio or franchise name | Using one in the listing implies an endorsement Slate does not have |
| "Thousands of titles" or any catalogue-size claim | The catalogue is TMDB's and IGDB's, and the number would be unverifiable |
