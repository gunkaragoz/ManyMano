# SEO brief

The weekly check (human or `/seo-weekly`) reads this first. Keep it short and
true. Edit it when the offer or the audience changes, not during a test.

## What we offer

Free, ad-free, open-source **sign-up sheets** (slots, shifts, capacity, CSV,
calendar invites) and **meeting polls** (Yes / Maybe / No voting, lock the
winner). No accounts for organizers or participants.

## Who it's for

People organizing a group on a volunteer basis. Mainly **school parents, PTAs
and PTOs**, teachers, nonprofits, clubs, sports teams, churches, and friends
planning a potluck or a meet-up. They're often frustrated with ad-heavy or
paywalled alternatives (SignUpGenius, Doodle) and want something that works
in the next five minutes.

## What counts as a conversion

**An organizer creates an event** (a sign-up sheet or a meeting poll). It's
counted per day, per event type, per channel, and per landing page (the first
page of the visit), and read from `GET /api/conversions`.

Not conversions: page views, participant sign-ups/votes (that's product
usage, and it's shown on `/pulse`), and template views.

## Pages that can earn a conversion

| Page type | Paths | Next step on the page |
|---|---|---|
| Home | `/` | Create a sign-up sheet / a poll |
| Create | `/create`, `/create/signup`, `/create/poll` | The form itself |
| Template hub | `/templates` | Pick a template |
| Template pages | `/signup-sheet/<slug>`, `/meeting-poll/<slug>` | "Use this template" → prefilled create form |

Event pages (`/events/*`) are unlisted and `noindex`. They're never an SEO
target, but "Make a copy" from an event is a real (viral) conversion path and
shows up as landing `/events`.

## Queries we want to win

These are intent-to-act searches, where someone is about to organize something:

- "free sign up sheet", "sign up sheet no account", "signupgenius alternative"
- "<occasion> sign up sheet": potluck, volunteer, bake sale, book fair, teacher appreciation, parent-teacher conferences, snack schedule
- "free meeting poll", "doodle alternative", "find a time that works for everyone"

Curiosity queries ("what is a sign up sheet") are low value. Don't chase them.

## Brand voice guardrails

Plain, warm, short. There's no hype and no "revolutionary". Never claim
features we don't have. Keep "free, no accounts, no ads" consistent everywhere
the product is described (site, GitHub README, directories, forum answers).

## Constraints

- The site deploys from this repo (`pnpm run deploy`). Every change is a PR
  that a human reviews and deploys. Nothing is published automatically.
- Copy is templated on `SITE_NAME` etc. (see `app/utils/seo.ts`), so never
  hardcode the brand name.
