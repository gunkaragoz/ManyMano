// Markdown for Agents — negotiation rules, HTML → Markdown conversion, and
// the response wrapper workers/app.ts applies to every app response.
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, negotiateMarkdown, prefersMarkdown } from "~/utils/markdown";

const PAGE = "https://example.com/templates";

function page(main: string, head = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>Templates | Site</title>` +
    `<meta name="description" content="Pick a template &amp; share it."/>` +
    `<link rel="canonical" href="https://example.com/templates"/>${head}</head>` +
    `<body><header><nav><a href="/">Home</a></nav></header><main>${main}</main>` +
    `<footer>Footer links</footer><script>window.__ctx = {}</script></body></html>`;
}

describe("prefersMarkdown", () => {
  it.each([
    ["text/markdown", true],
    ["text/markdown, text/html;q=0.9", true],
    ["text/html;q=0.9, text/markdown", true],
    ["text/markdown, */*", true],
    ["text/markdown;q=0.5, text/*;q=0.4", true],
    ["TEXT/MARKDOWN", true],
  ])("%s → markdown", (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["*/*"],
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
    ["text/html, text/markdown;q=0.5"],
    ["text/markdown;q=0"],
    ["text/plain"],
  ])("%s → html", (accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });
});

describe("htmlToMarkdown", () => {
  it("writes frontmatter from the head", () => {
    const md = htmlToMarkdown(
      page("<h1>Hi</h1>", '<meta property="og:image" content="https://example.com/og.png"/>'),
      PAGE
    );
    expect(md.startsWith(
      "---\n" +
        'title: "Templates | Site"\n' +
        'description: "Pick a template & share it."\n' +
        'url: "https://example.com/templates"\n' +
        'image: "https://example.com/og.png"\n' +
        "---\n\n# Hi\n"
    )).toBe(true);
  });

  it("converts only <main>, dropping header, footer and scripts", () => {
    const md = htmlToMarkdown(page("<p>Body copy</p>"), PAGE);
    expect(md).toContain("Body copy");
    expect(md).not.toContain("Footer links");
    expect(md).not.toContain("__ctx");
    expect(md).not.toContain("[Home]");
  });

  it("renders headings, emphasis, links with absolute URLs, and images", () => {
    const md = htmlToMarkdown(
      page(
        '<h2>Plan <em>ahead</em></h2><p>Use <strong> bold </strong>text and ' +
          '<a href="/create?x=1&amp;y=2">create one</a>.</p><img src="/a.png" alt="Chart"/>' +
          '<a href="#top">Top</a><a href="/icon"><svg><path d="M0"/></svg></a>'
      ),
      PAGE
    );
    expect(md).toContain("## Plan *ahead*");
    expect(md).toContain("Use **bold** text and [create one](https://example.com/create?x=1&y=2).");
    expect(md).toContain("![Chart](https://example.com/a.png)");
    expect(md).toContain("Top"); // fragment link keeps its text, drops the href
    expect(md).not.toContain("(https://example.com/icon)"); // icon-only link has no text
  });

  it("renders nested and ordered lists, stripping repeated step numbers", () => {
    const md = htmlToMarkdown(
      page(
        "<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>" +
          '<ol><li><span>1</span><h3>Open</h3><p>Pick a template.</p></li><li><span>2</span><h3>Share</h3></li></ol>'
      ),
      PAGE
    );
    expect(md).toContain("- One\n  - Nested\n- Two");
    expect(md).toContain("1. **Open**\n   Pick a template.\n2. **Share**");
  });

  it("flattens block content inside links and separates adjacent spans", () => {
    const md = htmlToMarkdown(
      page(
        '<a href="/p"><span class="block">Potluck</span><span class="block">Mains and sides</span></a>' +
          '<div><span>No ads</span><span aria-hidden="true">•</span><span>Free</span></div>'
      ),
      PAGE
    );
    expect(md).toContain("[Potluck — Mains and sides](https://example.com/p)");
    expect(md).toContain("No ads Free");
  });

  it("renders tables as GFM", () => {
    const md = htmlToMarkdown(
      page("<table><thead><tr><th>Shift</th><th>Spots</th></tr></thead><tbody><tr><td>Mains</td><td>4 | 2</td></tr></tbody></table>"),
      PAGE
    );
    expect(md).toContain("| Shift | Spots |\n| --- | --- |\n| Mains | 4 \\| 2 |");
  });

  it("lays out rowspan/colspan headers like the poll matrix, keeping sr-only vote labels", () => {
    const vote = (cls: string, label: string) =>
      `<td><span class="${cls}"><svg aria-hidden="true"><path d="M0"/></svg><span class="sr-only">${label}</span></span></td>`;
    const md = htmlToMarkdown(
      page(
        '<div class="md:hidden">Mobile cards</div><div class="hidden md:block"><table>' +
          '<thead><tr><th rowspan="2">Participants (2)</th><th colspan="2">Mon, Oct 5</th><th colspan="1">Tue, Oct 6</th></tr>' +
          "<tr><th>9:00 AM</th><th>2:00 PM</th><th>9:00 AM</th></tr></thead>" +
          `<tbody><tr><td>Ana</td>${vote("bg-green-500", "Yes")}${vote("bg-amber-400", "Maybe")}${vote("bg-slate-100", "No")}</tr>` +
          `<tr><td>Bo</td>${vote("bg-slate-100", "No")}${vote("bg-green-500", "Yes")}${vote("bg-green-500", "Yes")}</tr></tbody>` +
          "<tfoot><tr><td>Total Yes / (Maybe)</td><td>1</td><td>1 <span>(+1)</span></td><td>1</td></tr></tfoot>" +
          "</table></div>"
      ),
      PAGE
    );
    expect(md).not.toContain("Mobile cards");
    expect(md).toContain(
      "| Participants (2) | Mon, Oct 5 — 9:00 AM | Mon, Oct 5 — 2:00 PM | Tue, Oct 6 — 9:00 AM |\n" +
        "| --- | --- | --- | --- |\n" +
        "| Ana | Yes | Maybe | No |\n" +
        "| Bo | No | Yes | Yes |\n" +
        "| Total Yes / (Maybe) | 1 | 1 (+1) | 1 |"
    );
  });

  it("repeats body rowspans per row and fills a body colspan once", () => {
    const md = htmlToMarkdown(
      page(
        "<table><tr><th>Day</th><th>Shift</th><th>Name</th></tr>" +
          '<tr><td rowspan="2">Sat</td><td>Morning</td><td>Ana</td></tr>' +
          "<tr><td>Evening</td><td>Bo</td></tr>" +
          '<tr><td colspan="3">No more shifts</td></tr></table>'
      ),
      PAGE
    );
    expect(md).toContain(
      "| Day | Shift | Name |\n| --- | --- | --- |\n| Sat | Morning | Ana |\n| Sat | Evening | Bo |\n| No more shifts | | |"
    );
  });

  it("keeps user text literal: a Markdown link in a name stays text", () => {
    const md = htmlToMarkdown(
      page(
        "<table><tr><th>Participants</th><th>Mon</th></tr>" +
          '<tr><td>[support](https://attacker.example)</td><td><span class="sr-only">Yes</span></td></tr></table>'
      ),
      PAGE
    );
    expect(md).toContain("| \\[support\\](https://attacker.example) | Yes |");
    expect(md).not.toMatch(/(^|[^\\])\[support\]\(/);
  });

  it("escapes line-start markers, emphasis and raw HTML in text, not the converter's own syntax", () => {
    const md = htmlToMarkdown(
      page(
        "<p># Not a heading</p><p>- not a list</p><p>1. not ordered</p><p>&gt; not a quote</p>" +
          "<p>*stars* _under_ ~strike~ &lt;script&gt;x&lt;/script&gt; and <b>real bold</b></p>" +
          '<a href="/wiki/A_(b)">wiki link</a>' +
          '<img src="/i.png" alt="x](https://evil.example)"/>'
      ),
      PAGE
    );
    expect(md).toContain("\\# Not a heading");
    expect(md).toContain("\\- not a list");
    expect(md).toContain("1\\. not ordered");
    expect(md).toContain("\\> not a quote");
    expect(md).toContain("\\*stars\\* \\_under\\_ \\~strike\\~ \\<script\\>x\\</script\\> and **real bold**");
    expect(md).toContain("[wiki link](https://example.com/wiki/A_%28b%29)");
    expect(md).toContain("![x\\](https://evil.example)](https://example.com/i.png)");
  });

  it("widens code fences when the code contains backticks", () => {
    const md = htmlToMarkdown(page("<p><code>a`b</code></p><pre>```\nx\n```</pre>"), PAGE);
    expect(md).toContain("``a`b``");
    expect(md).toContain("````\n```\nx\n```\n````");
  });

  it("escapes backslashes in table cells so a trailing \\ cannot eat the pipe", () => {
    const md = htmlToMarkdown(page("<table><tr><th>Path</th><th>Note</th></tr><tr><td>C:\\dir\\</td><td>a\\|b</td></tr></table>"), PAGE);
    expect(md).toContain("| C:\\\\dir\\\\ | a\\\\\\|b |");
  });

  it("uses the desktop layout: skips hidden and mobile-only elements, drops form controls", () => {
    const md = htmlToMarkdown(
      page(
        '<span class="sm:hidden">Create</span><span class="hidden sm:inline">Create Event</span>' +
          '<div class="hidden">Never</div><div hidden>Nope</div><button>Click</button>' +
          '<select><option>Opt</option></select><textarea>Draft</textarea>'
      ),
      PAGE
    );
    expect(md).toContain("Create Event");
    for (const gone of ["Never", "Nope", "Click", "Opt", "Draft"]) expect(md).not.toContain(gone);
    expect(md).not.toMatch(/^Create$/m);
  });

  it("keeps <details> questions bold and preserves <pre> verbatim", () => {
    const md = htmlToMarkdown(
      page("<details><summary>Is it free?</summary><p>Yes.</p></details><pre>a  b\n  c</pre>"),
      PAGE
    );
    expect(md).toContain("**Is it free?**\n\nYes.");
    expect(md).toContain("```\na  b\n  c\n```");
  });

  it("appends JSON-LD as json code blocks", () => {
    const md = htmlToMarkdown(
      page("<p>x</p>", '<script type="application/ld+json">{"@type":"FAQPage"}</script>'),
      PAGE
    );
    expect(md).toContain('## Structured data\n\n```json\n{\n  "@type": "FAQPage"\n}\n```');
  });
});

