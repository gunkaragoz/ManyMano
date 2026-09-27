// Markdown for Agents — content negotiation for HTML pages.
//
// Agents that send `Accept: text/markdown` get a Markdown rendering of the
// same page instead of the HTML; browsers (no text/markdown in Accept) keep
// getting HTML. workers/app.ts renders the page as usual and converts the
// finished HTML here, so every route is covered without a second template.
//
// The converter is a small index-scanning HTML parser (no DOM in Workers).
// React's SSR output is well-formed, so a stack-based tree builder with
// implicit closes is enough. Output mirrors Cloudflare's Markdown for
// Agents: YAML frontmatter (title, description, url, image), the <main>
// content as Markdown, and JSON-LD kept as ```json blocks.

// ---------------------------------------------------------------------------
// Negotiation

type MediaRange = { type: string; q: number };

function parseAccept(accept: string): MediaRange[] {
  return accept
    .split(",")
    .map((part) => {
      const [type, ...params] = part.trim().toLowerCase().split(";");
      let q = 1;
      for (const p of params) {
        const [k, v] = p.trim().split("=");
        if (k === "q") {
          const n = Number(v);
          q = Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
        }
      }
      return { type: type.trim(), q };
    })
    .filter((r) => r.type);
}

/** q-value the Accept header assigns to `type`, most specific range wins. */
function qualityFor(ranges: MediaRange[], type: string): number {
  const [major] = type.split("/");
  const exact = ranges.find((r) => r.type === type);
  if (exact) return exact.q;
  const wild = ranges.find((r) => r.type === `${major}/*`);
  if (wild) return wild.q;
  const any = ranges.find((r) => r.type === "*/*");
  return any ? any.q : 0;
}

/**
 * True when the client explicitly asks for text/markdown and ranks it at
 * least as high as HTML. `*\/*` alone never selects Markdown — browsers and
 * generic clients keep getting HTML.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const ranges = parseAccept(accept);
  const md = ranges.find((r) => r.type === "text/markdown");
  if (!md || md.q === 0) return false;
  return md.q >= qualityFor(ranges, "text/html");
}

/** Rough token count (≈4 characters per token), for `x-markdown-tokens`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// HTML parsing

type Node = Element | string;
type Element = { tag: string; attrs: Record<string, string>; children: Node[] };

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "source", "track", "wbr",
]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
// Opening one of these closes an open element of the same kind (<p>, <li>…).
const AUTO_CLOSE: Record<string, string[]> = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  tr: ["tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  option: ["option"],
  p: ["p"],
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–",
  mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  middot: "·", bull: "•", copy: "©", times: "×", rarr: "→", larr: "←",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function parseHtml(html: string): Element {
  const root: Element = { tag: "#root", attrs: {}, children: [] };
  const stack: Element[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      top().children.push(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(html.slice(i, lt)));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const close = html[lt + 1] === "/";
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(lt + (close ? 2 : 1), lt + 64));
    if (!nameMatch) {
      top().children.push("<");
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    // Find the tag's closing '>' outside quoted attribute values.
    let j = lt + (close ? 2 : 1) + tag.length;
    let quote = "";
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
    }
    const inner = html.slice(lt + (close ? 2 : 1) + tag.length, j);
    i = j + 1;

    if (close) {
      const idx = stack.map((e) => e.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }

    const auto = AUTO_CLOSE[tag];
    if (auto && auto.includes(top().tag)) stack.pop();

    const el: Element = { tag, attrs: parseAttrs(inner), children: [] };
    top().children.push(el);

    if (RAW_TEXT.has(tag)) {
      const endRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = html.slice(i);
      const m = endRe.exec(rest);
      const text = m ? rest.slice(0, m.index) : rest;
      el.children.push(tag === "script" || tag === "style" ? text : decodeEntities(text));
      i = m ? i + m.index + m[0].length : html.length;
      continue;
    }
    if (!VOID.has(tag) && !inner.trimEnd().endsWith("/")) stack.push(el);
  }
  return root;
}

function find(node: Element, pred: (el: Element) => boolean): Element | undefined {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (pred(child)) return child;
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return undefined;
}

function findAll(node: Element, pred: (el: Element) => boolean, out: Element[] = []): Element[] {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (pred(child)) out.push(child);
    findAll(child, pred, out);
  }
  return out;
}

function textOf(node: Node): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

// ---------------------------------------------------------------------------
// Markdown rendering

// Elements that carry no readable content (or only interactive chrome).
const SKIP = new Set([
  "head", "script", "style", "template", "noscript", "svg", "canvas", "iframe",
  "object", "embed", "button", "input", "select", "textarea", "option", "dialog",
  "link", "meta",
]);

const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl",
  "dt", "dd", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hr", "legend", "li", "main", "nav", "ol",
  "p", "pre", "section", "summary", "table", "ul",
]);

// Placeholders survive whitespace normalisation and are swapped at the end:
// INDENT for list-nesting spaces, PRE for verbatim code blocks.
const INDENT = "\u0000";
const PRE = "\u0001";
const SEP = "\u0002"; // block boundary inside inline-only contexts (link text)

/**
 * The page is converted as the desktop layout: Tailwind `hidden` without a
 * responsive show class, or `sm:hidden`-style classes, hide the element on
 * wide screens — skipping those avoids duplicate mobile/desktop copies.
 */
