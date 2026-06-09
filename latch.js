/*!
 * Latch — one line of code makes your site usable by agentic AI browsers.
 *
 * Latch reads your existing page (read-only) and exposes its core actions —
 * site search, add-to-cart, contact/booking forms, and navigation — as WebMCP
 * tools via `navigator.modelContext`, so AI browsers (ChatGPT Atlas, Comet,
 * Chrome 146+, Edge 147+) can actually operate your site. No MCP server, no
 * backend, no rebuild. If WebMCP isn't present, Latch does nothing and never
 * touches the host page.
 *
 * Usage:  <script src="latch.js" defer></script>
 *         (or:  <script src="latch.js" data-latch-manual defer></script>
 *               and call  Latch.init()  yourself.)
 *
 * Optional analytics: add  data-key="lk_…"  to send metadata-only tool-usage
 * telemetry to the Latch collector. Without a key, Latch makes no network
 * calls at all. See https://latch.tools/app
 *
 * Zero dependencies. MIT licensed. https://latch.tools
 */
(function (global) {
  "use strict";

  var VERSION = "0.1.0";

  // ---- optional, opt-in telemetry --------------------------------------
  // Off by default. Turns on ONLY when the script tag carries data-key:
  //   <script src=".../latch.js" data-key="lk_…" defer></script>
  // Reports metadata only — tool name, ok/fail, page path, timestamp — to the
  // Latch collector (derived from this script's own origin, or data-endpoint).
  // Never form contents, query strings, or PII. No key => zero network calls.
  var SELF = document.currentScript;
  var CFG = (function () {
    var key = SELF && SELF.getAttribute("data-key");
    if (!key) return { enabled: false };
    var ep = (SELF && SELF.getAttribute("data-endpoint")) || "";
    if (!ep) {
      try { ep = new URL(SELF.src).origin + "/api/v1/collect"; }
      catch (e) { ep = "/api/v1/collect"; }
    }
    return { enabled: true, key: key, endpoint: ep };
  })();

  var Telemetry = {
    enabled: CFG.enabled,
    queue: [],
    track: function (type, tool, ok) {
      if (!this.enabled) return;
      var p = "";
      try { p = String(location.pathname).slice(0, 200); } catch (e) {}
      this.queue.push({
        t: type, tool: tool || null,
        ok: ok === undefined ? null : (ok ? 1 : 0),
        p: p, ts: Date.now()
      });
    },
    flush: function () {
      if (!this.enabled || !this.queue.length) return;
      var payload = JSON.stringify({ k: CFG.key, events: this.queue.splice(0) });
      try {
        // text/plain keeps it a CORS "simple request" (no preflight).
        if (global.navigator && navigator.sendBeacon) {
          navigator.sendBeacon(CFG.endpoint, new Blob([payload], { type: "text/plain" }));
        } else if (global.fetch) {
          fetch(CFG.endpoint, { method: "POST", body: payload,
            headers: { "content-type": "text/plain" }, keepalive: true, mode: "no-cors" });
        }
      } catch (e) { if (Latch.debug) console.warn("[latch] telemetry flush failed", e); }
    }
  };

  // Wrap a tool's execute() so each agent invocation is recorded with its
  // outcome. sendBeacon survives the navigation/submit some tools trigger.
  function instrument(tool) {
    if (!Telemetry.enabled || typeof tool.execute !== "function") return tool;
    var orig = tool.execute, name = tool.name;
    tool.execute = function () {
      var r;
      try { r = orig.apply(this, arguments); }
      catch (e) { Telemetry.track("call", name, false); Telemetry.flush(); throw e; }
      if (r && typeof r.then === "function") {
        return r.then(
          function (v) { Telemetry.track("call", name, !(v && v.isError)); Telemetry.flush(); return v; },
          function (e) { Telemetry.track("call", name, false); Telemetry.flush(); throw e; }
        );
      }
      Telemetry.track("call", name, !(r && r.isError));
      Telemetry.flush();
      return r;
    };
    return tool;
  }

  // ---- WebMCP capability detection -------------------------------------
  // The Web Model Context API is still settling; support both the
  // registerTool() shape and the provideContext({tools}) shape, and bail
  // out cleanly when neither exists.
  function mc() {
    return global.navigator && global.navigator.modelContext;
  }
  function webmcpAvailable() {
    var m = mc();
    return !!(m && (typeof m.registerTool === "function" ||
                    typeof m.provideContext === "function"));
  }

  // ---- tiny DOM helpers (all read-only) --------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function visible(el) {
    if (!el) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    var r = el.getClientRects();
    return r && r.length > 0;
  }
  function labelFor(el) {
    if (!el) return "";
    var id = el.id;
    if (id) {
      var lab = document.querySelector('label[for="' + cssEscape(id) + '"]');
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    var wrap = el.closest && el.closest("label");
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    return (el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
            el.getAttribute("name") || el.getAttribute("title") || "").trim();
  }
  function cssEscape(s) {
    if (global.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }
  function text(el) { return el ? (el.textContent || "").trim() : ""; }

  // ---- discovery: find the page's actionable surface -------------------
  function findSearchInput() {
    var sels = [
      'input[type="search"]',
      'input[name*="search" i]',
      'input[name="q"]',
      'input[aria-label*="search" i]',
      'input[placeholder*="search" i]',
      'form[role="search"] input[type="text"]',
      '[role="searchbox"]'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = $(sels[i]);
      if (el && visible(el)) return el;
    }
    return null;
  }

  function findAddToCartButtons() {
    var hits = [];
    $all('button, a, input[type="submit"], [role="button"]').forEach(function (el) {
      if (!visible(el)) return;
      var hay = (text(el) + " " + (el.getAttribute("aria-label") || "") + " " +
                 (el.name || "") + " " + (el.className || "")).toLowerCase();
      if (/\b(add to cart|add to bag|add to basket|buy now|add-to-cart)\b/.test(hay) ||
          el.matches('[data-add-to-cart], [name="add"], .add-to-cart, .add_to_cart')) {
        hits.push(el);
      }
    });
    return hits;
  }

  // A "lead" form = contact / booking / signup / quote. We surface the first
  // few text-ish fields so an agent can fill and submit it.
  function findLeadForms() {
    return $all("form").filter(function (f) {
      if (!visible(f)) return false;
      if (f.matches('[role="search"]')) return false;
      var hay = (f.id + " " + f.className + " " + (f.getAttribute("name") || "") +
                 " " + (f.action || "") + " " + text(f)).toLowerCase();
      var looksLead = /(contact|booking|book|appointment|enquir|inquir|quote|signup|sign[- ]?up|subscribe|demo|lead|message)/.test(hay);
      var hasEmailish = !!f.querySelector('input[type="email"], input[name*="email" i], textarea');
      return looksLead || hasEmailish;
    });
  }

  function formFields(form) {
    return $all("input, textarea, select", form).filter(function (el) {
      var t = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].indexOf(t) !== -1) return false;
      return visible(el);
    }).map(function (el) {
      return {
        el: el,
        name: el.name || el.id || labelFor(el) || (el.type || "field"),
        label: labelFor(el),
        type: (el.type || el.tagName).toLowerCase(),
        required: !!el.required
      };
    });
  }

  // Top-level navigation links, de-duplicated by destination.
  function findNavLinks(limit) {
    var seen = {}, out = [];
    var scope = $('nav, header, [role="navigation"]') || document.body;
    $all("a[href]", scope).forEach(function (a) {
      if (!visible(a)) return;
      var href = a.href, label = text(a);
      if (!href || !label || href.indexOf("javascript:") === 0) return;
      if (seen[href]) return;
      seen[href] = 1;
      out.push({ label: label.slice(0, 80), href: href });
    });
    return out.slice(0, limit || 25);
  }

  // ---- tool registration ----------------------------------------------
  var registered = [];

  function ok(message, extra) {
    var content = [{ type: "text", text: message }];
    return Object.assign({ content: content }, extra || {});
  }
  function fail(message) {
    return { content: [{ type: "text", text: message }], isError: true };
  }

  function register(tool) {
    var m = mc();
    tool = instrument(tool);
    try {
      if (typeof m.registerTool === "function") {
        m.registerTool(tool);
      } else {
        // provideContext shape: collect and push the whole set at the end.
        register._batch = register._batch || [];
        register._batch.push(tool);
      }
      registered.push(tool.name);
    } catch (e) {
      // Never let a registration failure surface to the host page.
      if (Latch.debug) console.warn("[latch] could not register", tool.name, e);
    }
  }
  function flushBatch() {
    var m = mc();
    if (register._batch && typeof m.provideContext === "function") {
      try { m.provideContext({ tools: register._batch }); }
      catch (e) { if (Latch.debug) console.warn("[latch] provideContext failed", e); }
    }
  }

  function buildTools() {
    var search = findSearchInput();
    if (search) {
      register({
        name: "search_site",
        description: "Search this website for a query and submit the search form.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "What to search for." } },
          required: ["query"]
        },
        execute: function (args) {
          var q = (args && args.query) || "";
          search.focus();
          search.value = q;
          fire(search, "input"); fire(search, "change");
          var form = search.form || search.closest("form");
          if (form) {
            if (typeof form.requestSubmit === "function") form.requestSubmit();
            else form.submit();
          } else {
            search.dispatchEvent(new KeyboardEvent("keydown",
              { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          }
          return ok('Searched this site for "' + q + '".');
        }
      });
    }

    var carts = findAddToCartButtons();
    if (carts.length) {
      register({
        name: "add_to_cart",
        description: "Add the current product to the cart/bag on this page.",
        inputSchema: { type: "object", properties: {} },
        execute: function () {
          var btn = carts.find(visible) || carts[0];
          if (!btn) return fail("No add-to-cart control is available on this page.");
          btn.click();
          return ok("Clicked “" + (text(btn) || "Add to cart") + "”.");
        }
      });
    }

    findLeadForms().forEach(function (form, idx) {
      var fields = formFields(form);
      if (!fields.length) return;
      var props = {}, label = (text($("legend, h1, h2, h3", form)) ||
                               form.getAttribute("aria-label") || "form").slice(0, 60);
      fields.forEach(function (f) {
        props[f.name] = {
          type: f.type === "number" ? "number" : "string",
          description: (f.label || f.name) + (f.required ? " (required)" : "")
        };
      });
      register({
        name: idx === 0 ? "submit_form" : "submit_form_" + (idx + 1),
        description: "Fill in and submit the “" + label + "” form on this page.",
        inputSchema: {
          type: "object",
          properties: props,
          required: fields.filter(function (f) { return f.required; })
                          .map(function (f) { return f.name; })
        },
        execute: function (args) {
          args = args || {};
          var filled = [];
          fields.forEach(function (f) {
            if (Object.prototype.hasOwnProperty.call(args, f.name)) {
              if (f.el.tagName === "SELECT") {
                f.el.value = args[f.name];
              } else if (f.type === "checkbox" || f.type === "radio") {
                f.el.checked = !!args[f.name];
              } else {
                f.el.value = args[f.name];
              }
              fire(f.el, "input"); fire(f.el, "change");
              filled.push(f.name);
            }
          });
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
          return ok("Submitted the " + label + " form (filled: " +
                    (filled.join(", ") || "nothing") + ").");
        }
      });
    });

    var links = findNavLinks();
    if (links.length) {
      register({
        name: "navigate",
        description: "Go to one of this site's main pages. " +
          "Available destinations: " +
          links.map(function (l) { return l.label; }).join(", ") + ".",
        inputSchema: {
          type: "object",
          properties: {
            destination: {
              type: "string",
              description: "The link label or URL to navigate to.",
              enum: links.map(function (l) { return l.label; })
            }
          },
          required: ["destination"]
        },
        execute: function (args) {
          var d = ((args && args.destination) || "").toLowerCase();
          var hit = links.find(function (l) {
            return l.label.toLowerCase() === d || l.href.toLowerCase() === d;
          }) || links.find(function (l) {
            return l.label.toLowerCase().indexOf(d) !== -1;
          });
          if (!hit) return fail('No page matching "' + (args && args.destination) + '".');
          global.location.href = hit.href;
          return ok("Navigating to " + hit.label + ".");
        }
      });
    }
  }

  // ---- public API ------------------------------------------------------
  var Latch = {
    version: VERSION,
    debug: false,
    registered: registered,

    // Returns what an agent would see, without registering anything.
    // Powers the "agent's-eye view" demo and is handy for debugging.
    inspect: function () {
      var search = findSearchInput();
      var carts = findAddToCartButtons();
      var forms = findLeadForms();
      var links = findNavLinks();
      var tools = [];
      if (search) tools.push({ name: "search_site", why: "found a search input" });
      if (carts.length) tools.push({ name: "add_to_cart", why: carts.length + " add-to-cart control(s)" });
      forms.forEach(function (f, i) {
        tools.push({
          name: i === 0 ? "submit_form" : "submit_form_" + (i + 1),
          why: formFields(f).length + " field(s) in a contact/booking-style form"
        });
      });
      if (links.length) tools.push({ name: "navigate", why: links.length + " navigation link(s)" });
      return { webmcp: webmcpAvailable(), tools: tools };
    },

    init: function () {
      if (Latch._done) return Latch;
      Latch._done = true;
      if (!webmcpAvailable()) {
        if (Latch.debug) console.info("[latch] WebMCP not available; standing down.");
        return Latch;
      }
      try {
        buildTools();
        flushBatch();
        if (Telemetry.enabled) {
          Telemetry.track("pageview");
          registered.forEach(function (n) { Telemetry.track("register", n, true); });
          Telemetry.flush();
        }
        if (Latch.debug) console.info("[latch] registered tools:", registered.slice());
      } catch (e) {
        if (Latch.debug) console.warn("[latch] init failed (host page unaffected):", e);
      }
      return Latch;
    }
  };

  global.Latch = Latch;

  // Auto-init unless the host opts out with data-latch-manual.
  var manual = SELF && SELF.hasAttribute("data-latch-manual");
  if (!manual) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { Latch.init(); });
    } else {
      Latch.init();
    }
  }
})(typeof window !== "undefined" ? window : this);
