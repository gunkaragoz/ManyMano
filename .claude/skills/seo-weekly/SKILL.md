---
name: seo-weekly
description: Run this project's weekly SEO review. Reads the latest SEO snapshot (seo-data branch), the brief and the change log, judges changes that are due, and recommends ONE page and ONE change with a source behind every claim. Use when the user says /seo-weekly, "weekly SEO", "SEO check", or asks which page to improve for search.
---

# Weekly SEO review

You're running the playbook in `seo/README.md` → *The weekly loop*. Follow it
exactly and don't improvise a different process: the loop only works if every
week is judged the same way.

## 1. Load context (every run)

1. Read `seo/BRIEF.md`, `seo/README.md` and `seo/LOG.md` in full.
2. Get the snapshots: `git fetch origin seo-data` and list them with
   `git ls-tree --name-only origin/seo-data snapshots/`. Read the newest with
   `git show origin/seo-data:snapshots/<date>.json`, plus the snapshot from
   about 4 weeks before any LOG entry you need to judge.
   - If the branch doesn't exist yet, run the check yourself if you have
     network access (`node scripts/seo/weekly.mjs --site <SITE_URL> --out seo/data --no-fail`),
     or say so and stop.
3. If the newest snapshot is older than 8 days, say so up front.

## 2. Produce the review

Write it in this order and keep it short:

1. **Broken?** List every `level: "error"` finding and anything under
   `diff.newFindings`. If there are errors, the recommendation is to fix
   them, and you can skip to step 5.
2. **Verdicts due.** For each LOG entry whose *Judge after* date has passed
   and that has no verdict: baseline vs. now, on the search side (impressions,
   CTR, position) *and* the conversion side (`conversions.rows` for that
   landing page). Call it win / miss / inconclusive per the playbook. A
   search gain with no conversion gain is a **miss**.
3. **Candidates.** From `scored.rows`, take up to 3 `candidate` rows. For each:
   - the main queries (`search.queries` for that path)
   - look at the live results for the main query (WebSearch), and read the top
     3–5 pages in full (WebFetch), never from memory
   - give one call: **keep**, **keep once <condition>**, or **drop**, with
     the result URLs as evidence

   Mention `trap` rows in one line each, as questions, not targets.
4. **Four-pass check on the kept page** (access / competition / answer engines
   / path to conversion, as defined in the playbook). Read our own page's
   source under `app/` (template pages come from `app/utils/templates.ts`
   and `app/components/TemplatePage.tsx`) and the live HTML if reachable.
5. **ONE recommendation**: the page, the exact change (draft copy if it's
   copy), the evidence (URLs and snapshot fields), the expected effect on
   conversions, and the *Judge after* date (≥ 4 weeks).

Rules:
- Every factual claim cites a URL or a snapshot field. If data is missing,
  write "data missing: <what>" and don't estimate it.
- One change per page per test. Don't recommend touching a page that's in the
  top 3 and converting, unless something broke.
- Ignore position moves that are less than two weeks old.
- Don't edit `seo/README.md` or `seo/BRIEF.md` unless the user asks, since
  that changes the test.

## 3. After the user says yes

- Make the change on a branch, following the repo's conventions (README →
  *Branch names*; brand strings come from site config, never hardcoded), and
  run `pnpm run typecheck && pnpm run test:unit`.
- Append a LOG entry in the same commit (the format is at the top of
  `seo/LOG.md`), with the baseline numbers from the snapshot.
- Open a PR. **Never deploy, never submit URLs to search engines, and never
  post anywhere outside this repo.** A human merges and deploys.

If the user says no, or picks a different change, record the decision in
LOG.md anyway (a dropped candidate is also a decision).

If there's an open GitHub issue titled "SEO weekly check — <date>" and you
can comment on it, post the review there too, so the week has one record.