function isHidden(el: Element): boolean {
  if ("hidden" in el.attrs) return true;
  if (el.attrs["aria-hidden"] === "true") return true;
  if (/display\s*:\s*none/i.test(el.attrs.style ?? "")) return true;
  const classes = (el.attrs.class ?? "").split(/\s+/);
  if (classes.some((c) => /^(sm|md|lg):hidden$/.test(c))) return true;
  if (classes.includes("hidden")) {
    return !classes.some((c) => /^(sm|md|lg):(block|inline|inline-block|flex|inline-flex|grid|table|contents)$/.test(c));
  }
  return false;
}

// inList: inside a list item, where a "### heading" line would break the list.
type Ctx = { base: string; inline: boolean; inList: boolean; pres: string[] };

/**
 * Page text is literal: escape Markdown syntax so user content (an event
 * title, a participant named "[x](https://…)" or "# Hi") stays text and
 * cannot become a link, heading, list item or raw HTML. Line-start markers
 * are escaped at the start of every text node — harmless mid-line.
 */
function escapeText(s: string): string {
  return s
    .replace(/[\\`*_[\]<>|~]/g, "\\$&")
    .replace(/^(\s*)([#+=-])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(?=\s|$)/, "$1\\$2");
}

function longestRun(s: string, ch: string): number {
  let best = 0;
  let run = 0;
  for (const c of s) {
    run = c === ch ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function resolveUrl(href: string, base: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(javascript|data):/i.test(h)) return null;
  try {
    // Parens and pipes would end the (url) early or split a table cell.
    return new URL(h, base).toString().replace(/[()|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return null;
  }
}

function wrapInline(content: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : content;
}

function block(content: string, ctx: Ctx): string {
  return ctx.inline ? ` ${SEP} ${content} ${SEP} ` : `\n\n${content}\n\n`;
}

/** Collapse whitespace inside a block, keeping at most one blank line. */
function tidy(s: string): string {
  return s
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inlineText(s: string): string {
  return s
    .replace(new RegExp(`(\\s*${SEP}\\s*)+`, "g"), " — ")
    .replace(/\s+/g, " ")
    .replace(/^\s*—\s*|\s*—\s*$/g, "")
    .trim();
}

function renderChildren(el: Element, ctx: Ctx): string {
  // Sibling elements with no text between them are usually laid out as
  // separate items (flex rows, badge lists, title + subtitle in a card), so
  // keep their text apart instead of gluing "Title" and "Subtitle" together.
  let out = "";
  let prevWasElement = false;
  for (const child of el.children) {
    const text = renderNode(child, ctx);
    const isElement = typeof child !== "string";
    if (isElement && prevWasElement && text && out && !/\s$/.test(out) && !/^\s/.test(text)) {
      out += ctx.inline ? ` ${SEP} ` : " ";
    }
    out += text;
    if (typeof child === "string" ? child.trim() : text) prevWasElement = isElement;
  }
  return out;
}

function renderList(el: Element, ctx: Ctx): string {
  const ordered = el.tag === "ol";
  let n = Number(el.attrs.start) || 1;
  const items: string[] = [];
  for (const child of el.children) {
    if (typeof child === "string" || child.tag !== "li" || isHidden(child)) continue;
    let body = tidy(renderChildren(child, { ...ctx, inList: true })).replace(/\n{2,}/g, "\n");
    // Step lists often repeat their number in a badge ("1. 1 Open…").
    if (ordered) body = body.replace(new RegExp(`^${n}[.)]?(\\s+|$)`), "");
    if (!body) continue;
    const marker = ordered ? `${n++}. ` : "- ";
    const pad = INDENT.repeat(marker.length);
    items.push(marker + body.split("\n").join(`\n${pad}`));
  }
  return items.length ? block(items.join("\n"), ctx) : "";
}

/** Rows of a table in document order, flagged when they belong to <thead>. */
function tableRows(el: Element, inHead = false, out: { tr: Element; head: boolean }[] = []) {
  for (const child of el.children) {
    if (typeof child === "string" || isHidden(child) || child.tag === "table") continue;
    if (child.tag === "tr") out.push({ tr: child, head: inHead });
    else tableRows(child, inHead || child.tag === "thead", out);
  }
  return out;
}

function span(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 100) : 1;
}

/**
 * GFM tables have one header row and no spans, so lay the HTML table out on
 * a grid first: a rowspan/colspan cell fills every slot it covers. Header
 * rows (<thead>, or leading rows of only <th>) collapse into one row per
 * column ("Mon, Oct 5 — 9:00 AM"); in the body a rowspan repeats its text
 * so each row stands alone, and a colspan fills only its first column.
 */
function renderTable(el: Element, ctx: Ctx): string {
  const rows = tableRows(el);
  const grid: { text: string; id: number; first: boolean }[][] = [];
  let id = 0;
  rows.forEach(({ tr }, r) => {
    grid[r] ??= [];
    let col = 0;
    for (const c of tr.children) {
      if (typeof c === "string" || (c.tag !== "td" && c.tag !== "th") || isHidden(c)) continue;
      while (grid[r][col]) col++;
      // Text nodes are already escaped (including "|"), so cells are safe as-is.
      const text = inlineText(renderChildren(c, { ...ctx, inline: true }));
      const cellId = id++;
      const rs = span(c.attrs.rowspan);
      const cs = span(c.attrs.colspan);
      for (let dr = 0; dr < rs && r + dr < rows.length; dr++) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < cs; dc++) {
          grid[r + dr][col + dc] = { text, id: cellId, first: dc === 0 };
        }
      }
      col += cs;
    }
  });

  let headCount = rows.findIndex(({ head }) => !head);
  if (headCount === -1) headCount = rows.length;
  if (headCount === 0) {
    const onlyTh = (tr: Element) =>
      tr.children.every((c) => typeof c === "string" || c.tag === "th" || isHidden(c));
    while (headCount < rows.length && onlyTh(rows[headCount].tr)) headCount++;
    headCount = Math.max(headCount, 1);
  }

  const width = Math.max(0, ...grid.map((r) => r.length));
  if (!width) return "";
  const header = Array.from({ length: width }, (_, k) => {
    const seen = new Set<number>();
    const parts: string[] = [];
    for (let r = 0; r < headCount; r++) {
      const cell = grid[r]?.[k];
      if (cell && cell.text && !seen.has(cell.id)) {
        seen.add(cell.id);
        parts.push(cell.text);
      }
    }
    return parts.join(" — ");
  });
  const body = grid
    .slice(headCount)
    .map((r) => Array.from({ length: width }, (_, k) => (r[k]?.first ? r[k].text : "")))
    .filter((r) => r.some(Boolean));

  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  const out = [line(header), line(Array(width).fill("---")), ...body.map(line)];
  return block(out.join("\n"), ctx);
}

/**
 * role="img" elements (charts, meters) carry their meaning in aria-label and,
 * for SVG charts, per-point <title> tooltips (e.g. the Pulse daily bars).
 * Emit those as text; the drawing itself is dropped. Decorative icons are
 * aria-hidden and never get here.
 */
function renderImageRole(el: Element, ctx: Ctx): string {
  const label = escapeText((el.attrs["aria-label"] ?? "").replace(/\s+/g, " ").trim());
  if (ctx.inline) return label;
  const points = [
    ...new Set(
      findAll(el, (e) => e.tag === "title")
        .map((t) => textOf(t).replace(/\s+/g, " ").trim())
        .filter((t) => t && t !== el.attrs["aria-label"])
    ),
  ];
  const list = points.map((t) => `- ${escapeText(t)}`).join("\n");
  return block([label, list].filter(Boolean).join("\n\n"), ctx);
}

function renderNode(node: Node, ctx: Ctx): string {
  if (typeof node === "string") return escapeText(node.replace(/\s+/g, " "));
  const el = node;
  if (isHidden(el)) return "";
  if (el.attrs.role === "img") return renderImageRole(el, ctx);
  if (SKIP.has(el.tag)) return "";

  switch (el.tag) {
    case "br":
      return ctx.inline ? " " : "\n";
    case "hr":
      return ctx.inline ? " " : "\n\n---\n\n";
    case "img": {
      const alt = (el.attrs.alt ?? "").trim();
      const src = resolveUrl(el.attrs.src ?? "", ctx.base);
      return alt && src ? `![${escapeText(alt.replace(/\s+/g, " "))}](${src})` : "";
    }
    case "a": {
      const text = inlineText(renderChildren(el, { ...ctx, inline: true }));
      if (!text) return "";
      const href = resolveUrl(el.attrs.href ?? "", ctx.base);
      return href ? `[${text}](${href})` : text;
    }
    case "strong":
    case "b":
      return wrapInline(renderChildren(el, ctx), "**");
    case "em":
    case "i":
      return wrapInline(renderChildren(el, ctx), "*");
    case "code": {
      const code = textOf(el).replace(/\s+/g, " ").trim();
      if (!code) return "";
      const fence = "`".repeat(longestRun(code, "`") + 1);
      const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
      return `${fence}${pad}${code}${pad}${fence}`;
    }
    case "pre": {
      const code = textOf(el).replace(/^\n/, "").replace(/\s+$/, "");
      if (!code) return "";
      if (ctx.inline) return escapeText(code.replace(/\s+/g, " "));
      const fence = "`".repeat(Math.max(3, longestRun(code, "`") + 1));
      ctx.pres.push(`${fence}\n${code}\n${fence}`);
      return `\n\n${PRE}${ctx.pres.length - 1}${PRE}\n\n`;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = inlineText(renderChildren(el, { ...ctx, inline: true }));
      if (!text) return "";
      if (ctx.inline) return block(text, ctx);
      if (ctx.inList) return `\n\n**${text}**\n\n`;
      return `\n\n${"#".repeat(Number(el.tag[1]))} ${text}\n\n`;
    }
    case "ul":
    case "ol":
      return renderList(el, ctx);
    case "table":
      return ctx.inline ? block(inlineText(renderChildren(el, ctx)), ctx) : renderTable(el, ctx);
    case "blockquote": {
      if (ctx.inline) return block(renderChildren(el, ctx), ctx);
      const body = tidy(renderChildren(el, ctx));
      return body ? block(body.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"), ctx) : "";
    }
    case "dt":
    case "summary":
      return block(wrapInline(renderChildren(el, ctx), "**"), ctx);
    default: {
      const inner = renderChildren(el, ctx);
      return BLOCK.has(el.tag) ? block(inner, ctx) : inner;
    }
  }
}

function yamlString(s: string): string {
  return JSON.stringify(s.replace(/\s+/g, " ").trim());
}

/**
 * Convert a rendered HTML page to Markdown: YAML frontmatter from the head,
 * the <main> element (or <body>) as Markdown, then any JSON-LD blocks.
 */
export function htmlToMarkdown(html: string, pageUrl: string): string {
  return convertPage(html, pageUrl).markdown;
}

/** Markdown plus the page's <meta name="robots"> directive, which Markdown cannot carry. */
function convertPage(html: string, pageUrl: string): { markdown: string; robots?: string } {
  const doc = parseHtml(html);
  const head = find(doc, (e) => e.tag === "head") ?? doc;
  const meta = (key: string, value: string) =>
    find(head, (e) => e.tag === "meta" && e.attrs[key]?.toLowerCase() === value)?.attrs.content?.trim();

  const title = textOf(find(head, (e) => e.tag === "title") ?? { tag: "", attrs: {}, children: [] }).trim();
  const description = meta("name", "description");
  const canonical = find(head, (e) => e.tag === "link" && e.attrs.rel === "canonical")?.attrs.href;
  const image = meta("property", "og:image");

  const front = ["---"];
  if (title) front.push(`title: ${yamlString(title)}`);
  if (description) front.push(`description: ${yamlString(description)}`);
  front.push(`url: ${yamlString(resolveUrl(canonical ?? "", pageUrl) ?? pageUrl)}`);
  if (image) front.push(`image: ${yamlString(image)}`);
  front.push("---");

  const body =
    find(doc, (e) => e.tag === "main") ?? find(doc, (e) => e.tag === "body") ?? doc;
  const ctx: Ctx = { base: pageUrl, inline: false, inList: false, pres: [] };
  let content = tidy(renderNode(body, ctx));

  const jsonLd = findAll(
    doc,
    (e) => e.tag === "script" && (e.attrs.type ?? "").toLowerCase() === "application/ld+json"
  )
    .map((e) => {
      const raw = textOf(e).trim();
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    })
    .filter(Boolean);
  if (jsonLd.length) {
    content += "\n\n## Structured data\n\n" + jsonLd.map((j) => "```json\n" + j + "\n```").join("\n\n");
  }

  content = content
    .replace(new RegExp(`${PRE}(\\d+)${PRE}`, "g"), (_, k: string) => ctx.pres[Number(k)])
    .replace(new RegExp(INDENT, "g"), " ")
    .replace(new RegExp(SEP, "g"), "");

  return { markdown: `${front.join("\n")}\n\n${content}\n`, robots: meta("name", "robots") };
}

// ---------------------------------------------------------------------------
// Response wrapping (used by workers/app.ts)

function addVaryAccept(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Accept");
  else if (!/(^|,)\s*(accept|\*)\s*(,|$)/i.test(vary)) headers.set("Vary", `${vary}, Accept`);
}

/**
 * Negotiate an app response. HTML pages always gain `Vary: Accept` (the same
 * URL now has two representations); when the request prefers Markdown, a GET
 * HTML page is rendered to Markdown with the original status and headers.
 * Everything else (redirects, JSON, .ics, assets) passes through untouched.
 */
export async function negotiateMarkdown(request: Request, response: Response): Promise<Response> {
  const type = response.headers.get("Content-Type") ?? "";
  if (!/^text\/html\b/i.test(type)) return response;

  const headers = new Headers(response.headers);
  addVaryAccept(headers);

  if (request.method !== "GET" || !prefersMarkdown(request.headers.get("Accept"))) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const { markdown, robots } = convertPage(await response.text(), request.url);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  // Event pages say noindex only in a <meta> tag; keep that on the Markdown copy.
  if (robots && !headers.has("X-Robots-Tag")) headers.set("X-Robots-Tag", robots);
  headers.set("x-markdown-tokens", String(estimateTokens(markdown)));
  for (const h of ["Content-Length", "Content-Encoding", "ETag", "Last-Modified"]) headers.delete(h);
  return new Response(markdown, { status: response.status, statusText: response.statusText, headers });
}
