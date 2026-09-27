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
