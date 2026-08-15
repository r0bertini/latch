# 🔗 Latch

**One line of code makes your existing website usable by agentic AI browsers.**

[**latch.tools**](https://latch.tools/?ref=github) · [Add WebMCP to your site](https://latch.tools/webmcp?ref=github) · [See which AI agents visit your site →](https://latch.tools/?ref=github)

```html
<script src="https://latch.tools/latch.js" defer></script>
```

AI browsers — ChatGPT Atlas, Perplexity Comet, Chrome's WebMCP origin trial,
Edge — can now *operate* web pages through [**WebMCP**](https://www.w3.org/),
the Web Model Context API (`document.modelContext`; formerly
`navigator.modelContext`, deprecated in Chrome 150). But out of the box they have to guess at
your buttons and forms, and they often fail. Latch reads your page (read-only)
and exposes its core actions as WebMCP tools an agent can call directly.

No MCP server. No backend. No rebuild. Zero dependencies. ~6&nbsp;KB.

## What it exposes

Latch inspects the DOM and, when it finds them, registers:

| Tool | Triggered by | What it does |
|------|--------------|-------------|
| `search_site` | a search input (`type=search`, `name=q`, `role=searchbox`, …) | types the query and submits the search form |
| `add_to_cart` | "Add to cart / bag / basket / Buy now" controls | clicks the add-to-cart control |
| `submit_form` | contact / booking / signup / quote forms | fills the mapped fields and submits |
| `navigate` | your `<nav>` / header links | moves to a named page |

If WebMCP isn't present in the browser, **Latch does nothing** — it never
mutates or breaks the host page.

## Install

Drop the tag in before `</body>`:

```html
<script src="https://latch.tools/latch.js" defer></script>
```

Or self-host: copy `latch.js` anywhere static and point the `src` at it.

### Manual control

Skip auto-init and drive it yourself:

```html
<script src="/latch.js" data-latch-manual defer></script>
<script>
  // ...prepare your page, then:
  window.Latch.init();
</script>
```

### Inspect without registering

`Latch.inspect()` returns what an agent *would* see — handy for debugging and the
"agent's-eye view" on the landing page:

```js
Latch.inspect();
// { webmcp: true, tools: [ { name: "search_site", why: "found a search input" }, ... ] }
```

Set `Latch.debug = true` before init for console diagnostics.

## How it works

1. On `DOMContentLoaded`, Latch feature-detects `document.modelContext` — falling
   back to the deprecated `navigator.modelContext` for pre-Chrome-150 builds —
   (supporting both the `registerTool()` and `provideContext({tools})` shapes).
2. It runs **read-only** DOM discovery to find your actionable surface.
3. It registers one WebMCP tool per capability, each with a JSON Schema an agent
   can reason about. `execute()` handlers dispatch native `input`/`change` events
   and `requestSubmit()` so your existing validation and handlers still run.
4. Failures are swallowed — the host page is never affected.

## Privacy & safety

- **Read-only discovery.** Latch never scrapes content off-site, makes network
  calls, or sends data anywhere. It only registers tools the browser's own agent
  can choose to call, with the user in the loop.
- **No backend, no keys, no cookies.**

## Browser support

WebMCP shipped in Chrome 146 and Edge 147 (March 2026) and is implemented by
agentic browsers (Atlas, Comet). Everywhere else, Latch is a no-op.

## See which AI agents are using your site

The `latch.js` above is free forever and needs no account. When you want to
know **which** agents are hitting your site and **what** they do, create a free
project key at [**latch.tools**](https://latch.tools/?ref=github):

- **Free** — live view of the WebMCP tool calls agents make on your site.
- **Pro — €19/mo per project** — 90-day history, per-agent breakdown, and a
  weekly email digest. [Upgrade →](https://latch.tools/?ref=github)

No tracking of your visitors, no cookies — Latch only reports the agent tool
calls the browser itself surfaces.

## Develop

```bash
node --check latch.js     # syntax check (the only "build")
python3 -m http.server    # then open http://localhost:8000
```

## License

MIT © Latch. See [`LICENSE`](./LICENSE).
