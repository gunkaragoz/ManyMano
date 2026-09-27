# SEO loop

A small, repeatable weekly habit: **measure → pick one page → make one
change → wait → judge on conversions, not rankings.** It uses only free tools
(Google Search Console, PageSpeed Insights, Bing Webmaster Tools, and this
app's own conversion counters) plus Claude Code for the judgment calls.

| File | What it is |
|---|---|
| `seo/BRIEF.md` | The offer, the audience, and what counts as a conversion. Read first, every run. |
| `seo/LOG.md` | Append-only decisions: what changed, why, when, and the verdict. |
| `scripts/seo/weekly.mjs` | The weekly check: crawl + on-page checks, Search Console, conversions, PageSpeed → snapshot + report. |
| `.github/workflows/seo-weekly.yml` | Runs it every Monday, stores the snapshot on the `seo-data` branch, and opens a GitHub issue with the report. |
| `.claude/skills/seo-weekly/` | `/seo-weekly` in Claude Code: reads the latest snapshot and recommends **one** change, with sources. |

## How conversions are measured

A conversion is **an organizer creating an event**. When a visit starts, the
browser keeps the first page and the referrer in `sessionStorage` (no cookies,
no IDs). The create forms post them along, and the server adds 1 to a daily
counter keyed by type, channel (`search` / `ai` / `social` / `referral` /
`direct`) and landing page. Read the counters with:

```
GET /api/conversions?days=28
```

Counting started when this shipped, so early weeks will be thin. Don't pick a
page until there are ~4 weeks of data.

## Setup (once, ~30 minutes)

The workflow runs without any secrets: crawl, on-page checks, conversions and
keyless PageSpeed. Add Search Console to unlock page picking:

1. **Google Cloud**: create a project → *APIs & Services → Enable APIs* →
   enable **Google Search Console API** (and **PageSpeed Insights API** if you
   want a key).
2. *IAM & Admin → Service accounts → Create*. No roles needed. Open it →
   *Keys → Add key → JSON*, and download the file.
3. **Search Console** → your property → *Settings → Users and permissions →
   Add user*: paste the service account's email, permission **Restricted**
   (read-only).
4. **GitHub** → repo *Settings → Secrets and variables → Actions*:
   - `GSC_SERVICE_ACCOUNT_JSON`: the whole JSON file's contents
   - `GSC_PROPERTY`: `sc-domain:manymano.com` for a domain property, or
     `https://manymano.com/` for a URL-prefix property
   - `PSI_API_KEY` (optional): an API key restricted to the PageSpeed API
   - Variable (not secret) `SEO_SITE_URL` (optional): defaults to `https://manymano.com`
5. **Bing Webmaster Tools** (optional, free): import the site from Search
   Console. Once a month, glance at its *AI Performance* report to see which
   pages get cited in AI answers. It has no API worth wiring for a site this
   size.

Run it by hand any time: *Actions → SEO weekly check → Run workflow*, or
locally:

```bash
GSC_SERVICE_ACCOUNT_JSON="$(cat key.json)" GSC_PROPERTY=sc-domain:manymano.com \
  node scripts/seo/weekly.mjs --site https://manymano.com --out seo/data
```

(`seo/data/` is gitignored on `main`; the workflow keeps history on the
`seo-data` branch.)

## The weekly loop (the playbook)

Every Monday the workflow opens an issue titled **SEO weekly check —
YYYY-MM-DD**. Then, in Claude Code, run `/seo-weekly`, or do it by hand:

1. **Anything broken?** Fix blocking errors (non-200, `noindex`, wrong
   canonical, broken JSON-LD) first. They're the only thing that skips the
   queue.
2. **Judge what's in flight.** For each open entry in `LOG.md` whose *Judge
   after* date has passed, compare with its baseline and write a verdict:
   - it climbed in search but brought no extra conversions → **miss**
   - rankings stayed flat but conversions rose (e.g. a clearer next step) → **win**
   - AI citation moves can't be tied to one change, so never count them as the verdict
3. **Pick the page worth this week.** It must be a 🎯 *candidate* in the
   report: it already converts, has ≥ 50 impressions, and sits at position
   4–20. Treat ⚠️ *traps* (lots of impressions, zero conversions) as
   questions ("wrong intent?"), not targets. Before committing, look at the
   live results page for the main query. If the top results are a different
   kind of page (how-to guides vs. our tool page), the intent doesn't match:
   **drop** the page, or **keep it once** a named condition is fixed.
4. **Check it in four passes**, citing a URL or a snapshot field for every
   claim, and saying "data missing" instead of guessing:
   1. *Access*: indexable, 200, real text server-rendered, fast enough on
      mobile (PageSpeed).
   2. *Competition*: read the top ~5 results for the main query in full. What
      do they cover or answer that we don't? What do we say better?
   3. *Answer engines*: answer the question in the first line under each
      heading; headings phrased as people ask; sections that stand on their
      own; consistent "free, no accounts, no ads" description everywhere.
      Schema only where a rich result fits. Don't spend time on llms.txt
      tricks: Google says no special markup is needed for AI features.
   4. *Path to conversion*: one obvious next step above the fold, doubts
      answered before the button, and internal links to this page from pages
      that already get traffic.
5. **Recommend ONE change**, the highest expected conversion gain for the
   least effort, and wait for a human yes.
6. **Ship it as a PR**, with a new `LOG.md` entry in the same PR (baseline,
   why, *Judge after* ≥ 4 weeks). A human reviews, merges and deploys.
7. **Otherwise leave it alone.** Don't touch pages already in the top 3
   without a strong reason. Ignore position wiggles that last less than two
   weeks. Don't edit this playbook or `BRIEF.md` while a test is running,
   because that makes this week incomparable with last week.

Mind the Search Console caveats: data lands 2–3 days late (the window already
ends 3 days ago), page×query rows are sampled (use them for "which queries",
never for totals), and AI Overview appearances can flatter average position.

## Troubleshooting

- **Every page reports HTTP 403/503 in the workflow.** Cloudflare Bot Fight
  Mode is probably challenging GitHub's runners (data-center IPs). Run the
  check locally, or point `SEO_SITE_URL` at the staging worker. The crawler
  identifies itself as `ManyManoSEOCheck/1.0`.
- **"Search Console request failed (… User does not have sufficient
  permission …)".** The service account email isn't added to the property,
  or `GSC_PROPERTY` doesn't match the property type (`sc-domain:` vs URL
  prefix with a trailing slash).
