/**
 * The admin dashboard, as a single self-contained HTML document.
 *
 * Why a string in a .ts file rather than a .html asset: the Dockerfile
 * copies only `dist/` and `drizzle/` into the runtime image, and `tsc`
 * doesn't copy non-TS files. Embedding it here means the page ships with
 * the compiled output and can never go missing in production.
 *
 * Constraints for anyone editing this:
 * - NO template literals inside the payload (no backticks, no `${`) —
 *   they would terminate or interpolate into this outer literal. The
 *   embedded script uses string concatenation on purpose.
 * - No external requests: no CDN, no webfonts. It must render on a box
 *   with no outbound internet.
 * - Untrusted values (user ids, emails, card text) are inserted with
 *   textContent / createTextNode only — never innerHTML.
 *
 * Layout rules this page holds itself to:
 * - One 1180px column, one 8px spacing scale, one radius scale. Every
 *   card is the same width and the same internal padding, so the page
 *   reads as a single grid rather than a pile of panels.
 * - Four pinned KPIs — not twelve. The rest of the all-time figures live
 *   on the Overview tab where they are one glance, not a permanent wall.
 * - Every table on the page is the same component: search, sort, page
 *   size, pager. No table is ever longer than its page size, so no tab
 *   can grow into an endless scroll.
 *
 * Chart colours come from the validated reference data-viz palette; the
 * categorical slots in use (blue / orange) pass the CVD and lightness
 * gates in both light and dark mode. Page chrome is deliberately neutral
 * so the only saturated ink on screen is data.
 */
