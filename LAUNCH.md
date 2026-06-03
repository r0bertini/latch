# Latch — launch kit

Goal of the launch: be the first easy, named answer to *"how do I make my site
work with AI browsers / WebMCP?"* — own that query and that moment while the
field is still thin. **First-signal metric: snippet installs (latch.js loads) in week 1.**

---

## 1. Show HN

**Title:** `Show HN: Latch – one line of code makes your site usable by AI browsers (WebMCP)`

**Body:**
> AI browsers (Atlas, Comet, Chrome 146+) can now drive web pages through WebMCP
> (`navigator.modelContext`), but most sites expose nothing, so agents fumble
> your buttons and forms. Latch is a ~6 KB script: drop one `<script>` tag and it
> reads your page read-only and registers `search_site`, `add_to_cart`,
> `submit_form`, and `navigate` as WebMCP tools. No server, no rewrite; if WebMCP
> isn't present it's a no-op and never touches your page.
>
> The landing page runs Latch on itself — there's a live "agent's-eye view"
> showing the tools an agent now sees. Source is MIT.
>
> It's early (the standard is ~4 months old) and I'd love feedback on the
> discovery heuristics and the tool schemas. Demo + code: <links>

Post Tue–Thu ~8–10am ET. Reply to every comment in the first 2 hours.

## 2. Product Hunt

- **Tagline:** "Make your site work inside AI browsers — in one line."
- **First comment:** the problem (agents fail on un-described UIs), the one-liner,
  the live agent's-eye view, "MIT, no backend." Ask: *what should the next tool be?*
- Assets: demo GIF of the agent's-eye view populating + a snippet-install GIF.

## 3. SEO — own "WebMCP" buyer-intent (do this first, it compounds)

Ship a page per intent query while competition is ~zero:
- `/webmcp` — "What is WebMCP and how do I add it to my site?"
- `/add-webmcp-to-your-site`
- `/webmcp-vs-mcp-server` — why no server is needed for a site
- per-platform: `/webmcp-for-shopify`, `/webmcp-for-webflow`, `/webmcp-for-wordpress`

Each: plain explanation → the one-liner → live agent's-eye demo → install.

## 4. Free lead-magnet → funnel

Ship a free **"WebMCP checker"**: paste a URL → it reports which tools Latch would
expose for that page (the `inspect()` output). Pure value, no signup; CTA is the
install snippet. Great as its own Show HN / Reddit post too.

## 5. Communities (be genuinely helpful, link only when asked)

r/webdev, r/nextjs, r/SaaS, r/shopify, Indie Hackers, the WebMCP / agentic-web
Discords. Answer real "how do I make my site agent-ready" questions; lead with the
explanation, mention Latch as one option.

**Hook line everywhere:**
> "AI browsers are already clicking through your site — and failing. Latch makes
> your buttons usable by agents in one line."

---

## Pre-launch checklist
- [ ] `latch.dev` registered + DNS → static host (Cloudflare Pages / GitHub Pages)
- [ ] `latch.js` served from `https://latch.dev/latch.js` (stable URL people will paste)
- [ ] Landing live; agent's-eye view works; copy button works
- [ ] Demo GIFs recorded (agent's-eye view + install)
- [ ] `/webmcp` SEO page published
- [ ] Quick **USPTO TESS** clearance on "Latch" before any paid branding (the
      `.dev` domain itself is low-risk; the name is contested in other software classes)
