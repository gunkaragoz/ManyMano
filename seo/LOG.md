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