describe("negotiateMarkdown", () => {
  const html = () =>
    new Response(page("<h1>Hello</h1>"), {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Content-Length": "999",
        "Cache-Control": "public, max-age=300",
        "X-Robots-Tag": "noindex",
      },
    });
  const req = (accept?: string, method = "GET") =>
    new Request(PAGE, { method, headers: accept ? { Accept: accept } : {} });

  it("converts HTML to Markdown when asked, keeping status and other headers", async () => {
    const res = await negotiateMarkdown(req("text/markdown"), html());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(res.headers.get("Content-Length")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const body = await res.text();
    expect(body).toContain("# Hello");
    expect(Number(res.headers.get("x-markdown-tokens"))).toBe(Math.ceil(body.length / 4));
  });

  it("carries a <meta name=robots> directive into X-Robots-Tag", async () => {
    const r = new Response(page("<h1>Event</h1>", '<meta name="robots" content="noindex, nofollow"/>'), {
      headers: { "Content-Type": "text/html" },
    });
    const res = await negotiateMarkdown(req("text/markdown"), r);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const plain = await negotiateMarkdown(req("text/markdown"), new Response(page("<p>x</p>"), { headers: { "Content-Type": "text/html" } }));
    expect(plain.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("keeps HTML for browsers but adds Vary: Accept", async () => {
    const res = await negotiateMarkdown(req("text/html,*/*;q=0.8"), html());
    expect(res.headers.get("Content-Type")).toBe("text/html");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(await res.text()).toContain("<h1>Hello</h1>");
  });

  it("appends Accept to an existing Vary header once", async () => {
    const r = html();
    r.headers.set("Vary", "Cookie");
    const res = await negotiateMarkdown(req("text/markdown"), r);
    expect(res.headers.get("Vary")).toBe("Cookie, Accept");
  });

  it("leaves non-GET requests and non-HTML responses alone", async () => {
    const head = await negotiateMarkdown(req("text/markdown", "HEAD"), html());
    expect(head.headers.get("Content-Type")).toBe("text/html");

    const json = new Response("{}", { headers: { "Content-Type": "application/json" } });
    expect(await negotiateMarkdown(req("text/markdown"), json)).toBe(json);

    const redirect = Response.redirect("https://example.com/", 302);
    expect(await negotiateMarkdown(req("text/markdown"), redirect)).toBe(redirect);
  });
});
