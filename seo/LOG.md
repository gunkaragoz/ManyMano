# SEO change log

Append-only. Never edit or delete an old entry; add a follow-up entry instead.
One entry per **decision** (a change shipped, a test judged, a candidate
dropped). The weekly numbers themselves live in the `seo-data` branch and the
weekly GitHub issue.

Entry format:

```
## YYYY-MM-DD — <page> — <what changed | verdict>
- Why: <evidence, with links / snapshot date>
- Baseline (28d before): impressions, clicks, CTR, position, conversions
- Shipped: <PR link + deploy date>        (for changes)
- Judge after: <date, ≥ 4 weeks later>     (for changes)
- Verdict: win | miss | inconclusive — <search side> / <conversion side>   (for reviews)
```

---

## 2026-09-27 — sitewide — measurement added

- Why: conversions weren't attributed to pages, so no page could be judged
  on business impact.
- Shipped: landing-page and channel attribution on event creation,
  `GET /api/conversions`, the weekly check (`scripts/seo/weekly.mjs`) and
  `.github/workflows/seo-weekly.yml`. `/api/` disallowed in robots.txt.
- First local crawl: 38 sitemap pages, 0 blocking errors; 4 template titles
  are 66–67 chars (display limit ~65). Left as is: too small to be worth a
  test.
- Next: add Search Console credentials (seo/README.md → Setup), then let
  4 weeks of conversion data build up before picking the first page.

## 2026-10-01 — template library — first expansion batch prepared

- Why: `seo/BRIEF.md` targets snack schedules and volunteer organizers in
  schools, nonprofits and churches. The catalog had no snack schedule,
  monthly recurrence example or generic volunteer template. Trunk-or-treat
  adds a distinct October use case; a committee poll serves volunteer groups.
- Pages: `/signup-sheet/snack-schedule`, `/signup-sheet/trunk-or-treat`,
  `/signup-sheet/food-pantry-shifts`, `/signup-sheet/volunteer`,
  `/meeting-poll/committee-meeting`.
- Scope: library and template landing pages; existing create-menu selection
  unchanged. Sitemap, llms.txt and conversion attribution use the catalog
  automatically. No paid services or new dependencies.
- Baseline (28d before): new pages have no prior baseline. Search Console
  impressions, clicks, CTR and position unavailable; conversions unavailable.
  Measurement began September 27, so there is no mature sitewide baseline yet.
- Shipped: pending review and deployment; this entry records preparation,
  not a production launch.
- Judge after: at least 28 days after actual deployment (November 1 if
  deployed October 1, allowing for Search Console's reporting delay).
- Next report: use the existing weekly SEO check to review indexing and
  conversions by these landing pages. Compare evergreen pages over equal
  windows; judge trunk-or-treat in its October season separately. Treat low
  traffic as inconclusive, not a miss. Prioritize next additions using actual
  query impressions and organizer creations; candidates include office hours,
  field day, church volunteering, study groups and distinct holiday templates.

## 2026-10-05 — field trip chaperones — template prepared

- Why: requested school field trip use case; editable chaperone capacities
  for three groups, all covering the full trip. No approval or permission-slip
  features implied. Existing create-menu selection unchanged.
- Page: `/signup-sheet/field-trip-chaperones`.
- Baseline (28d before): new page; prior search and conversion data unavailable.
- Shipped: pending review and deployment in the template library PR.
- Judge after: at least 28 days after confirmed deployment, plus Search Console
  reporting lag. Include this page in the existing weekly report; sparse data
  remains inconclusive.
