# SLATE — Google Play Reviewer Guide

Paste the relevant parts of this into **Play Console → App content → App
access** and **Store presence → Main store listing → App access instructions**.

Slate is entirely account-gated: nothing is visible before signing in. Without
a demo account a reviewer sees a login screen and nothing else, which is a
common cause of rejection. Supply credentials.

---

## 1. What to enter in Play Console → App access

Select **"All or some functionality is restricted."**

Add one instruction set:

| Field | Value |
| --- | --- |
| Name | Full app access |
| Username | `[OPERATOR]` demo account email |
| Password | `[OPERATOR]` demo account password |
| Any other instructions | Paste §2 below |

Create the demo account through the app's normal signup so it is a real
account. Then, so the reviewer sees the app as it is meant to be seen:

1. Follow 4–6 titles across **all three** media types — at least one film, one
   TV series and one game, ideally with upcoming release dates so countdowns
   and Release Radar have content.
2. Add 5–8 watchlist entries with a mix of statuses.
3. Set 3–4 favourite genres in Profile.
4. Write one community post and one comment so the community tab is not empty.
5. Leave a few Ask Slate messages unused so the reviewer can try it.

Do not grant the demo account Pro in the database. Give it Pro the way a user
would — a Play **licence tester** account (Play Console → Setup → Licence
testing), so the reviewer can complete a real, unbilled purchase.

---

## 2. Instructions to paste

> Slate requires an account because every feature is personal: your follows,
> your watchlist, your journeys and your notifications. Sign in with the
> credentials above.
>
> **Push notifications:** this version delivers notifications inside the app
> only — Notifications is reachable from the Discover tab. There is no
> background push and the app does not request the notification permission.
>
> **Account deletion** is at Profile → Settings → Delete account, and also at
> `https://<your-domain>/delete-account` without installing the app. It
> deletes immediately and requires no contact with support.
>
> **Slate Pro** is a Google Play subscription. The account above is registered
> as a licence tester, so a purchase can be completed without being charged.
> Pro is granted only after Slate's server verifies the purchase with Google's
> Android Publisher API — a client that claims to be Pro receives nothing.
>
> **Entertainment data** comes from TMDB (film and television) and IGDB
> (games). Slate does not author metadata; release dates are shown at the
> precision the provider supplies.

---

## 3. Guided walkthrough

Five minutes, in order, covering everything a reviewer is likely to check.

### Discovery — 30 seconds
Sign in. **Discover** opens on trending and upcoming titles across films, TV
and games with live countdowns. Scroll to **For You** for genre-based
recommendations.

### Search — 30 seconds
**Search** tab. Try `dune`, then `zelda`. Results span all three media types
from one query.

### Title detail, follow and watchlist — 45 seconds
Open any result. The detail screen shows the real synopsis, release date and
countdown; games additionally show platforms, developer and IGDB's anticipation
signal. Tap **Follow**, then **Add to watchlist** and set a status.

### Community, reporting and blocking — 60 seconds
On a title detail screen, scroll to the community section and open a post.

- **Report** offers five reasons and routes to a moderation queue.
- **Block @handle** immediately hides that account's posts and comments from
  this reviewer's view, everywhere. The blocked account is not notified.
- Manage or undo blocks at **Profile → Settings → Blocked accounts**.

Spoiler-marked posts are hidden behind a tap according to the account's spoiler
setting.

### Ask Slate (AI) — 45 seconds
Open **Ask Slate** from Discover or from any title. Ask something about a
title being tracked. The assistant is limited to entertainment topics and is
instructed to say it does not know rather than invent facts. Free accounts get
5 messages a day; the limit is enforced server-side.

### Release Radar and My Slate — 45 seconds
**My Slate** is the command centre: what is next across everything tracked,
journey progress and unread alerts. Free shows a 14-day radar horizon; Pro
extends it to a year.

### Slate Pro — 60 seconds
**Profile → Upgrade to Pro**, or trigger a paywall naturally by following an
11th title. The screen states both prices, the renewal period and how to
cancel. Complete the purchase with the licence-tester account. Pro appears only
after Slate's server verifies with Google.

### Settings, legal and deletion — 45 seconds
**Profile → Settings, privacy & account**:

- Notification master toggle plus five per-type toggles.
- Legal & support: Privacy Policy, Terms, Community Guidelines, Copyright,
  Support.
- Subscription: opens Google Play's subscription screen.
- Blocked accounts.
- **Delete account** — password confirmation, then immediate deletion.

---

## 4. Answers to questions reviewers ask

**Why does the app require an account?**
Every feature is per-user state — follows, watchlist, journeys, notifications,
AI history. There is no meaningful signed-out mode to offer.

**Where is account deletion?**
Profile → Settings → Delete account, and on the web at
`https://<your-domain>/delete-account`. Immediate, no support contact.

**What happens to a user's posts when they delete their account?**
The text is removed and replaced with `[deleted]`, and authorship moves to an
anonymous account. Their words and identity are gone. The thread survives
because deleting it outright would also destroy replies written by other
users who never requested deletion.

**Does deleting the account cancel a Slate Pro subscription?**
No — only Google can cancel a Play subscription. The app says so in the
deletion confirmation, in the success message when a subscription was active,
on the deletion web page, and in the Terms.

**Is user data sold or shared with advertisers?**
No. There is no advertising SDK in this release and no data-broker
relationship. Third-party recipients are OpenAI (Ask Slate messages only),
TMDB and IGDB (search terms and title IDs, server-to-server) and Google Play
(purchase verification). Itemised in the privacy policy.

**Does the app contain ads?**
No. Declared as **No** in the Data safety form.

**Is there a way to block abusive users?**
Yes — **Block** on any post, managed at Profile → Settings → Blocked accounts.
Blocking is one-directional and silent, and takes effect immediately without
waiting for moderation.

**How is AI content controlled?**
Ask Slate is constrained by a system prompt to entertainment topics and
instructed to decline rather than fabricate facts about titles, dates, cast or
plot. Usage is capped per day and rate-limited. The AI provider key exists only
on Slate's server; the app calls Slate's own API.

**What permissions does the app need?**
`INTERNET` and `com.android.vending.BILLING`. Location, camera and microphone
are explicitly blocked in the build configuration so no dependency can add
them.

**Where does the entertainment data come from?**
TMDB for film and television, IGDB for games, attributed in-app and at
`https://<your-domain>/copyright`. Slate is not endorsed or certified by TMDB,
IGDB or Twitch.

**Can the app be used without paying?**
Yes. The free tier is a complete product: full discovery, search, detail
pages, countdowns, community, 10 follows, 25 watchlist items, 5 Ask Slate
messages a day, a 14-day Release Radar and one saved journey. Pro adds scale
and depth; it does not remove anything free users have.

---

## 5. Before submitting — check each of these

- [ ] Demo account created through normal signup and verified working.
- [ ] Demo account seeded with follows, watchlist entries and a post.
- [ ] Demo account registered as a Play licence tester.
- [ ] Credentials entered under App access, spelled exactly.
- [ ] `<your-domain>` replaced with the real domain everywhere in §2 and §4.
- [ ] Both deletion paths tested on the submitted build.
- [ ] Privacy policy and deletion URLs open publicly, with no sign-in wall.
