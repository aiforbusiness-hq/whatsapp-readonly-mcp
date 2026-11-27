// Turns the raw benchmark runs into bench/results/summary.json and docs/images/benchmark.svg.
//   node bench/chart.mjs [bench/results/raw-<time>.jsonl ...]   (default: every raw-*.jsonl)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "./fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "bench/results");
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(RES).filter((f) => /^raw-.*\.jsonl$/.test(f)).map((f) => join(RES, f));
const rows = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const METHODS = [["plugin", "This plugin (MCP)"], ["browser", "Browser automation"]];
const LABEL = { waiting: "Who is waiting?", "group-summary": "Summarise a group", "find-invoice": "Find a message" };

const summary = { generated: new Date().toISOString(), runs: rows.length, models: [...new Set(rows.map((r) => r.model))], tasks: {} };
for (const t of TASKS) {
  summary.tasks[t.id] = {};
  for (const [m] of METHODS) {
    const r = rows.filter((x) => x.task === t.id && x.method === m);
    if (!r.length) continue;
    summary.tasks[t.id][m] = {
      runs: r.length, correct: r.filter((x) => x.correct).length,
      median_seconds: +(median(r.map((x) => x.wall_ms)) / 1000).toFixed(1),
      median_tokens: Math.round(median(r.map((x) => x.tokens.total))),
      median_turns: median(r.map((x) => x.turns)),
      median_cost_usd: +median(r.map((x) => x.cost_usd)).toFixed(4)
    };
  }
}
const totals = {};
for (const [m] of METHODS) {
  const per = TASKS.map((t) => summary.tasks[t.id][m]).filter(Boolean);
  if (per.length) totals[m] = { seconds: +per.reduce((a, x) => a + x.median_seconds, 0).toFixed(1), tokens: per.reduce((a, x) => a + x.median_tokens, 0),
    correct: per.reduce((a, x) => a + x.correct, 0), runs: per.reduce((a, x) => a + x.runs, 0) };
}
summary.totals = totals;
writeFileSync(join(RES, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

// --- SVG: two panels (time, tokens), one group per question, two bars each ---
const W = 920, panelH = 250, pad = 16, labelW = 170, barH = 18, gap = 6, groupGap = 22;
const COL = { plugin: "#f5c83b", browser: "#8696a0" };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));
function panel(y0, title, key, fmt) {
  const max = Math.max(...TASKS.flatMap((t) => METHODS.map(([m]) => summary.tasks[t.id][m]?.[key] || 0))) * 1.15;
  const x0 = pad + labelW, x1 = W - pad - 60;
  let s = `<text x="${pad}" y="${y0 + 18}" class="h">${esc(title)}</text>`;
  let y = y0 + 34;
  for (const t of TASKS) {
    s += `<text x="${pad}" y="${y + barH + 4}" class="l">${esc(LABEL[t.id] || t.id)}</text>`;
    for (const [m] of METHODS) {
      const v = summary.tasks[t.id][m]?.[key];
      if (v == null) { y += barH + gap; continue; }
      const w = Math.max(2, ((x1 - x0) * v) / max);
      s += `<rect x="${x0}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="4" fill="${COL[m]}"/>`;
      s += `<text x="${(x0 + w + 6).toFixed(1)}" y="${y + barH - 4}" class="v">${esc(fmt(v))}</text>`;
      y += barH + gap;
    }
    y += groupGap - gap;
  }
  return s;
}
const h1 = 34 + TASKS.length * (2 * (barH + gap) + groupGap - gap) + 10;
const H = 70 + h1 * 2 + 40;
const tP = totals.plugin, tB = totals.browser;
const ratio = (a, b) => (a && b ? (b / a).toFixed(1) + "×" : "");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<style>.h{font-size:16px;font-weight:700;fill:#111b21}.l{font-size:14px;fill:#3b4a54}.v{font-size:13px;font-weight:600;fill:#111b21}.s{font-size:13px;fill:#54656f}</style>
<rect width="${W}" height="${H}" rx="14" fill="#ffffff" stroke="#e9edef"/>
<text x="${pad}" y="28" class="h" font-size="18">Same questions, same made-up WhatsApp page (median of ${Math.round(rows.length / (TASKS.length * METHODS.length))} runs each)</text>
<rect x="${pad}" y="40" width="14" height="14" rx="3" fill="${COL.plugin}"/><text x="${pad + 20}" y="52" class="s">This plugin (MCP)</text>
<rect x="${pad + 160}" y="40" width="14" height="14" rx="3" fill="${COL.browser}"/><text x="${pad + 180}" y="52" class="s">Browser automation (Playwright MCP)</text>
${tP && tB ? `<text x="${W - pad}" y="52" class="s" text-anchor="end">Overall: ${ratio(tP.seconds, tB.seconds)} faster, ${ratio(tP.tokens, tB.tokens)} fewer tokens</text>` : ""}
${panel(64, "Time to answer (seconds, lower is better)", "median_seconds", (v) => v.toFixed(1) + " s")}
${panel(64 + h1, "Tokens used (lower is better)", "median_tokens", fmtK)}
<text x="${pad}" y="${H - 14}" class="s">Model: ${esc(summary.models.join(", "))} · Claude Code CLI · raw runs in bench/results/</text>
</svg>
`;
writeFileSync(join(ROOT, "docs/images/benchmark.svg"), svg);
console.log(JSON.stringify(summary.totals), "->", "docs/images/benchmark.svg");