export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Scrolt · Analytics</title>
<!-- Inline SVG favicon: stops the browser requesting /favicon.ico (which
     the API has no route for) without adding an external fetch. -->
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='4' fill='%23ea580c'/><rect x='4' y='8' width='2' height='5' fill='white'/><rect x='7' y='5' width='2' height='8' fill='white'/><rect x='10' y='3' width='2' height='10' fill='white'/></svg>">
<style>
  /* ── tokens ─────────────────────────────────────────────── */
  :root {
    color-scheme: light;
    --page:      #fafaf9;
    --surface:   #ffffff;
    --surface-2: #f5f4f2;
    --ink:       #18181b;
    --ink-2:     #52525b;
    --muted:     #8b8a84;
    --line:      #e8e6e2;
    --line-2:    #d5d2cc;
    --brand:     #ea580c;
    --grid:      #edebe7;
    --axis:      #c9c6c0;
    --series-1:  #2a78d6;
    --series-2:  #eb6834;
    --series-3:  #1baf7a;
    --seq-100:   #cde2fb;
    --seq-250:   #86b6ef;
    --seq-400:   #3987e5;
    --seq-550:   #1c5cab;
    --seq-700:   #0d366b;
    --good:      #0ca30c;
    --warning:   #fab219;
    --critical:  #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --page:      #0a0a0a;
      --surface:   #131313;
      --surface-2: #1b1b1a;
      --ink:       #fafaf9;
      --ink-2:     #b4b2ac;
      --muted:     #86847d;
      --line:      #262624;
      --line-2:    #3a3a37;
      --brand:     #fb923c;
      --grid:      #232322;
      --axis:      #3d3d3a;
      --series-1:  #3987e5;
      --series-2:  #d95926;
      --series-3:  #199e70;
      --seq-100:   #104281;
      --seq-250:   #184f95;
      --seq-400:   #256abf;
      --seq-550:   #3987e5;
      --seq-700:   #86b6ef;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page:      #0a0a0a;
    --surface:   #131313;
    --surface-2: #1b1b1a;
    --ink:       #fafaf9;
    --ink-2:     #b4b2ac;
    --muted:     #86847d;
    --line:      #262624;
    --line-2:    #3a3a37;
    --brand:     #fb923c;
    --grid:      #232322;
    --axis:      #3d3d3a;
    --series-1:  #3987e5;
    --series-2:  #d95926;
    --series-3:  #199e70;
    --seq-100:   #104281;
    --seq-250:   #184f95;
    --seq-400:   #256abf;
    --seq-550:   #3987e5;
    --seq-700:   #86b6ef;
  }

  /* One type scale, one spacing scale, one radius scale. Nothing on the
     page is allowed a size that isn't listed here. */
  :root {
    --fs-1: 11px;     /* micro caps: column heads, KPI keys */
    --fs-2: 12.5px;   /* secondary text, table cells */
    --fs-3: 13.5px;   /* body, tabs, card titles */
    --fs-4: 15px;     /* section titles */
    --fs-5: 21px;     /* supporting figures */
    --fs-6: 34px;     /* the pinned KPI figures */
    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 20px; --s5: 32px; --s6: 48px;
    --r-1: 6px; --r-2: 10px; --r-3: 14px;
    --col: 1180px;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--page);
    color: var(--ink);
    font: 400 var(--fs-3)/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .wrap { max-width: var(--col); margin: 0 auto; padding: 0 var(--s5); }
  .grow { flex: 1 1 auto; }
  .subtle { color: var(--muted); font-size: var(--fs-2); }
  .num { font-variant-numeric: tabular-nums; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: var(--r-1); }

  /* ── top bar ────────────────────────────────────────────── */
  /* Identity row and tab row share one sticky container, so they can
     never separate or double-stack at a scroll position. */
  .topbar {
    position: sticky; top: 0; z-index: 30;
    background: var(--page);
    border-bottom: 1px solid var(--line);
  }
  .bar { display: flex; align-items: center; gap: var(--s3); height: 60px; }
  .mark {
    width: 20px; height: 20px; border-radius: var(--r-1);
    background: var(--brand); flex: none;
  }
  .bar h1 {
    font-size: var(--fs-4); font-weight: 600; margin: 0;
    letter-spacing: -0.015em;
  }
  .chip {
    font-size: var(--fs-1); color: var(--ink-2); padding: 3px var(--s2);
    border: 1px solid var(--line); border-radius: 999px;
    letter-spacing: 0.04em; text-transform: uppercase; cursor: help;
  }

  /* ── tabs ───────────────────────────────────────────────── */
  .tabs { display: flex; gap: var(--s4); overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    font: inherit; font-size: var(--fs-3); color: var(--muted);
    padding: 0 0 var(--s3); margin-bottom: -1px;
    border-bottom: 2px solid transparent; white-space: nowrap;
  }
  .tabs button:hover { color: var(--ink-2); }
  .tabs button[aria-selected="true"] {
    color: var(--ink); font-weight: 500; border-bottom-color: var(--ink);
  }

  /* ── controls ───────────────────────────────────────────── */
  .filters {
    display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center;
    padding: var(--s4) 0;
  }
  .lbl {
    font-size: var(--fs-1); color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .seg {
    display: inline-flex; padding: 2px; gap: 2px;
    border: 1px solid var(--line); border-radius: var(--r-1);
    background: var(--surface-2);
  }
  .seg button {
    appearance: none; border: 0; background: transparent; color: var(--ink-2);
    font: inherit; font-size: var(--fs-2); padding: 4px 10px; cursor: pointer;
    border-radius: var(--r-1);
  }
  .seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); font-weight: 600; }
  .seg button:hover:not([aria-pressed="true"]) { color: var(--ink); }
  .btn {
    appearance: none; font: inherit; font-size: var(--fs-2); padding: 5px 11px;
    border: 1px solid var(--line); border-radius: var(--r-1);
    background: var(--surface); color: var(--ink-2); cursor: pointer;
  }
  .btn:hover { border-color: var(--line-2); color: var(--ink); }
  .btn[aria-pressed="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); font-weight: 600; }
  label.check {
    display: inline-flex; align-items: center; gap: var(--s2);
    font-size: var(--fs-2); color: var(--ink-2); cursor: pointer;
  }
  select.sel {
    appearance: none; font: inherit; font-size: var(--fs-2);
    padding: 4px 24px 4px 9px; border-radius: var(--r-1);
    border: 1px solid var(--line); background: var(--surface); color: var(--ink-2);
    cursor: pointer;
    background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                      linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: right 11px center, right 6px center;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }
  input.field {
    font: inherit; font-size: var(--fs-2); padding: 5px 10px;
    border: 1px solid var(--line); border-radius: var(--r-1);
    background: var(--surface); color: var(--ink); width: 200px;
  }
  input.field::placeholder { color: var(--muted); }

  /* ── cards ──────────────────────────────────────────────── */
  /* No shadows. A hairline is enough separation when spacing is honest,
     and it keeps every panel on exactly the same visual plane. */
  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-2); padding: var(--s4);
    display: flex; flex-direction: column;
  }
  .card + .card, .stack > * + * { margin-top: var(--s4); }
  .card-head {
    display: flex; align-items: baseline; gap: var(--s2);
    margin: 0 0 var(--s4);
  }
  .card-head h2 {
    font-size: var(--fs-4); font-weight: 600; margin: 0;
    letter-spacing: -0.01em;
  }
  .card-head .note { color: var(--muted); font-size: var(--fs-2); margin: 0; }
  /* The long "why this metric is defined this way" prose lives behind
     this, one hover away instead of on screen at all times. */
  .help {
    appearance: none; border: 1px solid var(--line); background: transparent;
    color: var(--muted); cursor: help; font: inherit; font-size: 10px;
    width: 15px; height: 15px; border-radius: 999px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    align-self: center;
  }
  .help:hover { color: var(--ink); border-color: var(--line-2); }
  /* Equal-height columns: the grid stretches, the card fills. */
  .cols { display: grid; gap: var(--s4); grid-template-columns: 1fr 1fr; align-items: stretch; }
  .cols > .card { margin-top: 0; height: 100%; }
  .stack { display: block; }

  /* ── KPI strip ──────────────────────────────────────────── */
  /* Exactly four, on a fixed 4-column grid, so it is one clean row at
     every width — never an orphan tile on a second row. */
  .kpis {
    display: grid; grid-template-columns: repeat(4, 1fr);
    border: 1px solid var(--line); border-radius: var(--r-2);
    background: var(--surface); overflow: hidden; margin-bottom: var(--s4);
  }
  .kpi { padding: var(--s4); border-left: 1px solid var(--line); }
  .kpi:first-child { border-left: 0; }
  .kpi .k {
    color: var(--muted); font-size: var(--fs-1);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .kpi .v {
    font-size: var(--fs-6); font-weight: 600; line-height: 1.1;
    letter-spacing: -0.025em; margin-top: var(--s2);
    font-variant-numeric: tabular-nums;
  }
  .kpi .sub { color: var(--muted); font-size: var(--fs-2); margin-top: var(--s1); }

  /* Secondary figures — same grid, quieter, four per row. */
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s4) 0; }
  .fact { padding: 0 var(--s4); border-left: 1px solid var(--line); }
  .fact:nth-child(4n + 1) { border-left: 0; padding-left: 0; }
  .fact .k {
    color: var(--muted); font-size: var(--fs-1);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .fact .v {
    font-size: var(--fs-5); font-weight: 600; line-height: 1.2;
    margin-top: var(--s1); letter-spacing: -0.015em;
    font-variant-numeric: tabular-nums;
  }
  .fact .sub { color: var(--muted); font-size: var(--fs-1); margin-top: 2px; }

  /* ── charts ─────────────────────────────────────────────── */
  .chart { width: 100%; }
  .chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .legend { display: flex; flex-wrap: wrap; gap: var(--s4); margin: 0 0 var(--s3); }
  .legend .item { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--fs-2); color: var(--ink-2); }
  .legend .swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .legend .line-key { width: 14px; height: 2px; border-radius: 2px; flex: none; }
  .hit { fill: transparent; cursor: pointer; }
  .hit:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

  /* ── tooltip ────────────────────────────────────────────── */
  #tip {
    position: fixed; z-index: 60; pointer-events: none; opacity: 0;
    transition: opacity .09s ease-out;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--line-2); border-radius: var(--r-2);
    box-shadow: 0 4px 16px rgba(0,0,0,0.14);
    padding: 9px 11px; font-size: var(--fs-2); min-width: 132px; max-width: 280px;
  }
  #tip .t-head { font-weight: 600; margin-bottom: 6px; }
  #tip .t-row { display: flex; align-items: center; gap: 7px; margin-top: 3px; }
  #tip .t-key { width: 12px; height: 2px; border-radius: 2px; flex: none; }
  #tip .t-val { font-weight: 600; font-variant-numeric: tabular-nums; }
  #tip .t-name { color: var(--ink-2); }

  /* ── data table ─────────────────────────────────────────── */
  .dt { display: flex; flex-direction: column; min-height: 0; }
  .dt-bar {
    display: flex; align-items: center; gap: var(--s2);
    margin-bottom: var(--s3);
  }
  .dt-body { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: var(--fs-2); }
  th, td { text-align: right; padding: 7px var(--s3); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; }
  thead th {
    color: var(--muted); font-weight: 500; font-size: var(--fs-1);
    text-transform: uppercase; letter-spacing: 0.05em;
    border-bottom: 1px solid var(--line-2);
    padding-top: 0; padding-bottom: var(--s2);
  }
  thead th.sortable { cursor: pointer; user-select: none; }
  thead th.sortable:hover { color: var(--ink); }
  thead th .caret { color: var(--ink); }
  tbody tr { border-bottom: 1px solid var(--line); }
  tbody tr:last-child { border-bottom: 0; }
  tbody tr:hover { background: var(--surface-2); }
  td.num { font-variant-numeric: tabular-nums; }
  .dim { color: var(--muted); }
  .pill {
    display: inline-block; padding: 1px 7px; border-radius: 999px;
    font-size: var(--fs-1); border: 1px solid var(--line); color: var(--ink-2);
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }

  /* ── pager ──────────────────────────────────────────────── */
  .dt-foot {
    display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap;
    margin-top: var(--s3); padding-top: var(--s3);
    border-top: 1px solid var(--line);
    font-size: var(--fs-2); color: var(--muted);
  }
  /* Size select and pager travel together and stay right-aligned, so a
     footer that wraps in a half-width card still reads as one cluster
     rather than two stray controls. */
  .dt-tools { display: flex; align-items: center; gap: var(--s3); margin-left: auto; }
  .pager { display: inline-flex; align-items: center; gap: 2px; }
  .pager button {
    appearance: none; font: inherit; font-size: var(--fs-2);
    min-width: 28px; height: 28px; padding: 0 7px;
    border: 1px solid transparent; border-radius: var(--r-1);
    background: transparent; color: var(--ink-2); cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .pager button:hover:not(:disabled):not([aria-current="page"]) {
    background: var(--surface-2); color: var(--ink);
  }
  .pager button[aria-current="page"] {
    background: var(--ink); color: var(--page); font-weight: 600;
  }
  .pager button:disabled { opacity: .35; cursor: default; }
  .pager .gap { padding: 0 var(--s1); color: var(--muted); }

  /* ── heatmap cells ──────────────────────────────────────── */
  .heat { border-collapse: separate; border-spacing: 2px; }
  .heat td.cell { text-align: center; border-radius: var(--r-1); font-variant-numeric: tabular-nums; padding: 7px 8px; min-width: 44px; }
  .heat td.na { background: transparent; color: var(--muted); }
  .heat tbody tr { border: 0; }
  .heat tbody tr:hover { background: transparent; }
  .heat thead th { border-bottom: 0; }

  /* ── secondary tables (behind the toggle) ───────────────── */
  .table-twin { display: none; margin-top: var(--s4); border-top: 1px solid var(--line); padding-top: var(--s4); }
  .show-tables .table-twin { display: block; }
  .table-twin h3 {
    font-size: var(--fs-1); font-weight: 500; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 var(--s3);
  }

  /* ── states ─────────────────────────────────────────────── */
  .empty {
    border: 1px dashed var(--line-2); border-radius: var(--r-2); padding: var(--s4);
    color: var(--ink-2); font-size: var(--fs-2); background: var(--page);
  }
  #app.loading { opacity: .5; transition: opacity .12s; }
  #app { padding-bottom: var(--s6); }
  .err { color: var(--critical); font-size: var(--fs-2); }

  /* ── gate ───────────────────────────────────────────────── */
  #gate { max-width: 360px; margin: 16vh auto; padding: 0 var(--s5); }
  #gate .mark { margin-bottom: var(--s4); }
  #gate h2 { font-size: var(--fs-4); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  #gate form { display: flex; gap: var(--s2); margin-top: var(--s4); }
  #gate input {
    flex: 1; font: inherit; font-size: var(--fs-3); padding: 8px 11px;
    border-radius: var(--r-1); border: 1px solid var(--line-2);
    background: var(--surface); color: var(--ink);
  }
  #gate button {
    font: inherit; font-size: var(--fs-3); font-weight: 600; padding: 8px 16px;
    border-radius: var(--r-1); border: 0;
    background: var(--ink); color: var(--page); cursor: pointer;
  }

  /* ── narrow ─────────────────────────────────────────────── */
  @media (max-width: 900px) {
    .wrap { padding: 0 var(--s4); }
    /* The freshness stamp is the first thing to go: wrapped onto three
       lines it doubles the header height for a detail nobody scans on a
       phone. Refresh still restates it. */
    #stamp { display: none; }
    .tabs { padding-right: var(--s4); }
    .cols { grid-template-columns: 1fr; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .kpi:nth-child(odd) { border-left: 0; }
    .kpi:nth-child(n + 3) { border-top: 1px solid var(--line); }
    .facts { grid-template-columns: repeat(2, 1fr); }
    .fact:nth-child(4n + 1) { border-left: 1px solid var(--line); padding-left: var(--s4); }
    .fact:nth-child(odd) { border-left: 0; padding-left: 0; }
    input.field { width: 140px; }
  }
</style>
</head>
<body>
<div id="tip" role="status" aria-live="polite"></div>

<!-- Token gate. The page ships with no data in it; everything is fetched
     with an X-Admin-Token header after this succeeds. -->
<section id="gate" hidden>
  <span class="mark" aria-hidden></span>
  <h2>Scrolt analytics</h2>
  <p class="subtle" style="margin:6px 0 0">Enter the admin token to continue.</p>
  <form id="gate-form">
    <input id="gate-input" type="password" placeholder="Admin token" autocomplete="current-password" spellcheck="false" required>
    <button type="submit">Open</button>
  </form>
  <p id="gate-err" class="err" style="margin:12px 0 0" hidden></p>
</section>

<div id="shell" hidden>
  <div class="topbar">
    <div class="wrap bar">
      <span class="mark" aria-hidden></span>
      <h1>Scrolt</h1>
      <span class="chip" title="Every metric counts logged-out visitors too. Anonymous ids (anon_*) are one per browser; signing in merges that history into the account, so &quot;logged out&quot; means still-unconverted.">Analytics</span>
      <span class="grow"></span>
      <span class="subtle" id="stamp"></span>
      <button class="btn" id="theme-toggle" type="button" title="Toggle light / dark">Theme</button>
      <button class="btn" id="signout" type="button">Lock</button>
    </div>
    <!-- One tab per question. Only the active tab is built, so a chart is
         never laid out inside a hidden container at zero width. -->
    <div class="wrap">
      <nav class="tabs" id="tabs" role="tablist" aria-label="Sections"></nav>
    </div>
  </div>

  <div class="wrap">
    <!-- One toolbar, scoping everything below it. Controls that apply to a
         single tab (cohort width) are revealed only on that tab. -->
    <div class="filters" role="group" aria-label="Filters">
      <span class="lbl">Range</span>
      <div class="seg" id="range-seg">
        <button type="button" data-days="7">7d</button>
        <button type="button" data-days="30">30d</button>
        <button type="button" data-days="90">90d</button>
        <button type="button" data-days="365">1y</button>
      </div>
      <span class="lbl" id="weeks-lbl" hidden>Cohorts</span>
      <div class="seg" id="weeks-seg" hidden>
        <button type="button" data-weeks="4">4w</button>
        <button type="button" data-weeks="8">8w</button>
        <button type="button" data-weeks="16">16w</button>
      </div>
      <span class="grow"></span>
      <label class="check">
        <input type="checkbox" id="only-authed"> Signed-in only
      </label>
      <button class="btn" id="tables-toggle" type="button" aria-pressed="false">Data tables</button>
      <button class="btn" id="refresh" type="button">Refresh</button>
    </div>

    <div id="app"></div>
    <p id="app-err" class="err" hidden></p>
  </div>
</div>

<script>
(function () {
  "use strict";

  var TOKEN_KEY = "scrolt_admin_token";
  var THEME_KEY = "scrolt_admin_theme";
  var TAB_KEY = "scrolt_admin_tab";

  // Base for every API call. Derived from the current path rather than
  // hardcoded so the page works whether it was served at /admin or
  // /admin/, and keeps working behind a proxy that adds a prefix.
  // A bare relative "api/x" would NOT work: from /admin it resolves to
  // /api/x, silently dropping the mount point.
  var API_BASE = window.location.pathname.replace(/\/+$/, "") + "/api/";

  // How much the one batched request pulls down. Tables page through
  // this client-side, which is why the ceilings are generous: paging
  // must never be a window onto a truncated set the operator can't see.
  var FETCH = { users: 500, events: 500, cards: 100 };

  var state = {
    token: null,
    data: null,
    tab: "overview",
    days: 30,
    weeks: 8,
    onlyAuthed: false,
    tables: false,
    loading: false
  };

  // ── tiny DOM helpers ──────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function svg(name, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== null && attrs[k] !== undefined) {
          n.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ── formatting ────────────────────────────────────────────
  function fmt(n) {
    if (n === null || n === undefined) return "—";
    var v = Number(n);
    if (!isFinite(v)) return "—";
    if (Math.abs(v) >= 1000000) return (Math.round(v / 100000) / 10) + "M";
    if (Math.abs(v) >= 10000) return (Math.round(v / 100) / 10) + "K";
    return v.toLocaleString("en-US");
  }
  function pctStr(n) {
    if (n === null || n === undefined) return "—";
    return (Math.round(Number(n) * 10) / 10) + "%";
  }
  function dur(sec) {
    if (!sec) return "—";
    if (sec < 60) return sec + "s";
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + "m" + (s ? " " + s + "s" : "");
  }
  function shortDay(iso) {
    // 'YYYY-MM-DD' -> 'Jul 3'. Parsed as UTC to avoid a local-timezone
    // shift renaming the day.
    var d = new Date(iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  function shortId(id) {
    if (!id) return "";
    return id.length > 18 ? id.slice(0, 10) + "…" + id.slice(-5) : id;
  }

  // ── tooltip ───────────────────────────────────────────────
  var tip = document.getElementById("tip");
  function showTip(evt, head, rows) {
    clear(tip);
    tip.appendChild(el("div", "t-head", head));
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var line = el("div", "t-row");
      if (r.color) {
        var key = el("span", "t-key");
        key.style.background = r.color;
        line.appendChild(key);
      }
      line.appendChild(el("span", "t-val", r.value));
      line.appendChild(el("span", "t-name", r.name));
      tip.appendChild(line);
    }
    tip.style.opacity = "1";
    moveTip(evt);
  }
  function moveTip(evt) {
    var pad = 14;
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var x = evt.clientX + pad;
    var y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.style.opacity = "0"; }

  /**
   * Attach hover + keyboard readout to a mark. The hit rect is passed in
   * separately from the painted mark so the target can be larger than
   * the ink (see the 24px minimum in the interaction spec).
   */
  function bindTip(hitNode, head, rows) {
    hitNode.setAttribute("tabindex", "0");
    hitNode.setAttribute("role", "img");
    var flat = rows.map(function (r) { return r.value + " " + r.name; }).join(", ");
    hitNode.setAttribute("aria-label", head + ": " + flat);
    hitNode.addEventListener("pointerenter", function (e) { showTip(e, head, rows); });
    hitNode.addEventListener("pointermove", moveTip);
    hitNode.addEventListener("pointerleave", hideTip);
    hitNode.addEventListener("focus", function () {
      var b = hitNode.getBoundingClientRect();
      showTip({ clientX: b.left + b.width / 2, clientY: b.top }, head, rows);
    });
    hitNode.addEventListener("blur", hideTip);
  }

  // ── mark geometry ─────────────────────────────────────────
  /** Column with a 4px rounded cap, square at the baseline. */
  function capPath(x, y, w, h) {
    var r = Math.min(4, w / 2, Math.max(0, h));
    if (h <= 0.5) return "";
    if (r <= 0.5) return "M" + x + "," + y + "h" + w + "v" + h + "h" + (-w) + "Z";
    return "M" + x + "," + (y + r) +
      "A" + r + "," + r + " 0 0 1 " + (x + r) + "," + y +
      "L" + (x + w - r) + "," + y +
      "A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (y + r) +
      "L" + (x + w) + "," + (y + h) +
      "L" + x + "," + (y + h) + "Z";
  }
  /** Horizontal bar with a 4px rounded right end, square at the baseline. */
  function tipPath(x, y, w, h) {
    var r = Math.min(4, h / 2, Math.max(0, w));
    if (w <= 0.5) return "";
    if (r <= 0.5) return "M" + x + "," + y + "h" + w + "v" + h + "h" + (-w) + "Z";
    return "M" + x + "," + y +
      "L" + (x + w - r) + "," + y +
      "A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (y + r) +
      "L" + (x + w) + "," + (y + h - r) +
      "A" + r + "," + r + " 0 0 1 " + (x + w - r) + "," + (y + h) +
      "L" + x + "," + (y + h) + "Z";
  }

  /** Round an axis maximum up to a clean tick value. */
  function niceMax(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) {
      if (v <= mag * steps[i]) return mag * steps[i];
    }
    return mag * 10;
  }

  var GAP = 2;          // surface gap between touching marks
  var MAX_BAR = 22;     // bar/column thickness cap

  /**
   * Stacked columns over time. Two series (signed-in / logged-out) share
   * one axis; the gap between segments is surface-coloured, never a
   * stroke.
   */
  function renderStackedColumns(host, points, series, opts) {
    opts = opts || {};
    var W = Math.max(320, host.clientWidth || 640);
    var padL = 44, padR = 12, padT = 18, padB = 28;
    var H = opts.height || 220;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var totals = points.map(function (p) {
      return series.reduce(function (s, sr) { return s + (p[sr.key] || 0); }, 0);
    });
    var max = niceMax(Math.max.apply(null, totals.concat([1])));
    var band = plotW / Math.max(1, points.length);
    var barW = Math.min(MAX_BAR, Math.max(2, band - Math.max(2, band * 0.32)));

    var root = svg("svg", {
      viewBox: "0 0 " + W + " " + H,
      width: W, height: H,
      role: "img",
      "aria-label": opts.ariaLabel || "Time series"
    });

    // Gridlines + y ticks: solid hairlines, one step off the surface.
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var val = (max / ticks) * t;
      var gy = padT + plotH - (val / max) * plotH;
      root.appendChild(svg("line", {
        x1: padL, y1: gy, x2: W - padR, y2: gy,
        stroke: t === 0 ? cssVar("--axis") : cssVar("--grid"),
        "stroke-width": 1
      }));
      var lbl = svg("text", {
        x: padL - 10, y: gy + 3.5, "text-anchor": "end",
        fill: cssVar("--muted"), "font-size": 11,
        style: "font-variant-numeric:tabular-nums"
      });
      lbl.textContent = fmt(Math.round(val));
      root.appendChild(lbl);
    }

    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var cx = padL + band * i + (band - barW) / 2;
      var acc = 0;
      var drawn = [];
      for (var s = 0; s < series.length; s++) {
        var v = p[series[s].key] || 0;
        if (v > 0) drawn.push({ key: series[s].key, color: series[s].color(), value: v });
      }
      // Draw bottom-up so the topmost drawn segment gets the rounded cap.
      for (var d = 0; d < drawn.length; d++) {
        var seg = drawn[d];
        var hRaw = (seg.value / max) * plotH;
        var y = padT + plotH - hRaw - acc;
        // Trim the top of every segment except the highest one so the
        // 2px separation is surface, not ink.
        var isTop = d === drawn.length - 1;
        var h = isTop ? hRaw : Math.max(0.5, hRaw - GAP);
        var yy = isTop ? y : y + GAP;
        var path = svg("path", {
          d: isTop ? capPath(cx, yy, barW, h) : "M" + cx + "," + yy + "h" + barW + "v" + h + "h" + (-barW) + "Z",
          fill: seg.color
        });
        root.appendChild(path);
        acc += hRaw;
      }

      // Direct label on the final column only — the axis carries the rest.
      if (i === points.length - 1 && totals[i] > 0) {
        var capY = padT + plotH - (totals[i] / max) * plotH;
        var dl = svg("text", {
          x: cx + barW / 2, y: Math.max(padT - 4, capY - 7), "text-anchor": "middle",
          fill: cssVar("--ink"), "font-size": 11.5, "font-weight": 600
        });
        dl.textContent = fmt(totals[i]);
        root.appendChild(dl);
      }

      // Hit target spans the whole band (>= the mark, per spec).
      var hit = svg("rect", {
        x: padL + band * i, y: padT, width: Math.max(band, 1), height: plotH, class: "hit"
      });
      var rows = [];
      for (var s2 = 0; s2 < series.length; s2++) {
        rows.push({
          color: series[s2].color(),
          value: fmt(p[series[s2].key] || 0),
          name: series[s2].label
        });
      }
      if (series.length > 1) rows.push({ color: null, value: fmt(totals[i]), name: "total" });
      if (opts.extraRows) {
        var ex = opts.extraRows(p);
        for (var e = 0; e < ex.length; e++) rows.push(ex[e]);
      }
      bindTip(hit, shortDay(p.day), rows);
      root.appendChild(hit);
    }

    // X labels: first, last, and a few evenly spaced between, so they
    // never collide regardless of range length.
    var every = Math.max(1, Math.ceil(points.length / 7));
    for (var xi = 0; xi < points.length; xi++) {
      if (xi % every !== 0 && xi !== points.length - 1) continue;
      if (xi !== points.length - 1 && points.length - 1 - xi < every * 0.6) continue;
      var xt = svg("text", {
        x: padL + band * xi + band / 2, y: H - 9, "text-anchor": "middle",
        fill: cssVar("--muted"), "font-size": 11
      });
      xt.textContent = shortDay(points[xi].day);
      root.appendChild(xt);
    }

    clear(host);
    host.appendChild(root);
  }

  /** Grouped columns — used for the retention milestones. */
  function renderGroupedColumns(host, groups, series, opts) {
    opts = opts || {};
    var W = Math.max(320, host.clientWidth || 640);
    // Percent ticks ("100%") need more gutter than bare counts.
    var padL = opts.suffix ? 46 : 40;
    var padR = 12, padT = 20, padB = 34;
    var H = opts.height || 210;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var vals = [];
    groups.forEach(function (g) {
      series.forEach(function (s) { if (g[s.key] !== null && g[s.key] !== undefined) vals.push(g[s.key]); });
    });
    // Scale to the data rather than pinning percentages to 100: at low
    // volume a 3% bar against a 0–100 axis is invisible and the card
    // reads as broken. opts.minMax keeps a small value from being inflated
    // to look like a full bar, and the axis ticks always state the real
    // numbers, so nothing is overstated.
    var max = opts.max || Math.max(
      niceMax(Math.max.apply(null, vals.concat([0]))),
      opts.minMax || 1
    );
    var band = plotW / Math.max(1, groups.length);
    var inner = Math.min(MAX_BAR, Math.max(4, (band * 0.6) / series.length - GAP));

    var root = svg("svg", {
      viewBox: "0 0 " + W + " " + H, width: W, height: H,
      role: "img", "aria-label": opts.ariaLabel || "Grouped columns"
    });

    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var val = (max / ticks) * t;
      var gy = padT + plotH - (val / max) * plotH;
      root.appendChild(svg("line", {
        x1: padL, y1: gy, x2: W - padR, y2: gy,
        stroke: t === 0 ? cssVar("--axis") : cssVar("--grid"), "stroke-width": 1
      }));
      var lb = svg("text", {
        x: padL - 10, y: gy + 3.5, "text-anchor": "end",
        fill: cssVar("--muted"), "font-size": 11
      });
      lb.textContent = Math.round(val) + (opts.suffix || "");
      root.appendChild(lb);
    }

    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var groupW = inner * series.length + GAP * (series.length - 1);
      var startX = padL + band * i + (band - groupW) / 2;
      for (var s = 0; s < series.length; s++) {
        var v = g[series[s].key];
        if (v === null || v === undefined) continue;
        var h = (v / max) * plotH;
        var x = startX + s * (inner + GAP);
        var y = padT + plotH - h;
        root.appendChild(svg("path", { d: capPath(x, y, inner, h), fill: series[s].color() }));
        // Label the last group only (the endpoint), per the selective rule.
        if (opts.labelLast && i === groups.length - 1) {
          var vt = svg("text", {
            x: x + inner / 2, y: Math.max(padT - 5, y - 6), "text-anchor": "middle",
            fill: cssVar("--ink"), "font-size": 11, "font-weight": 600
          });
          vt.textContent = Math.round(v) + (opts.suffix || "");
          root.appendChild(vt);
        }
      }
      var hit = svg("rect", { x: padL + band * i, y: padT, width: band, height: plotH, class: "hit" });
      var rows = series.map(function (s2) {
        return {
          color: s2.color(),
          value: g[s2.key] === null || g[s2.key] === undefined ? "—" : Math.round(g[s2.key]) + (opts.suffix || ""),
          name: s2.label
        };
      });
      if (opts.extraRows) rows = rows.concat(opts.extraRows(g));
      bindTip(hit, g.label, rows);
      root.appendChild(hit);

      var xt = svg("text", {
        x: padL + band * i + band / 2, y: H - 12, "text-anchor": "middle",
        fill: cssVar("--ink-2"), "font-size": 11.5
      });
      xt.textContent = g.label;
      root.appendChild(xt);
      if (g.sublabel) {
        var st = svg("text", {
          x: padL + band * i + band / 2, y: H - 1, "text-anchor": "middle",
          fill: cssVar("--muted"), "font-size": 11
        });
        st.textContent = g.sublabel;
        root.appendChild(st);
      }
    }

    clear(host);
    host.appendChild(root);
  }

  /**
   * Horizontal bars, one series. Single hue by design — colouring each
   * bar differently would double-encode length as identity.
   */
  function renderBars(host, rows, opts) {
    opts = opts || {};
    var W = Math.max(300, host.clientWidth || 560);
    var labelW = opts.labelW || 84;
    var padR = 52, padT = 4, padB = 4;
    var rowH = 30;
    var H = padT + padB + rows.length * rowH;
    var plotW = Math.max(40, W - labelW - padR);
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r.value || 0; }).concat([1])));
    var barH = Math.min(MAX_BAR, rowH - 10);

    var root = svg("svg", {
      viewBox: "0 0 " + W + " " + H, width: W, height: H,
      role: "img", "aria-label": opts.ariaLabel || "Bar chart"
    });

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var y = padT + i * rowH + (rowH - barH) / 2;
      var w = ((r.value || 0) / max) * plotW;

      var nameT = svg("text", {
        x: 0, y: y + barH / 2 + 4, fill: cssVar("--ink"), "font-size": 12
      });
      nameT.textContent = r.label;
      root.appendChild(nameT);

      root.appendChild(svg("path", {
        d: tipPath(labelW, y, Math.max(w, 0), barH),
        fill: (opts.color || cssVar("--series-1"))
      }));

      // Value at the tip, outside the bar — never clipped inside it.
      var vt = svg("text", {
        x: labelW + Math.max(w, 0) + 8, y: y + barH / 2 + 4,
        fill: cssVar("--ink"), "font-size": 11, "font-weight": 600,
        style: "font-variant-numeric:tabular-nums"
      });
      vt.textContent = r.display !== undefined ? r.display : fmt(r.value);
      root.appendChild(vt);

      var hit = svg("rect", {
        x: 0, y: padT + i * rowH, width: W, height: rowH, class: "hit"
      });
      bindTip(hit, r.label, r.tip || [{ color: opts.color || cssVar("--series-1"), value: fmt(r.value), name: opts.unit || "" }]);
      root.appendChild(hit);
    }

    clear(host);
    host.appendChild(root);
  }

  // ── card shell ────────────────────────────────────────────
  /**
   * 'note' is the one-line orientation that earns its place on screen —
   * it sits on the title baseline rather than below it, so a card head is
   * always exactly one line tall. 'help' is the long definitional prose;
   * it hangs off a hover/focus affordance instead, because nine
   * paragraphs of it stacked down the page was the single biggest source
   * of visual noise.
   */
  function card(title, note, help) {
    var c = el("div", "card");
    var head = el("div", "card-head");
    head.appendChild(el("h2", null, title));
    if (help) {
      var q = el("button", "help", "i");
      q.type = "button";
      q.title = help;
      q.setAttribute("aria-label", title + " — " + help);
      head.appendChild(q);
    }
    if (note) head.appendChild(el("p", "note", note));
    c.appendChild(head);
    return c;
  }

  function legend(items) {
    var l = el("div", "legend");
    items.forEach(function (it) {
      var i = el("span", "item");
      var sw = el("span", it.line ? "line-key" : "swatch");
      sw.style.background = it.color;
      i.appendChild(sw);
      i.appendChild(document.createTextNode(it.label));
      l.appendChild(i);
    });
    return l;
  }

  function twin(title, node) {
    var d = el("div", "table-twin");
    d.appendChild(el("h3", null, title));
    d.appendChild(node);
    return d;
  }

  // ── the one table component ───────────────────────────────
  /**
   * Every table on this page is this function. It owns search, sort,
   * page size and paging, and it repaints only its own subtree — so
   * changing a page never rebuilds a chart or moves the scroll position.
   *
   * Per-table UI state is keyed by id in a module-level map so it
   * survives a data refresh: refreshing on page 4 of People leaves you
   * on page 4. The page is clamped on every paint, so a refresh that
   * returns fewer rows lands on the last real page instead of an empty
   * one.
   *
   * Paging is client-side over one batched fetch (see FETCH). The footer
   * always states the true total it is paging over, and says so plainly
   * when the server-side ceiling truncated the set — a pager that hides
   * a truncation is worse than no pager.
   */
  var PAGE_SIZES = [10, 25, 50, 100];
  var tableUi = {};

  function tableState(id, opts) {
    if (!tableUi[id]) {
      tableUi[id] = {
        page: 1,
        size: opts.pageSize || 25,
        q: "",
        sortKey: opts.sortKey || null,
        sortDesc: opts.sortDesc !== false
      };
    }
    return tableUi[id];
  }

  /** Page numbers to render, with gaps: 1 … 4 5 6 … 20. */
  function pageList(cur, total) {
    if (total <= 7) {
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }
    var out = [1];
    var from = Math.max(2, cur - 1);
    var to = Math.min(total - 1, cur + 1);
    if (from > 2) out.push("gap");
    for (var p = from; p <= to; p++) out.push(p);
    if (to < total - 1) out.push("gap");
    out.push(total);
    return out;
  }

  function compare(a, b, key, desc) {
    var av = a[key], bv = b[key];
    if (av === null || av === undefined) av = desc ? -Infinity : Infinity;
    if (bv === null || bv === undefined) bv = desc ? -Infinity : Infinity;
    if (typeof av === "string" || typeof bv === "string") {
      av = String(av); bv = String(bv);
      return desc ? (av < bv ? 1 : av > bv ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
    }
    if (typeof av === "boolean") av = av ? 1 : 0;
    if (typeof bv === "boolean") bv = bv ? 1 : 0;
    return desc ? bv - av : av - bv;
  }

  function dataTable(id, columns, rows, opts) {
    opts = opts || {};
    var st = tableState(id, opts);
    var host = el("div", "dt");

    var bar = null;
    var search = null;
    if (opts.search) {
      bar = el("div", "dt-bar");
      search = el("input", "field");
      search.type = "search";
      search.placeholder = opts.searchPlaceholder || "Search";
      search.value = st.q;
      search.setAttribute("aria-label", opts.searchPlaceholder || "Search rows");
      search.addEventListener("input", function () {
        st.q = search.value;
        st.page = 1;
        paint();
      });
      bar.appendChild(search);
      bar.appendChild(el("span", "grow"));
      if (opts.actions) opts.actions.forEach(function (a) { bar.appendChild(a); });
      host.appendChild(bar);
    }

    var body = el("div", "dt-body");
    var foot = el("div", "dt-foot");
    host.appendChild(body);
    host.appendChild(foot);

    function matches(r) {
      if (!st.q) return true;
      var needle = st.q.toLowerCase();
      var keys = opts.searchKeys || columns.map(function (c) { return c.key; });
      for (var i = 0; i < keys.length; i++) {
        var v = r[keys[i]];
        if (v === null || v === undefined) continue;
        if (String(v).toLowerCase().indexOf(needle) !== -1) return true;
      }
      return false;
    }

    function paint() {
      var view = rows.filter(matches);
      if (st.sortKey) {
        view = view.slice().sort(function (a, b) { return compare(a, b, st.sortKey, st.sortDesc); });
      }

      var total = view.length;
      var size = st.size > 0 ? st.size : Math.max(total, 1);
      var pages = Math.max(1, Math.ceil(total / size));
      if (st.page > pages) st.page = pages;
      if (st.page < 1) st.page = 1;
      var start = (st.page - 1) * size;
      var slice = view.slice(start, start + size);

      // ── table ──
      clear(body);
      var t = el("table");
      if (opts.cls) t.className = opts.cls;

      var thead = el("thead");
      var htr = el("tr");
      columns.forEach(function (c) {
        var th = el("th", c.sortable ? "sortable" : null);
        th.appendChild(document.createTextNode(c.label));
        if (c.title) th.title = c.title;
        if (c.sortable) {
          th.setAttribute("role", "button");
          th.setAttribute("tabindex", "0");
          if (st.sortKey === c.key) {
            th.appendChild(el("span", "caret", st.sortDesc ? " ↓" : " ↑"));
            th.setAttribute("aria-sort", st.sortDesc ? "descending" : "ascending");
          }
          var flip = function () {
            if (st.sortKey === c.key) st.sortDesc = !st.sortDesc;
            else { st.sortKey = c.key; st.sortDesc = true; }
            st.page = 1;
            paint();
          };
          th.addEventListener("click", flip);
          th.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); flip(); }
          });
        }
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      t.appendChild(thead);

      var tb = el("tbody");
      slice.forEach(function (r) {
        var tr = el("tr");
        columns.forEach(function (c) {
          var td = el("td", c.num ? "num" : null);
          var v = c.render ? c.render(r) : r[c.key];
          if (v instanceof Node) td.appendChild(v);
          else td.textContent = (v === null || v === undefined || v === "") ? "—" : String(v);
          if (c.cls) td.className = (td.className ? td.className + " " : "") + c.cls;
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      body.appendChild(t);

      if (!slice.length) {
        var empty = el("div", "empty");
        empty.style.marginTop = "12px";
        empty.textContent = st.q
          ? "Nothing matches " + JSON.stringify(st.q) + "."
          : (opts.emptyText || "No data yet.");
        body.appendChild(empty);
      }

      // ── footer ──
      clear(foot);
      if (!total) {
        foot.hidden = true;
        return;
      }
      foot.hidden = false;

      var shownFrom = start + 1;
      var shownTo = Math.min(start + size, total);
      var count = el("span", "num");
      count.textContent = "Showing " + fmt(shownFrom) + "–" + fmt(shownTo) + " of " + fmt(total) +
        (opts.unit ? " " + opts.unit : "") +
        (st.q && total !== rows.length ? " (filtered from " + fmt(rows.length) + ")" : "");
      foot.appendChild(count);

      // Be explicit when the server ceiling cut the set off — otherwise
      // "of 500" reads as "that's everyone".
      if (opts.truncatedAt && rows.length >= opts.truncatedAt) {
        var trunc = el("span");
        trunc.textContent = "· capped at " + fmt(opts.truncatedAt);
        trunc.title = "The API returns at most " + opts.truncatedAt +
          " rows for this table. Narrow the range or export the CSV to see more.";
        foot.appendChild(trunc);
      }

      // A table that fits on one page at the smallest page size has
      // nothing to page through — it gets a row count and no controls.
      if (pages === 1 && total <= PAGE_SIZES[0]) return;

      var tools = el("div", "dt-tools");
      foot.appendChild(tools);

      var sizeSel = el("select", "sel");
      sizeSel.setAttribute("aria-label", "Rows per page");
      PAGE_SIZES.forEach(function (n) {
        var o = el("option", null, n + " / page");
        o.value = String(n);
        if (st.size === n) o.selected = true;
        sizeSel.appendChild(o);
      });
      var allOpt = el("option", null, "All");
      allOpt.value = "0";
      if (st.size === 0) allOpt.selected = true;
      sizeSel.appendChild(allOpt);
      sizeSel.addEventListener("change", function () {
        st.size = Number(sizeSel.value);
        st.page = 1;
        paint();
      });
      tools.appendChild(sizeSel);

      if (pages > 1) {
        var pager = el("div", "pager");
        pager.setAttribute("role", "navigation");
        pager.setAttribute("aria-label", "Pagination");

        function pageBtn(label, target, current, disabled) {
          var b = el("button", null, label);
          b.type = "button";
          if (disabled) b.disabled = true;
          if (current) b.setAttribute("aria-current", "page");
          else b.setAttribute("aria-label", "Page " + target);
          b.addEventListener("click", function () {
            if (st.page === target) return;
            st.page = target;
            paint();
          });
          return b;
        }

        pager.appendChild(pageBtn("‹", st.page - 1, false, st.page <= 1));
        pageList(st.page, pages).forEach(function (p) {
          if (p === "gap") pager.appendChild(el("span", "gap", "…"));
          else pager.appendChild(pageBtn(String(p), p, p === st.page, false));
        });
        pager.appendChild(pageBtn("›", st.page + 1, false, st.page >= pages));
        tools.appendChild(pager);
      }
    }

    paint();
    return host;
  }

  /** Registered chart re-draw callbacks, replayed on resize. */
  var redraws = [];

  // ── sections ──────────────────────────────────────────────
  /**
   * Four pinned KPIs, always above the active tab, because "how many
   * people are here" is context for every question on the page. The
   * other eight figures moved to the Overview tab — a permanent
   * twelve-number wall was most of why this read as cluttered.
   */
  function sectionKpis(d) {
    var o = d.overview.totals;
    var grid = el("div", "kpis");
    function kpi(k, v, sub) {
      var t = el("div", "kpi");
      t.appendChild(el("div", "k", k));
      t.appendChild(el("div", "v", v));
      t.appendChild(el("div", "sub", sub || ""));
      return t;
    }
    grid.appendChild(kpi("Active · 7 days", fmt(o.wau), fmt(o.dau) + " today"));
    grid.appendChild(kpi("Active · 30 days", fmt(o.mau),
      fmt(o.mauAuthed) + " signed in · " + fmt(o.mauAnon) + " logged out"));
    grid.appendChild(kpi("Stickiness", o.stickiness === null ? "—" : pctStr(o.stickiness), "DAU / MAU"));
    grid.appendChild(kpi("Sign-up rate", pctStr(o.signupRate), "of everyone seen"));
    return grid;
  }

  function sectionTotals(d) {
    var o = d.overview.totals;
    var c = card("All time", "Cumulative, ignoring the range above.",
      "These eight are lifetime totals from the tables themselves, not the event stream, so they are unaffected by the retention window.");
    var grid = el("div", "facts");
    function fact(k, v, sub) {
      var t = el("div", "fact");
      t.appendChild(el("div", "k", k));
      t.appendChild(el("div", "v", v));
      t.appendChild(el("div", "sub", sub || ""));
      return t;
    }
    grid.appendChild(fact("Accounts", fmt(o.totalAccounts), "registered"));
    grid.appendChild(fact("People seen", fmt(o.everActive), fmt(o.everActiveAnon) + " never signed in"));
    grid.appendChild(fact("Answers", fmt(o.answersAllTime), "first tries"));
    grid.appendChild(fact("Accuracy", pctStr(o.accuracyAllTime), "first try correct"));
    grid.appendChild(fact("Catalogue", fmt(o.totalCards), "cards live"));
    grid.appendChild(fact("Daily challenge", fmt(o.dailyCompletions), "completions"));
    grid.appendChild(fact("Friendships", fmt(o.friendships), "mutual pairs"));
    grid.appendChild(fact("Events kept", fmt(d.retentionDays) + "d", "then pruned"));
    c.appendChild(grid);
    return c;
  }

  function sectionActivity(d) {
    var pts = d.overview.series;
    var c = card("Active users per day", "Signed in versus still logged out.",
      "One count per person per day, drawn from answers, daily challenges and session events.");
    var series = [
      { key: "activeAuthed", label: "Signed in", color: function () { return cssVar("--series-1"); } },
      { key: "activeAnon", label: "Logged out", color: function () { return cssVar("--series-2"); } }
    ];
    c.appendChild(legend([
      { color: cssVar("--series-1"), label: "Signed in" },
      { color: cssVar("--series-2"), label: "Logged out" }
    ]));
    var host = el("div", "chart");
    c.appendChild(host);
    function draw() {
      renderStackedColumns(host, pts, series, {
        height: 230,
        ariaLabel: "Daily active users, split by signed-in and logged-out",
        extraRows: function (p) {
          var extra = [{ color: null, value: fmt(p.newCards), name: "new cards answered" }];
          if (p.signups) extra.push({ color: null, value: fmt(p.signups), name: "sign-ups" });
          if (p.sessions) extra.push({ color: null, value: fmt(p.sessions), name: "sessions" });
          return extra;
        }
      });
    }
    draw();
    redraws.push(draw);

    c.appendChild(twin("Daily detail", dataTable("daily", [
      { key: "day", label: "Day", sortable: true, render: function (r) { return shortDay(r.day); } },
      { key: "activeAuthed", label: "Signed in", num: true, sortable: true },
      { key: "activeAnon", label: "Logged out", num: true, sortable: true },
      { key: "activeAll", label: "Total", num: true, sortable: true },
      { key: "newCards", label: "New cards", num: true, sortable: true },
      { key: "answerEvents", label: "All answers", num: true, sortable: true },
      { key: "sessions", label: "Sessions", num: true, sortable: true },
      { key: "signups", label: "Sign-ups", num: true, sortable: true },
      { key: "dailyChallenges", label: "Daily", num: true, sortable: true }
    ], pts, { pageSize: 10, sortKey: "day", sortDesc: true, unit: "days" })));
    return c;
  }

  function sectionVolume(d) {
    var pts = d.overview.series;
    var c = card("Cards answered per day", "First-time answers only.",
      "New cards answered for the first time — the learning-progress signal. Replays are counted separately, in the mode table.");
    var series = [
      { key: "newCards", label: "New cards", color: function () { return cssVar("--series-1"); } }
    ];
    var host = el("div", "chart");
    c.appendChild(host);
    function draw() {
      renderStackedColumns(host, pts, series, {
        height: 180,
        ariaLabel: "New cards answered per day",
        extraRows: function (p) {
          return [
            { color: null, value: fmt(p.newCardsCorrect), name: "correct" },
            {
              color: null,
              value: p.newCards ? Math.round((p.newCardsCorrect / p.newCards) * 100) + "%" : "—",
              name: "accuracy"
            }
          ];
        }
      });
    }
    draw();
    redraws.push(draw);
    return c;
  }

  function sectionRetention(d) {
    var r = d.retention;
    var c = card("Retention", "Share returning on day N or later.",
      "Of the people who had the chance to come back, the share that returned on day N or later. Unbounded on purpose — at this volume an exact-day-N rule is mostly zeroes.");

    var groups = r.returnedByDay.map(function (m) {
      return {
        label: "D" + m.day,
        sublabel: fmt(m.eligible) + " eligible",
        all: m.all, authed: m.authed, anon: m.anon
      };
    });
    var series = [
      { key: "authed", label: "Signed in", color: function () { return cssVar("--series-1"); } },
      { key: "anon", label: "Logged out", color: function () { return cssVar("--series-2"); } }
    ];
    c.appendChild(legend([
      { color: cssVar("--series-1"), label: "Signed in" },
      { color: cssVar("--series-2"), label: "Logged out" }
    ]));

    if (!groups.length) {
      c.appendChild(el("div", "empty", "Not enough history yet — retention needs users whose first visit was at least a day ago."));
      return c;
    }

    var host = el("div", "chart");
    c.appendChild(host);
    function draw() {
      renderGroupedColumns(host, groups, series, {
        height: 215, suffix: "%", minMax: 20, labelLast: true,
        ariaLabel: "Return rate by day, signed-in versus logged-out",
        extraRows: function (g) {
          return [{ color: null, value: g.all === null ? "—" : Math.round(g.all) + "%", name: "everyone" }];
        }
      });
    }
    draw();
    redraws.push(draw);

    var nd = el("p", "subtle");
    nd.style.marginTop = "12px";
    nd.textContent = "Next-day return (active the very next day): " +
      (r.nextDayReturn === null ? "not measurable yet" : pctStr(r.nextDayReturn));
    c.appendChild(nd);

    c.appendChild(twin("Return rates", dataTable("returns", [
      { key: "label", label: "Milestone" },
      { key: "eligible", label: "Eligible", num: true, sortable: true, render: function (x) { return fmt(x.eligible); } },
      { key: "all", label: "Everyone", num: true, sortable: true, render: function (x) { return pctStr(x.all); } },
      { key: "authed", label: "Signed in", num: true, sortable: true, render: function (x) { return pctStr(x.authed); } },
      { key: "anon", label: "Logged out", num: true, sortable: true, render: function (x) { return pctStr(x.anon); } }
    ], r.returnedByDay.map(function (m) {
      return {
        label: "Day " + m.day, eligible: m.eligible,
        all: m.all, authed: m.authed, anon: m.anon
      };
    }), { pageSize: 10, unit: "milestones" })));
    return c;
  }

  function sectionCohorts(d) {
    var r = d.retention;
    var c = card("Weekly cohorts", "Grouped by first-visit week.",
      "Each row is everyone whose first visit fell in that week. Week N counts how many were still active N weeks after their own first day. Blank means that week has not happened yet.");

    if (!r.cohorts.length) {
      c.appendChild(el("div", "empty", "No cohorts in this window yet."));
      return c;
    }

    // The heatmap is a positional grid, not a row list — its cells only
    // mean anything read against their neighbours, so it pages by hand
    // rather than through dataTable.
    var maxW = Math.min(r.maxWeekOffset, 12);
    var COHORT_PAGE = 12;
    var st = tableUi.cohorts || (tableUi.cohorts = { page: 1 });
    var pages = Math.max(1, Math.ceil(r.cohorts.length / COHORT_PAGE));
    if (st.page > pages) st.page = pages;

    var holder = el("div");
    c.appendChild(holder);

    function paint() {
      clear(holder);
      var start = (st.page - 1) * COHORT_PAGE;
      var slice = r.cohorts.slice(start, start + COHORT_PAGE);

      var t = el("table", "heat");
      var thead = el("thead");
      var htr = el("tr");
      htr.appendChild(el("th", null, "Cohort week"));
      htr.appendChild(el("th", null, "Users"));
      for (var w = 1; w <= maxW; w++) htr.appendChild(el("th", null, "W" + w));
      thead.appendChild(htr);
      t.appendChild(thead);

      var tb = el("tbody");
      slice.forEach(function (row) {
        var tr = el("tr");
        tr.appendChild(el("td", null, shortDay(row.cohort)));
        tr.appendChild(el("td", "num", fmt(row.size)));
        for (var wi = 1; wi <= maxW; wi++) {
          var v = row.weeks[wi];
          var td;
          if (v === null || v === undefined || !row.size) {
            tr.appendChild(el("td", "cell na", ""));
            continue;
          }
          var share = v / row.size;
          td = el("td", "cell");
          // Sequential single-hue ramp, light -> dark with magnitude. Ink
          // flips to white on the darker half so it always clears contrast.
          var step = share <= 0.001 ? null
            : share < 0.15 ? "--seq-100"
            : share < 0.3 ? "--seq-250"
            : share < 0.5 ? "--seq-400"
            : share < 0.75 ? "--seq-550" : "--seq-700";
          if (step) {
            td.style.background = cssVar(step);
            td.style.color = (step === "--seq-100" || step === "--seq-250")
              ? "#0b0b0b" : "#ffffff";
          } else {
            td.className = "cell na";
          }
          td.textContent = Math.round(share * 100) + "%";
          td.title = fmt(v) + " of " + fmt(row.size) + " users";
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      });
      t.appendChild(tb);

      var wrap = el("div", "dt-body");
      wrap.appendChild(t);
      holder.appendChild(wrap);

      var foot = el("div", "dt-foot");
      var count = el("span", "num");
      count.textContent = "Showing " + fmt(start + 1) + "–" +
        fmt(Math.min(start + COHORT_PAGE, r.cohorts.length)) + " of " +
        fmt(r.cohorts.length) + " cohorts";
      foot.appendChild(count);
      var tools = el("div", "dt-tools");
      foot.appendChild(tools);

      var scale = el("div", "legend");
      scale.style.margin = "0";
      [["--seq-100", "<15%"], ["--seq-250", "15–30%"], ["--seq-400", "30–50%"],
       ["--seq-550", "50–75%"], ["--seq-700", "75%+"]].forEach(function (pair) {
        var i = el("span", "item");
        var sw = el("span", "swatch");
        sw.style.background = cssVar(pair[0]);
        i.appendChild(sw);
        i.appendChild(document.createTextNode(pair[1]));
        scale.appendChild(i);
      });
      tools.appendChild(scale);

      if (pages > 1) {
        var pager = el("div", "pager");
        pager.setAttribute("aria-label", "Pagination");
        function btn(label, target, current, disabled) {
          var b = el("button", null, label);
          b.type = "button";
          if (disabled) b.disabled = true;
          if (current) b.setAttribute("aria-current", "page");
          b.addEventListener("click", function () { st.page = target; paint(); });
          return b;
        }
        pager.appendChild(btn("‹", st.page - 1, false, st.page <= 1));
        pageList(st.page, pages).forEach(function (p) {
          if (p === "gap") pager.appendChild(el("span", "gap", "…"));
          else pager.appendChild(btn(String(p), p, p === st.page, false));
        });
        pager.appendChild(btn("›", st.page + 1, false, st.page >= pages));
        tools.appendChild(pager);
      }
      holder.appendChild(foot);
    }

    paint();
    return c;
  }

  function sectionModes(d) {
    var m = d.modes;
    var c = card("What people play", "Sessions and answers per mode.",
      "From session and answer events, so this only covers traffic since the instrumented app shipped. Unlike the card tables, it counts replays.");

    if (!m.modes.length) {
      c.appendChild(el("div", "empty",
        "No mode events recorded yet. This fills in once the instrumented frontend is deployed and someone plays a round — everything else on this page works from existing data."));
      return c;
    }

    // Plot sessions, not answers: a mode can have sessions and no
    // answers yet (opened and abandoned), and an all-zero bar chart
    // renders as a stranded value with no mark.
    var rows = m.modes.map(function (x) {
      return {
        label: x.mode,
        value: x.sessions,
        display: fmt(x.sessions),
        tip: [
          { color: cssVar("--series-1"), value: fmt(x.sessions), name: "sessions" },
          { color: null, value: fmt(x.answers), name: "answers" },
          { color: null, value: fmt(x.users), name: "players" },
          { color: null, value: pctStr(x.accuracy), name: "accuracy" },
          { color: null, value: dur(x.avgSessionSec), name: "avg session" }
        ]
      };
    });

    // Needs at least two modes with a non-zero value to be worth a chart:
    // a single bar carries no comparison the table doesn't already show.
    var plotMax = rows.reduce(function (mx, r) { return Math.max(mx, r.value || 0); }, 0);
    if (plotMax > 0 && rows.length > 1) {
      var host = el("div", "chart");
      c.appendChild(host);
      var draw = function () {
        renderBars(host, rows, {
          ariaLabel: "Sessions by game mode", unit: "sessions", labelW: 76
        });
      };
      draw();
      redraws.push(draw);
    }

    var tbl = dataTable("modes", [
      { key: "mode", label: "Mode", sortable: true },
      { key: "users", label: "Players", num: true, sortable: true, render: function (x) { return fmt(x.users); } },
      { key: "usersAuthed", label: "Signed in", num: true, sortable: true, render: function (x) { return fmt(x.usersAuthed); } },
      { key: "usersAnon", label: "Logged out", num: true, sortable: true, render: function (x) { return fmt(x.usersAnon); } },
      { key: "sessions", label: "Sessions", num: true, sortable: true, render: function (x) { return fmt(x.sessions); } },
      { key: "answers", label: "Answers", num: true, sortable: true, render: function (x) { return fmt(x.answers); } },
      { key: "answersPerSession", label: "Per session", num: true, sortable: true },
      { key: "accuracy", label: "Accuracy", num: true, sortable: true, render: function (x) { return pctStr(x.accuracy); } },
      { key: "avgSessionSec", label: "Avg session", num: true, sortable: true, render: function (x) { return dur(x.avgSessionSec); } },
      { key: "avgAnswerSec", label: "Sec / card", num: true, sortable: true, render: function (x) { return x.avgAnswerSec ? x.avgAnswerSec + "s" : "—"; } },
      { key: "completions", label: "Finished", num: true, sortable: true, render: function (x) { return fmt(x.completions); } }
    ], m.modes, { pageSize: 10, sortKey: "sessions", sortDesc: true, unit: "modes" });
    tbl.style.marginTop = "20px";
    c.appendChild(tbl);

    var out = el("div", "stack");
    out.appendChild(c);

    if (m.variants.length) {
      var vc = card("Focus categories", "Play inside a single category.",
        "Variants are the /focus routes — a mode scoped to one card category.");
      vc.appendChild(dataTable("variants", [
        { key: "variant", label: "Category", sortable: true },
        { key: "mode", label: "Mode", sortable: true },
        { key: "users", label: "Players", num: true, sortable: true, render: function (x) { return fmt(x.users); } },
        { key: "answers", label: "Answers", num: true, sortable: true, render: function (x) { return fmt(x.answers); } },
        { key: "accuracy", label: "Accuracy", num: true, sortable: true, render: function (x) { return pctStr(x.accuracy); } }
      ], m.variants, {
        pageSize: 10, sortKey: "answers", sortDesc: true, unit: "categories",
        search: true, searchPlaceholder: "Search categories", searchKeys: ["variant", "mode"]
      }));
      out.appendChild(vc);
    }
    return out;
  }

  function sectionContent(d) {
    var ct = d.content;
    var out = el("div", "stack");

    var cardCols = [
      { key: "answer", label: "Answer", sortable: true },
      { key: "category", label: "Category", sortable: true, render: function (r) {
          return el("span", "pill", r.category); } },
      { key: "attempts", label: "Tries", num: true, sortable: true, render: function (r) { return fmt(r.attempts); } },
      { key: "accuracy", label: "Correct", num: true, sortable: true, render: function (r) { return pctStr(r.accuracy); } }
    ];
    var cardOpts = {
      pageSize: 10, search: true, searchPlaceholder: "Search cards",
      searchKeys: ["answer", "category"], unit: "cards", truncatedAt: FETCH.cards
    };

    var grid = el("div", "cols");

    var hard = card("Hardest cards", "Lowest first-try accuracy.",
      "A card sitting far below the rest is usually ambiguous wording rather than genuine difficulty.");
    hard.appendChild(dataTable("hardest", cardCols, ct.hardest, Object.assign({}, cardOpts, {
      sortKey: "accuracy", sortDesc: false,
      emptyText: "No card has been missed enough times to rank yet."
    })));
    grid.appendChild(hard);

    var easy = card("Easiest cards", "Highest first-try accuracy.",
      "Candidates for retiring or re-weighting — they are no longer teaching anyone anything.");
    easy.appendChild(dataTable("easiest", cardCols, ct.easiest, Object.assign({}, cardOpts, {
      sortKey: "accuracy", sortDesc: true,
      emptyText: "Not enough answers per card yet."
    })));
    grid.appendChild(easy);
    out.appendChild(grid);

    var bycat = card("Reach by category",
      fmt(ct.unseen) + " cards have never been answered by anyone.",
      "How much of the catalogue is actually being seen. A category with few answers is either under-weighted in the feed or too small.");
    var catHost = el("div", "chart");
    bycat.appendChild(catHost);
    var catRows = ct.byCategory.map(function (r) {
      return {
        label: r.label || "—", value: r.attempts, display: fmt(r.attempts),
        tip: [
          { color: cssVar("--series-1"), value: fmt(r.attempts), name: "answers" },
          { color: null, value: fmt(r.users), name: "people" },
          { color: null, value: pctStr(r.accuracy), name: "accuracy" }
        ]
      };
    });
    function drawCat() {
      renderBars(catHost, catRows, { ariaLabel: "Answers by card category", unit: "answers", labelW: 84 });
    }
    drawCat();
    redraws.push(drawCat);

    var diffTbl = dataTable("difficulty", [
      { key: "label", label: "Difficulty", sortable: true },
      { key: "users", label: "People", num: true, sortable: true, render: function (r) { return fmt(r.users); } },
      { key: "attempts", label: "Answers", num: true, sortable: true, render: function (r) { return fmt(r.attempts); } },
      { key: "accuracy", label: "Accuracy", num: true, sortable: true, render: function (r) { return pctStr(r.accuracy); } }
    ], ct.byDifficulty, { pageSize: 10, sortKey: "attempts", sortDesc: true, unit: "tiers" });
    diffTbl.style.marginTop = "20px";
    bycat.appendChild(diffTbl);
    out.appendChild(bycat);
    return out;
  }

  function sectionUsers(d) {
    var c = card("People", "Anonymous and signed-in together.",
      "Answers and accuracy come from first-try history; sessions and top mode need event data, so they are blank for anyone last seen before the instrumented app shipped. The CSV export carries every column, including the two omitted here.");

    var csvBtn = el("button", "btn", "Export CSV");
    csvBtn.type = "button";
    csvBtn.addEventListener("click", downloadCsv);

    c.appendChild(dataTable("people", [
      {
        key: "userId", label: "User", sortable: true, render: function (r) {
          var box = el("span");
          var who = el("span", null, r.name || r.email || shortId(r.userId));
          if (!r.name && !r.email) who.className = "mono dim";
          box.appendChild(who);
          box.title = r.userId + (r.email ? " · " + r.email : "");
          return box;
        }
      },
      {
        key: "authed", label: "Type", sortable: true, render: function (r) {
          return el("span", "pill", r.authed ? "signed in" : "logged out");
        }
      },
      { key: "firstSeen", label: "First seen", sortable: true, render: function (r) { return shortDay(r.firstSeen); } },
      // "Days ago" and "Span" are both derivable from these two dates and
      // both are in the CSV — dropping them is what lets the table fit its
      // card without a clipped column at the right edge.
      { key: "lastSeen", label: "Last seen", sortable: true, render: function (r) { return shortDay(r.lastSeen); } },
      { key: "activeDays", label: "Active", num: true, sortable: true, title: "Distinct days with any activity" },
      { key: "answers", label: "Answers", num: true, sortable: true, render: function (r) { return fmt(r.answers); } },
      { key: "accuracy", label: "Accuracy", num: true, sortable: true, render: function (r) { return pctStr(r.accuracy); } },
      { key: "dailies", label: "Daily", num: true, sortable: true },
      { key: "sessions", label: "Sessions", num: true, sortable: true },
      { key: "totalMinutes", label: "Mins", num: true, sortable: true, title: "Total session minutes" },
      { key: "topMode", label: "Top mode", sortable: true, render: function (r) { return r.topMode ? el("span", "pill", r.topMode) : "—"; } }
    ], d.users, {
      pageSize: 25, sortKey: "lastSeen", sortDesc: true, unit: "people",
      search: true, searchPlaceholder: "Search name, email, id",
      searchKeys: ["userId", "name", "email", "topMode"],
      actions: [csvBtn], truncatedAt: FETCH.users,
      emptyText: "Nobody has been seen in this window."
    }));
    return c;
  }

  function sectionEvents(d) {
    var c = card("Latest events", "A live tail of incoming events.",
      "The quickest way to confirm the app is actually reporting — if this is empty, the frontend is not sending.");
    if (!d.events.length) {
      c.appendChild(el("div", "empty", "Nothing yet."));
      return c;
    }
    c.appendChild(dataTable("events", [
      { key: "at", label: "When", sortable: true, render: function (r) {
          var dt = new Date(r.at);
          return isNaN(dt.getTime()) ? r.at : dt.toLocaleString();
        } },
      { key: "event", label: "Event", sortable: true },
      { key: "mode", label: "Mode", sortable: true, render: function (r) { return r.mode ? el("span", "pill", r.mode) : "—"; } },
      { key: "variant", label: "Detail", sortable: true },
      { key: "userId", label: "User", sortable: true, render: function (r) {
          var s = el("span", "mono dim", shortId(r.userId));
          s.title = r.userId;
          return s;
        } },
      { key: "authed", label: "Type", sortable: true, render: function (r) { return r.authed ? "signed in" : "logged out"; } },
      { key: "correct", label: "Correct", sortable: true, render: function (r) { return r.correct === null ? "—" : (r.correct ? "yes" : "no"); } },
      { key: "durationMs", label: "Duration", num: true, sortable: true, render: function (r) {
          return r.durationMs === null ? "—" : (r.durationMs >= 1000 ? dur(Math.round(r.durationMs / 1000)) : r.durationMs + "ms");
        } }
    ], d.events, {
      pageSize: 25, sortKey: "at", sortDesc: true, unit: "events",
      search: true, searchPlaceholder: "Search event, mode, user",
      searchKeys: ["event", "mode", "variant", "userId"],
      truncatedAt: FETCH.events
    }));
    return c;
  }

  // ── render ────────────────────────────────────────────────
  var app = document.getElementById("app");

  /**
   * One tab per question. Only the active tab is built. That is not just
   * a rendering economy: the chart renderers size themselves from
   * 'host.clientWidth', which is 0 inside a 'hidden' container, so a
   * pre-built hidden tab would lay its charts out at zero width and never
   * recover without a resize.
   */
  var TABS = [
    {
      id: "overview", label: "Overview",
      build: function (d) { return [sectionActivity(d), sectionVolume(d), sectionTotals(d)]; }
    },
    {
      id: "retention", label: "Retention",
      build: function (d) { return [sectionRetention(d), sectionCohorts(d)]; }
    },
    { id: "modes", label: "Modes", build: function (d) { return [sectionModes(d)]; } },
    { id: "content", label: "Content", build: function (d) { return [sectionContent(d)]; } },
    { id: "people", label: "People", build: function (d) { return [sectionUsers(d)]; } },
    { id: "events", label: "Events", build: function (d) { return [sectionEvents(d)]; } }
  ];

  function activeTab() {
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].id === state.tab) return TABS[i];
    }
    return TABS[0];
  }

  var tabsNav = document.getElementById("tabs");

  function buildTabs() {
    clear(tabsNav);
    TABS.forEach(function (t) {
      var b = el("button", null, t.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("data-tab", t.id);
      b.addEventListener("click", function () { selectTab(t.id); });
      tabsNav.appendChild(b);
    });
  }

  function syncTabs() {
    var kids = tabsNav.children;
    for (var i = 0; i < kids.length; i++) {
      var on = kids[i].getAttribute("data-tab") === state.tab;
      kids[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    // Cohort width only means anything on the retention tab.
    var onRetention = state.tab === "retention";
    document.getElementById("weeks-seg").hidden = !onRetention;
    document.getElementById("weeks-lbl").hidden = !onRetention;
  }

  function selectTab(id) {
    if (state.tab === id) return;
    state.tab = id;
    try { sessionStorage.setItem(TAB_KEY, id); } catch (e) { /* private mode */ }
    syncTabs();
    render();
  }

  function render() {
    if (!state.data) return;
    redraws = [];
    var d = state.data;
    clear(app);
    app.appendChild(sectionKpis(d));
    var stack = el("div", "stack");
    activeTab().build(d).forEach(function (node) { stack.appendChild(node); });
    app.appendChild(stack);

    // Every chart sizes itself from host.clientWidth, but the sections are
    // built detached — so the first pass measures 0 and falls back to 640px,
    // which CSS then scales up to the real width, inflating the height and
    // every stroke and label with it. Redraw now that they are mounted and
    // can measure honestly.
    for (var ri = 0; ri < redraws.length; ri++) redraws[ri]();

    var stamp = document.getElementById("stamp");
    var gen = new Date(d.generatedAt);
    stamp.textContent = isNaN(gen.getTime()) ? "" : "updated " + gen.toLocaleTimeString();
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < redraws.length; i++) redraws[i]();
    }, 120);
  });

  // ── data ──────────────────────────────────────────────────
  function apiUrl(path) {
    var qs = "days=" + state.days + "&weeks=" + state.weeks +
      "&users=" + FETCH.users + "&events=" + FETCH.events + "&cards=" + FETCH.cards +
      (state.onlyAuthed ? "&onlyAuthed=1" : "");
    return API_BASE + path + "?" + qs;
  }

  function load() {
    if (!state.token) return;
    state.loading = true;
    app.classList.add("loading");   // hold the previous render, no skeleton
    document.getElementById("app-err").hidden = true;

    fetch(apiUrl("summary"), { headers: { "X-Admin-Token": state.token }, cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) { lock("That token was rejected."); return null; }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json) return;
        state.data = json;
        render();
      })
      .catch(function (err) {
        var e = document.getElementById("app-err");
        e.textContent = "Could not load analytics: " + err.message;
        e.hidden = false;
      })
      .finally(function () {
        state.loading = false;
        app.classList.remove("loading");
      });
  }

  function downloadCsv() {
    fetch(apiUrl("users.csv"), { headers: { "X-Admin-Token": state.token }, cache: "no-store" })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "scrolt-users.csv";
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(function () {});
  }

  // ── auth gate ─────────────────────────────────────────────
  var gate = document.getElementById("gate");
  var shell = document.getElementById("shell");

  function unlock(token) {
    state.token = token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    gate.hidden = true;
    shell.hidden = false;
    load();
  }

  function lock(message) {
    state.token = null;
    state.data = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    shell.hidden = true;
    gate.hidden = false;
    var ge = document.getElementById("gate-err");
    if (message) { ge.textContent = message; ge.hidden = false; }
    else ge.hidden = true;
  }

  function tryToken(token, onFail) {
    fetch(API_BASE + "verify", { headers: { "X-Admin-Token": token }, cache: "no-store" })
      .then(function (res) {
        if (res.ok) unlock(token);
        else onFail(res.status === 429 ? "Too many attempts — wait a minute." : "Invalid token.");
      })
      .catch(function () { onFail("Could not reach the API."); });
  }

  document.getElementById("gate-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = document.getElementById("gate-input");
    var val = input.value.trim();
    if (!val) return;
    tryToken(val, function (msg) {
      var ge = document.getElementById("gate-err");
      ge.textContent = msg;
      ge.hidden = false;
    });
  });

  document.getElementById("signout").addEventListener("click", function () { lock(null); });

  // ── controls ──────────────────────────────────────────────
  function syncSeg(id, attr, value) {
    var btns = document.getElementById(id).querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", Number(btns[i].getAttribute(attr)) === value ? "true" : "false");
    }
  }

  document.getElementById("range-seg").addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    state.days = Number(b.getAttribute("data-days"));
    syncSeg("range-seg", "data-days", state.days);
    load();
  });
  document.getElementById("weeks-seg").addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    state.weeks = Number(b.getAttribute("data-weeks"));
    syncSeg("weeks-seg", "data-weeks", state.weeks);
    load();
  });
  document.getElementById("only-authed").addEventListener("change", function (ev) {
    state.onlyAuthed = ev.target.checked;
    load();
  });
  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("tables-toggle").addEventListener("click", function (ev) {
    state.tables = !state.tables;
    document.body.classList.toggle("show-tables", state.tables);
    ev.currentTarget.setAttribute("aria-pressed", state.tables ? "true" : "false");
  });

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme");
    var isDark = current === "dark" ||
      (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    render();
  });

  // ── boot ──────────────────────────────────────────────────
  try {
    var savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  } catch (e) {}

  try {
    var savedTab = sessionStorage.getItem(TAB_KEY);
    if (savedTab) state.tab = savedTab;
  } catch (e) {}

  buildTabs();
  syncTabs();
  syncSeg("range-seg", "data-days", state.days);
  syncSeg("weeks-seg", "data-weeks", state.weeks);

  // A token in the query string is convenient for a bookmark, but must
  // not linger in the address bar / history once we've consumed it.
  var urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    history.replaceState(null, "", window.location.pathname);
  }

  var stored = null;
  try { stored = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
  var boot = urlToken || stored;
  if (boot) {
    tryToken(boot, function () { lock(stored ? null : "Invalid token."); });
  } else {
    lock(null);
  }
})();
</script>
</body>
</html>`;
