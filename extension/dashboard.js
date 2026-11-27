// 仪表板。两种用法：
// - 独立分页：dashboard.html 载入这个文件，挂在 document
// - WhatsApp 页面里：manifest 把这个文件当内容脚本载入，sidebar.js 把画面放进 closed shadow DOM 再呼叫 mount()
//   （WhatsApp 网页有 Cross-Origin-Embedder-Policy: require-corp，iframe 会被 Chrome 挡住，所以不用 iframe）
// 资料全部来自背景程序；对话名称、信息内容一律用 textContent 显示；导出 = 在这台电脑产生文件
(() => {
if (globalThis.__waAssistantDashboard) return;
function mount(ROOT, OPTS) {
const EMBED = !!OPTS.embed;
// 画面文字：英文时把 HTML 里的中文换掉（i18n.js）
localizeDOM(ROOT, {"自动「不用回」": "Auto \"No reply needed\"", "等了超过这么多天的对话，自动当作不用回，不算进「等你回」。对方再传信息就会回来。": "Chats waiting longer than this count as \"No reply needed\" and leave the waiting list. They come back when the person messages again.", "自动不用回": "Auto no reply needed", "关": "Off", "3 天": "3 days", "7 天": "7 days", "14 天": "14 days", "30 天": "30 days", "全部标为不用回": "Mark all as No reply needed", "请让电脑开着，并在 Chrome 打开 WhatsApp Web。关掉了，AI 就读不到。": "Keep your computer on and WhatsApp Web open in Chrome. Your AI can only read it while they're open.", "设定": "Settings", "语言": "Language", "仪表板、插件弹窗和输入框上方的草稿卡用的语言。": "Used by the dashboard, the extension popup and the draft card above the message box.", "跟浏览器": "Same as browser", "AI for Business Chat Assistant 仪表板": "AI for Business Chat Assistant dashboard", "连接中…": "Connecting…", "仪表板": "Dashboard", "概览": "Overview", "谁在等你回": "Who's waiting for you", "AI 活动纪录": "AI activity", "AI 读了什么": "What your AI read", "草稿 vs 实际": "Drafts vs actual", "AI 草稿用了多少": "How much AI drafting you used", "导出": "Export", "CSV / JSON 存到下载": "CSV / JSON to Downloads", "资料只留在你的浏览器，只在你要求时由 AI 连接器读取。": "Your data stays in your browser. Your AI connector reads it only when you ask.", "重新读取": "Refresh", "在新分页打开": "Open in new tab", "关闭仪表板（Esc）": "Close dashboard (Esc)", "关闭（Esc）": "Close (Esc)", "配对码": "Pairing code", "6 位数": "6 digits", "配对": "Pair", "资料只在你的电脑里": "Your data stays on your computer", "只走本机连线（127.0.0.1）。我们没有服务器，": "Local connections only (127.0.0.1). We have no server, and ", "对话不经过我们。": "your chats never pass through us.", "你的 AI 通过 Plugin（MCP），用上锁的本机连线连到 Chrome Extension，再读 WhatsApp Web。全部在你的电脑里。": "Your AI connects through its Plugin (MCP) over a locked local connection to the Chrome extension, which reads WhatsApp Web. All on your computer.", "你的电脑": "Your computer", "你的 AI + Plugin": "Your AI + Plugin", "只读": "Read-only", "怎么确定是安全的": "How you can tell it is safe", "现在就检查得到的 · 老实说": "What you can check now · the honest part", "你在 Claude / ChatGPT 里问问题时，AI 读到的内容会送去 Anthropic 或 OpenAI 处理，就像平常用 AI 一样；不会送到 AI for Business。": "When you ask Claude / ChatGPT a question, what the AI reads is sent to Anthropic or OpenAI to process, just like normal AI use. Nothing is sent to AI for Business.", "这是非官方工具，用的是 WhatsApp Web 内部的读法。WhatsApp 有可能限制账号；建议先用工作副号。": "This is an unofficial tool that reads WhatsApp Web internals. WhatsApp could restrict accounts; try it with a work number first.", "程序不会发信息，回复永远由你自己按发送。": "The program never sends messages; you always press send yourself.", "想完全清掉：插件弹窗「清空草稿」、「AI 活动纪录」清空纪录，再移除插件。": "To remove everything: \"Clear drafts\" in the extension popup, clear \"AI activity\", then remove the extension.", "个人在等你回": "waiting for your reply", "看全部": "See all", "你应该知道": "Worth knowing", "信息趋势": "Message trends", "近 14 天收发量 · 别人几点找你": "Last 14 days · when people message you", "图表": "Charts", "近 14 天": "Last 14 days", "时段": "By hour", "收到": "Received", "我发出": "You sent", "看表格": "Show table", "最活跃的对话": "Most active chats", "近 7 天": "Last 7 days", "近 14 天 AI 请求": "AI requests, last 14 days", "请求纪录": "Request log", "按 AI 筛选": "Filter by AI", "显示更多": "Show more", "关于这份纪录": "About this log", "存什么 · 怎么清空": "What is kept · how to clear it", "清空活动纪录": "Clear AI activity", "AI 草稿你用了（照用或改过再发）": "of AI drafts you used (as is or edited)", "每一条草稿": "Every draft", "按结果筛选": "Filter by result", "点一条看草稿和你实际发出的信息。": "Click one to see the draft and what you actually sent.", "时间范围": "Time range", "近 30 天": "Last 30 days", "近 90 天（全部）": "Last 90 days (all)", "对话时间线": "Chat timeline", "有 AI 草稿的对话，所有信息按时间排好；你发出的每一条都有时间，不管有没有用草稿。": "Chats that have AI drafts, every message in time order; each message you sent has its time, whether or not you used the draft.", "下载 CSV": "Download CSV", "放入 AI 草稿": "Include AI drafts", "草稿排在它建立的时间点（原本打算填进输入框的位置）": "Each draft is placed at the time it was created (where it was meant to go into the message box)", "放入对方的信息": "Include their messages", "关掉 = 只有你自己发出的信息": "Off = only the messages you sent", "其他格式": "Other formats", "只有草稿 · 草稿 + 回复 · JSON · 活动纪录": "Drafts only · drafts + replies · JSON · AI activity", "只有草稿": "Drafts only", "AI 写的每一条草稿和时间。": "Every draft the AI wrote, with its time.", "草稿 + 实际回复": "Drafts + actual replies", "每条草稿一行，旁边是插件估计的「那一轮」回复和相似度。": "One row per draft, next to the reply round the extension matched and the similarity.", "完整资料": "Full data", "给另一个 AI 分析用。": "For another AI to analyse.", "哪个 AI 什么时候读了什么。": "Which AI read what, and when.", "文件存到你电脑的「下载」文件夹，不会上传。CSV 可以用 Excel / Google 表格 / Numbers 打开。": "Files are saved to your Downloads folder and never uploaded. CSV opens in Excel / Google Sheets / Numbers.", "看文件真正的内容，不信名字。只存看得完、查得完的文件：照片、影片、声音、纯文字、PDF、新版 Office（docx / xlsx / pptx）。": "Judged by what the file really is, not its name. Only types that can be checked completely are saved: photos, video, audio, plain text, PDF and new Office files (docx / xlsx / pptx).", "其他一律不存：程序和脚本、网页、所有压缩档（zip、rar、7z）、旧版 Office（doc / xls / ppt）、RTF、SVG、名字跟内容对不上的文件。要的话，确认是认识的人传的，再自己在 WhatsApp 里下载。": "Everything else is refused: programs and scripts, web pages, all archives (zip, rar, 7z), old Office files (doc / xls / ppt), RTF, SVG, and files whose name does not match their content. If you trust the sender, download it in WhatsApp yourself.", "PDF 会解开每一部分检查：带程序码、会叫电脑执行程序、夹带别的文件，就不存。Office 文件带巨集、内嵌物件、DDE 或连到外面的范本，也不存。CSV 表格里有公式或指令（= + - @ 开头），也不存。加密、太大或太复杂看不完的，也不存。": "Every part of a PDF is unpacked and checked: code, starting programs or attached files means it is not saved. Office files with macros, embedded objects, DDE or outside templates are not saved either, nor CSV files with formulas or commands (cells starting with = + - @). Encrypted, too large or too complex files are not saved.", "没有「打开」按钮，只有「在文件夹中显示」。打开前先确认是认识的人传的。": "There is no Open button, only Show in folder. Before opening a file, make sure someone you know sent it.", "检查不到：照片、影片、PDF 阅读程序本身的漏洞，和新的病毒。电脑和 Chrome 的防毒还是要开着。": "Not caught: weaknesses in photo, video or PDF programs themselves, and new viruses. Keep your computer's and Chrome's virus protection on."});
localizeDOM(ROOT, {"新的 AI 草稿": "New AI drafts", "看全部草稿": "See all drafts", "还没发出去。打开对话，草稿会出现在输入框上方；你看过再按发送。": "Not sent yet. Open the chat and the draft appears above the message box; check it, then press send yourself."});
localizeDOM(ROOT, {"我的资料": "My data", "存了什么 · 清除": "What is stored · Clear", "这些资料只存在这台电脑的 Chrome 里，不会传到网络上。清除后没办法复原。已经下载到「下载 / AI for Business Chat Assistant」的文件不会被删掉，要删请自己在文件夹里删。": "This data is kept only in Chrome on this computer and is never sent over the internet. Clearing cannot be undone. Files already in Downloads / AI for Business Chat Assistant are not deleted; delete them in the folder yourself.", "全部清除": "Clear everything", "上面每一项都清掉，包括配对。之后要用，要在 AI 里问「WhatsApp 状态」拿新的配对码重新配对。": "Clears every item above, including pairing. To use it again, ask your AI \"WhatsApp status\" for a new pairing code.", "取消": "Cancel", "清除": "Clear"});
localizeDOM(ROOT, {"取消配对": "Unpair", "插件忘掉配对密钥、断开所有 AI。之后要用，要在 AI 里问「WhatsApp 状态」拿新的配对码重新配对。": "The extension forgets its pairing secret and disconnects every AI. To use it again, ask your AI \"WhatsApp status\" for a new pairing code and pair again.", "AI 下载的文件": "Files AI downloaded", "最近下载": "Recent downloads", "预览 · 安全检查": "Previews · safety checks", "你叫 AI 下载的照片、影片、语音和文件。预览图是插件重新画过的小图，不是原文件。这里不会打开文件。": "Photos, videos, voice notes and files you asked AI to download. Previews are small copies redrawn by the extension, not the original files. Nothing is opened here.", "怎么防恶意文件": "How malware is kept out", "检查什么 · 检查不到什么": "What is checked · what is not", "没有「打开」按钮，只有「在文件夹中显示」。打开前先确认是认识的人传的。": "There is no Open button, only Show in folder. Before opening a file, make sure someone you know sent it.", "清空这份纪录": "Clear this list"});

const $ = (id) => ROOT.getElementById(id);
// 跟背景程序讲话：有时间上限；插件被重新载入（旧页面跟插件断线）时给清楚的提示
let ORPHANED = false;
async function ask(msg, ms = 20000) {
  if (!chrome.runtime?.id) { ORPHANED = true; throw new Error("ORPHANED"); }
  let timer;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage(msg),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("TIMEOUT")), ms); })
    ]);
  } catch (e) {
    const m = String(e?.message || e);
    if (/context invalidated|Receiving end does not exist|ORPHANED/i.test(m) && !chrome.runtime?.id) ORPHANED = true;
    throw e;
  } finally { clearTimeout(timer); }
}
function failText(e) {
  const m = String(e?.message || e);
  if (ORPHANED) return tr("插件刚更新过，这一页跟插件断线了。请重新整理 WhatsApp 页面。", "The extension was just updated, so this page lost its connection. Please reload WhatsApp.");
  if (m === "TIMEOUT") return tr("插件太久没回应（WhatsApp 可能还在载入）。等一下再按右上角重新读取。", "The extension took too long to answer (WhatsApp may still be loading). Wait a moment, then press refresh at the top right.");
  return tr("读不到插件资料：", "Can't read the extension data: ") + m;
}
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  return n;
}

// ---------- 格式 ----------
const pad = (n) => String(n).padStart(2, "0");
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function ago(iso) {
  if (!iso) return tr("从来没有", "never");
  const sec = (Date.now() - Date.parse(iso)) / 1000;
  if (sec < 60) return tr("刚刚", "just now");
  if (sec < 3600) return Math.floor(sec / 60) + tr(" 分钟前", " min ago");
  if (sec < 86400) return Math.floor(sec / 3600) + tr(" 小时前", " h ago");
  return Math.floor(sec / 86400) + tr(" 天前", " days ago");
}
function dur(mins) {
  if (mins == null) return "—";
  if (mins < 1) return tr("不到 1 分钟", "under 1 min");
  if (mins < 60) return Math.round(mins) + tr(" 分钟", " min");
  if (mins < 1440) return (Math.round(mins / 6) / 10) + tr(" 小时", " h");
  return (Math.round(mins / 144) / 10) + tr(" 天", " days");
}
function hoursText(h) {
  if (h == null) return "—";
  if (h < 1) return Math.max(1, Math.round(h * 60)) + tr(" 分钟", " min");
  if (h < 48) return Math.round(h) + tr(" 小时", " h");
  return Math.round(h / 24) + tr(" 天", " days");
}
const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");

function clientName(raw) {
  const r = String(raw || "").toLowerCase();
  if (!r || r === "ai") return "AI";
  if (r.includes("claude-code") || r === "claude code") return "Claude Code";
  if (r.includes("claude") || r.startsWith("local-agent-mode")) return tr("Claude 桌面版", "Claude desktop");
  if (r.includes("codex") || r.includes("openai") || r.includes("chatgpt")) return "ChatGPT / Codex";
  if (r.includes("grok")) return "Grok";
  return raw;
}
const clientFamily = (raw) => {
  const n = clientName(raw);
  return n.startsWith("Claude") ? "Claude" : n.startsWith("ChatGPT") ? "ChatGPT" : "Other";
};
const OP_NAMES = {
  status: tr("查连线状态", "Checked connection"), list_chats: tr("列出对话", "Listed chats"), get_messages: tr("读对话信息", "Read messages"), search_messages: tr("搜信息", "Searched messages"), get_media: tr("看图片 / 文件", "Viewed a photo or file"), download_media: tr("下载图片 / 文件", "Downloaded a photo or file"),
  list_awaiting_reply: tr("找等我回的人", "Found who's waiting"), save_draft: tr("存回复草稿", "Saved a reply draft"), list_drafts: tr("读草稿清单", "Read the draft list")
};

// ---------- 草稿 vs 实际：相似度（字元两两一组比对，中英文都适用） ----------
function norm(t) { return String(t || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }
function bigrams(t) {
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (x.length - 1 + y.length - 1);
}
function actualOf(d) {
  if (Array.isArray(d.actual_messages) && d.actual_messages.length) return d.actual_messages;
  return d.actual_reply ? [d.actual_reply] : [];
}
const OUTCOMES = {
  same: { label: tr("照用", "Used as is"), cls: "ok", hint: tr("你发出的跟草稿几乎一样", "What you sent is almost the same as the draft") },
  edited: { label: tr("改过再发", "Edited"), cls: "mid", hint: tr("保留了一部分草稿", "Kept part of the draft") },
  rewrote: { label: tr("自己重写", "Rewritten"), cls: "info", hint: tr("你发的跟草稿很不一样", "What you sent is very different from the draft") },
  waiting: { label: tr("还没回", "Not replied yet"), cls: "plain", hint: tr("草稿之后你还没发信息", "You haven't sent anything since the draft") },
  noreply: { label: tr("没回", "No reply"), cls: "bad", hint: tr("超过 24 小时没发信息", "Nothing sent for over 24 hours") },
  dismissed: { label: tr("不用了", "Dismissed"), cls: "plain", hint: tr("你按了「不用了」，之后也没发", "You pressed \"Dismiss\" and didn't send anything after") }
};
function analyze(d) {
  const act = actualOf(d);
  const joined = act.map((m) => m.text || "").join("\n");
  const sim = act.length ? similarity(d.text, joined) : null;
  let outcome;
  if (act.length) outcome = sim >= 0.8 ? "same" : sim >= 0.4 ? "edited" : "rewrote";
  else if (d.status === "dismissed") outcome = "dismissed";
  else if (Date.now() - Date.parse(d.created_at) > 24 * 3600 * 1000) outcome = "noreply";
  else outcome = "waiting";
  const minutes = act.length ? (Date.parse(act[0].time) - Date.parse(d.created_at)) / 60000 : null;
  return { act, joined, sim, outcome, minutes, used_button: !!(d.inserted_at || d.copied_at) };
}

// 新草稿：还没用（pending）、之后你也还没回、7 天内存的。概览最上面和草稿列表都用这个标出来
const isNewDraft = ({ d, a }) => d.status === "pending" && !a.act.length && Date.now() - Date.parse(d.created_at) < 7 * 86400000;

// ---------- 资料 ----------
let DATA = null;
let actFilter = "all";
let actShown = 20;
let draftFilter = "all";
let draftShown = 20;
let showAllWaiting = false;
let showAllTips = false;
let chartMode = "daily";

async function load() {
  $("refresh").classList.add("spin");
  let r;
  try { r = await ask({ type: "dash_data" }, 30000); }
  catch (e) { r = { ok: false, reason: failText(e) }; }
  $("refresh").classList.remove("spin");
  if (!r?.ok) {
    showBanner(r?.reason || tr("读不到插件资料", "Can't read the extension data"));
    if (!DATA) { $("statusDot").className = "dot bad"; $("statusMain").replaceChildren(ORPHANED ? tr("要重新整理页面", "Reload the page") : tr("读不到插件", "Can't reach the extension")); $("statusSub").textContent = ""; }
    return;
  }
  DATA = r;
  DATA.analyzed = r.drafts.map((d) => ({ d, a: analyze(d) }));
  await applyIgnored();
  render();
}
// 「不用回」：用户标记的对话先不算「在等你回」，直到对方再传新信息
let IGNORED = {};
async function applyIgnored() {
  try { IGNORED = (await chrome.storage.local.get("ignored_waiting")).ignored_waiting || {}; } catch (_) { IGNORED = {}; }
  const st = DATA.stats?.ok ? DATA.stats : null;
  if (!st) return;
  st.waiting_all = st.waiting_all || st.waiting_longest;
  st.base_totals = st.base_totals || { ...st.totals };
  const isIgn = (w) => IGNORED[w.id] && IGNORED[w.id] === (w.last || w.since);
  // 被标「不用回」、而且现在还在等的人：直接查这几个对话（不扫全部）
  const ids = Object.keys(IGNORED);
  let ign = [];
  if (ids.length) {
    try {
      const got = await chrome.storage.session.get(ids.map((id) => "c:" + id));
      for (const id of ids) { const r = got["c:" + id]; if (r && r.awaiting_my_reply === true && !r.is_group && !r.archived && isIgn(r)) ign.push(r); }
    } catch (_) { ign = st.waiting_all.filter(isIgn); }
  }
  st.waiting_longest = st.waiting_all.filter((w) => !isIgn(w));
  st.ignored_count = ign.length;
  st.totals.waiting_people = Math.max(0, st.base_totals.waiting_people - ign.length);
  const day = Date.now() - 86400000;
  st.totals.waiting_over_24h = Math.max(0, st.base_totals.waiting_over_24h - ign.filter((r) => Date.parse(r.since) <= day).length);
}
async function setIgnored(w, on) {
  const cur = (await chrome.storage.local.get("ignored_waiting")).ignored_waiting || {};
  if (on) cur[w.id] = w.last || w.since; else delete cur[w.id];
  // 只留最近 500 个
  const keys = Object.keys(cur);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete cur[k];
  await chrome.storage.local.set({ ignored_waiting: cur });
  await applyIgnored();
  render();
}
// 一次把现在等你回的人全部标为「不用回」（按两次确认）
async function setIgnoredMany(list) {
  const cur = (await chrome.storage.local.get("ignored_waiting")).ignored_waiting || {};
  for (const w of list) cur[w.id] = w.last || w.since;
  const keys = Object.keys(cur);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete cur[k];
  await chrome.storage.local.set({ ignored_waiting: cur });
  await applyIgnored();
  render();
}
let ignoreAllArmed = false;
$("ignoreAll").addEventListener("click", (e) => {
  if (!e.isTrusted) return;
  const list = DATA?.stats?.ok ? DATA.stats.waiting_longest : [];
  if (!list.length) return;
  if (!ignoreAllArmed) {
    ignoreAllArmed = true;
    e.target.textContent = tr(`确定把 ${list.length} 个都标为不用回？再按一次`, `Mark all ${list.length}? Click again`);
    setTimeout(() => { ignoreAllArmed = false; renderOverview(); }, 4000);
    return;
  }
  ignoreAllArmed = false;
  setIgnoredMany(list);
});
async function clearIgnored() {
  await chrome.storage.local.remove("ignored_waiting");
  await applyIgnored();
  render();
}
function showBanner(text) { const b = $("banner"); b.hidden = !text; b.textContent = text || ""; }

function render() {
  const { connection, stats, activity } = DATA;
  MODE = connMode(connection);
  const servers = (connection.servers || []).filter((x) => x.state === "ready");
  const dot = $("statusDot");
  if (connection.ready > 0) {
    dot.className = "dot ok";
    $("statusMain").replaceChildren(tr("已连上", "Connected"), aiIcons(servers, "mini-ai"));
  }
  else if (connection.need_pair > 0) { dot.className = "dot warn"; $("statusMain").replaceChildren(tr("要配对", "Needs pairing")); }
  else if (!connection.paired) { dot.className = "dot warn"; $("statusMain").replaceChildren(tr("还没连上 AI", "AI not connected yet")); }
  else { dot.className = "dot bad"; $("statusMain").replaceChildren(tr("AI 没开", "AI is closed")); }
  $("statusSub").textContent = MODE === "down" && activity.marks.last_connected
    ? tr("上次连上：", "Last connected: ") + ago(activity.marks.last_connected)
    : tr("上次 AI 同步：", "Last AI sync: ") + ago(activity.marks.last_sync);
  renderSetup();
  showBanner(stats?.ok ? "" : tr("WhatsApp Web 现在读不到（", "WhatsApp Web can't be read right now (") + (stats?.reason || tr("没开或还在载入", "not open or still loading")) + tr("）。只显示已存的草稿和纪录。", "). Showing saved drafts and records only."));

  // 选单上的小字
  if (stats?.ok) $("subOverview").textContent = stats.totals.waiting_people ? tr(`${stats.totals.waiting_people} 个人在等你回`, `${stats.totals.waiting_people} waiting for your reply`) : tr("没有人在等你回", "No one is waiting for your reply");
  $("subActivity").textContent = activity.log[0] ? tr(`上一个请求：${ago(activity.log[0].time)}`, `Last request: ${ago(activity.log[0].time)}`) : tr("还没有请求", "No requests yet");
  const ds = draftSummary(90);
  $("subDrafts").textContent = ds.total ? tr(`${ds.total} 条草稿 · 用了 ${pct(ds.useRate)}`, `${ds.total} drafts · ${pct(ds.useRate)} used`) : tr("还没有草稿", "No drafts yet");

  const badge = (id, n, quiet) => { const b = $(id); b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n || ""); b.classList.toggle("quiet", !!quiet); };
  badge("mb-overview", stats?.ok ? stats.totals.waiting_people : 0);
  const today = new Date().toDateString();
  badge("mb-activity", activity.log.filter((x) => new Date(x.time).toDateString() === today).length, true);
  badge("mb-drafts", DATA.analyzed.filter((x) => (x.d.status === "pending" || x.d.status === "inserted" || x.d.status === "copied") && !x.a.act.length && Date.now() - Date.parse(x.d.created_at) < 7 * 86400000).length);
  renderOverview();
  renderActivity();
  renderFiles();
  renderDrafts();
  renderFlow();
  renderSecurity();
  renderExportCount();
}


// 资料安全图：最左边显示「现在连着」的 AI（Claude / ChatGPT…），几个就叠几个
const AI_ICON = {
  Claude: (g) => {
    g.append(s("circle", { r: "18", fill: "#d97757" }));
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI) / 5 + 0.2, r1 = 2.5, r2 = k % 2 ? 9 : 11;
      g.append(s("line", { x1: (r1 * Math.cos(a)).toFixed(2), y1: (r1 * Math.sin(a)).toFixed(2), x2: (r2 * Math.cos(a)).toFixed(2), y2: (r2 * Math.sin(a)).toFixed(2), stroke: "#fff", "stroke-width": "2.4", "stroke-linecap": "round" }));
    }
  },
  ChatGPT: (g) => {
    g.append(s("circle", { r: "18", fill: "#111111" }));
    for (let k = 0; k < 6; k++) g.append(s("ellipse", { cx: "0", cy: "-4.2", rx: "3.4", ry: "6.6", fill: "none", stroke: "#fff", "stroke-width": "1.7", transform: `rotate(${k * 60})` }));
  },
  Other: (g) => {
    g.append(s("circle", { r: "18", fill: "#54656f" }));
    g.append(s("path", { d: "M0 -9l2.2 6.8L9 0l-6.8 2.2L0 9l-2.2-6.8L-9 0l6.8-2.2z", fill: "#fff" }));
  }
};
function aiIcons(servers, cls) {
  const fams = [...new Set(servers.map((x) => clientFamily(x.client)))];
  return el("span", { class: "mini-stack" }, fams.map((f) => {
    const svg = s("svg", { viewBox: "-20 -20 40 40", class: cls, role: "img", "aria-label": f === "Other" ? "AI" : f });
    (AI_ICON[f] || AI_ICON["Other"])(svg);
    const t = s("title", {}); t.textContent = f === "Other" ? "AI" : f; svg.append(t);
    return svg;
  }));
}
function renderFlow() {
  const servers = (DATA.connection.servers || []).filter((x) => x.state === "ready");
  let fams = [...new Set(servers.map((x) => clientFamily(x.client)))];
  const flowSvg = ROOT.querySelector(".flow");
  flowSvg.classList.toggle("off", MODE !== "ok");
  flowSvg.classList.toggle("nowa", !DATA.stats?.ok);
  // AI 没开时：显示最近用过的 AI（灰色）
  if (!fams.length) fams = [...new Set(DATA.activity.log.slice(0, 50).map((x) => clientFamily(x.client)).filter((f) => f !== "Other"))].slice(0, 3);
  const box = $("aiIcons");
  box.replaceChildren();
  if (!fams.length) fams = ["Other"];
  // 横向一排：连着的 AI 图示 + AI for Business 图示（Plugin），一样大小、互相叠一点
  const n = fams.length + 1, step = 26, start = -((n - 1) * step) / 2;
  fams.forEach((f, i) => {
    const g = s("g", { transform: `translate(${start + i * step} 0)`, class: "ai-stack" });
    if (i) g.append(s("circle", { r: "20", class: "sep" }));
    (AI_ICON[f] || AI_ICON["Other"])(g);
    const t = s("title", {}); t.textContent = f === "Other" ? "AI" : f; g.append(t);
    box.append(g);
  });
  const px = start + fams.length * step;
  const pg = s("g", { transform: `translate(${px} 0)` });
  pg.append(s("rect", { x: "-20", y: "-20", width: "40", height: "40", rx: "11", class: "sep-sq" }));
  const mark = ROOT.querySelector(".mark").cloneNode(true);
  mark.removeAttribute("class"); mark.removeAttribute("role"); mark.removeAttribute("aria-label");
  for (const [k, v] of Object.entries({ x: "-18", y: "-18", width: "36", height: "36" })) mark.setAttribute(k, v);
  const pt = s("title", {}); pt.textContent = tr("Plugin（MCP）：你的 AI 在这台电脑开的小程序，连到 AI for Business 插件", "Plugin (MCP): a small program your AI runs on this computer, connected to the AI for Business extension");
  pg.append(mark, pt);
  box.append(pg);
  $("aiSub").textContent = { ok: tr("已连上 · MCP", "Connected · MCP"), pair: tr("要配对", "Needs pairing"), never: tr("还没连上", "Not connected"), down: tr("AI 没开", "AI is closed") }[MODE];
}

// ---------- 连线状态：ok 已连上 / pair 要配对 / never 从没连过 / down 配对过但 AI 现在没开 ----------
let MODE = "ok";
function connMode(c) {
  if (c.ready > 0) return "ok";
  if (c.need_pair > 0) return "pair";
  return c.paired ? "down" : "never";
}
const SETUP_ICON = {
  never: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  pair: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  down: "M18.4 5.6a9 9 0 1 1-12.8 0M12 2v10"
};
function renderSetup() {
  const card = $("setup");
  const stOk = !!DATA.stats?.ok;
  card.hidden = MODE === "ok";
  // 「电脑要开着」的提醒只出现一次：没连上时放在设定卡里，连上后放在资料安全卡里
  const keep = ROOT.querySelector(".safe .keep-open");
  if (keep) keep.hidden = MODE !== "ok";
  if (MODE === "ok") return;
  card.className = "card setup " + MODE;
  const svg = s("svg", { viewBox: "0 0 24 24" });
  svg.append(s("path", { d: SETUP_ICON[MODE] }));
  $("setupIc").replaceChildren(svg);
  const steps = $("setupSteps");
  steps.replaceChildren();
  steps.hidden = MODE !== "never";
  $("pairForm").hidden = MODE === "down";
  if (MODE === "never") {
    $("setupTitle").textContent = tr("还没连上 AI", "AI not connected yet");
    $("setupText").textContent = tr("下面的统计照样看得到。要让 Claude / ChatGPT 帮你读信息、起草回复，先连一次：", "Your stats below still work. To let Claude / ChatGPT read messages and draft replies, connect once:");
    for (const html of [
      [tr("装 AI 那边：", "Install the AI side: "), tr("Claude 桌面版双击 aiforbusiness-chat-assistant.mcpb；Claude Code 或 ChatGPT 桌面版装插件（看安装说明）。", "Claude desktop: double-click aiforbusiness-chat-assistant.mcpb. Claude Code or ChatGPT desktop: install the plugin (see the install guide).")],
      [tr("在 AI 里问：", "Ask your AI: "), tr("「WhatsApp 状态」。它会回你一个 6 位数配对码。", "\"WhatsApp status\". It replies with a 6-digit pairing code.")],
      [tr("输入配对码：", "Enter the code: "), tr("填在下面，按「配对」。只要做一次。", "type it below and press Pair. You only do this once.")]
    ]) steps.append(el("li", {}, el("b", { text: html[0] }), html[1]));
  } else if (MODE === "pair") {
    $("setupTitle").textContent = tr("AI 已经打开，要配对一次", "Your AI is open. Pair it once");
    $("setupText").textContent = tr("在 Claude / ChatGPT 里问「WhatsApp 状态」，把它给的 6 位数配对码填在下面。", "Ask Claude / ChatGPT \"WhatsApp status\" and enter the 6-digit pairing code it gives you below.");
  } else {
    const last = DATA.activity.marks.last_connected;
    $("setupTitle").textContent = tr("AI 现在没开", "Your AI is closed right now");
    $("setupText").textContent = tr("打开 Claude 或 ChatGPT 就会自动连上，不用再配对。", "Open Claude or ChatGPT and it reconnects by itself; no need to pair again.") + (last ? tr(`上次连上是 ${ago(last)}。`, `Last connected ${ago(last)}.`) : "") + tr("AI 没开的时候，下面的统计、草稿和导出照样能用。", " While the AI is closed, the stats, drafts and export below still work.");
  }
  if (!stOk && MODE !== "ok") {} // WhatsApp 读不到的提示在横幅
}
$("pairForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("pairCode").value.replace(/\D/g, "");
  const msg = $("pairMsg");
  if (code.length !== 6) { msg.className = "pair-msg bad"; msg.textContent = tr("配对码是 6 位数字", "The pairing code is 6 digits"); return; }
  $("pairBtn").disabled = true;
  msg.className = "pair-msg"; msg.textContent = tr("配对中…", "Pairing…");
  let r;
  try { r = await ask({ type: "dash_pair", code }, 45000); } catch (err) { r = { ok: false, reason: failText(err) }; }
  $("pairBtn").disabled = false;
  if (r?.ok) { msg.className = "pair-msg ok"; msg.textContent = tr("配对好了", "Paired"); $("pairCode").value = ""; load(); }
  else { msg.className = "pair-msg bad"; msg.textContent = r?.reason || tr("配对失败", "Pairing failed"); }
});

// 每 8 秒看一次连线：AI 打开 / 关掉 / 配对好，画面自己更新
let lastPollMode = null;
const poll = setInterval(async () => {
  if (document.hidden || !DATA || ORPHANED) return;
  let c;
  try { c = await ask({ type: "dash_state" }, 8000); } catch (e) { if (ORPHANED) showBanner(failText(e)); return; }
  const m = connMode(c);
  if (lastPollMode !== null && m !== lastPollMode) load();
  else if (m !== MODE) load();
  lastPollMode = m;
}, 8000);

// ---------- 确认视窗：清除 / 取消配对之前一定先问 ----------
function confirmBox(title, body, yes) {
  return new Promise((resolve) => {
    const back = $("confirmBack"), ok = $("confirmYes"), no = $("confirmNo");
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = body;
    ok.textContent = yes || tr("清除", "Clear");
    no.textContent = tr("取消", "Cancel");
    const before = ROOT.activeElement;
    back.hidden = false;
    no.focus(); // 预设停在「取消」，按 Enter 不会误删
    const done = (v) => {
      back.hidden = true;
      ok.removeEventListener("click", onYes); no.removeEventListener("click", onNo); back.removeEventListener("keydown", onKey); back.removeEventListener("click", onBack);
      try { before?.focus?.(); } catch (_) {}
      resolve(v);
    };
    const onYes = (e) => { if (e.isTrusted) done(true); };
    const onNo = () => done(false);
    const onBack = (e) => { if (e.target === back) done(false); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      if (e.key === "Tab") { e.preventDefault(); (ROOT.activeElement === ok ? no : ok).focus(); }
    };
    ok.addEventListener("click", onYes); no.addEventListener("click", onNo); back.addEventListener("keydown", onKey); back.addEventListener("click", onBack);
  });
}

// ---------- 我的资料：存了什么、清除 ----------
const DATA_ROWS = [
  { k: "drafts", t: () => tr("AI 草稿", "AI drafts"), d: () => tr("AI 帮你写的回覆草稿，和你后来真的发了什么（用来比较）。", "Reply drafts the AI wrote, and what you really sent afterwards (for comparing)."), n: (x) => tr(`${x.count} 份`, `${x.count}`) },
  { k: "activity", t: () => tr("AI 活动纪录", "AI activity"), d: () => tr("AI 什么时候读了什么（不存信息内容）。", "When the AI read what (message content is not kept)."), n: (x) => tr(`${x.count} 笔`, `${x.count} entries`) },
  { k: "media", t: () => tr("AI 下载的文件纪录", "Files AI downloaded (list)"), d: () => tr("文件名、对话名、检查结果和小预览图。不会删掉已下载的文件。", "File name, chat name, check result and a small preview. Downloaded files are not deleted."), n: (x) => tr(`${x.count} 笔`, `${x.count} entries`) },
  { k: "index", t: () => tr("对话清单暂存", "Chat list cache"), d: () => tr("让 AI 读得快的对话清单（名字、最后一条信息）。Chrome 关掉就会自己消失；WhatsApp 开着时会重新整理一份。", "A chat list (names, last message) so the AI reads fast. It disappears when Chrome closes; WhatsApp rebuilds it while open."), n: (x) => tr(`${x.count} 个对话`, `${x.count} chats`) },
  { k: "ignored", t: () => tr("「不用回」标记", "\"No reply needed\" marks"), d: () => tr("你标了不用回的对话。", "Chats you marked as not needing a reply."), n: (x) => tr(`${x.count} 个`, `${x.count}`) },
  { k: "settings", t: () => tr("设定", "Settings"), d: () => tr("语言和自动「不用回」。清除后回到预设。", "Language and auto \"No reply needed\". Clearing resets them."), n: (x) => (x.count ? tr("有改过", "Changed") : tr("预设", "Default")) },
  { k: "pairing", t: () => tr("配对", "Pairing"), d: () => tr("和 AI 连线用的密钥。清除 = 取消配对，之后要重新配对。", "The key used to connect to your AI. Clearing it unpairs; you will need to pair again."), n: (x) => (x.paired ? tr("已配对", "Paired") : tr("没有配对", "Not paired")) }
];
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : b + " B");
async function renderData() {
  const list = $("dataList");
  let sum = null;
  try { sum = await ask({ type: "dash_data_summary" }, 8000); } catch (e) { showBanner(failText(e)); return; }
  if (!sum?.ok) return;
  list.replaceChildren(...DATA_ROWS.map((r) => {
    const x = sum[r.k] || {};
    const empty = r.k === "pairing" ? !x.paired : r.k === "settings" ? !x.count : !x.count;
    const btn = el("button", { type: "button", class: "danger-btn" }, r.k === "pairing" ? tr("取消配对", "Unpair") : tr("清除", "Clear"));
    btn.disabled = empty;
    btn.addEventListener("click", async (e) => {
      if (!e.isTrusted) return;
      const yes = await confirmBox(tr(`确定清除「${r.t()}」？`, `Clear "${r.t()}"?`),
        r.d() + "\n" + tr("清除后没办法复原。", "This cannot be undone."), r.k === "pairing" ? tr("取消配对", "Unpair") : tr("清除", "Clear"));
      if (!yes) return;
      await clearKinds([r.k], r.t());
    });
    return el("li", {}, el("div", { class: "exp-tx" }, el("h3", {}, r.t()), el("p", {}, el("span", { class: "n" }, r.n(x)), " · " + kb(x.bytes || 0) + " · " + r.d())), btn);
  }));
}
async function clearKinds(kinds, label) {
  const msg = $("dataMsg");
  try {
    const r = await ask({ type: "dash_clear_data", kinds });
    msg.textContent = r?.ok ? tr(`已清除：${label}`, `Cleared: ${label}`) : tr("清除失败", "Could not clear");
  } catch (e) { showBanner(failText(e)); }
  await renderData();
  load();
}
$("clearAllData").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  const yes = await confirmBox(tr("确定全部清除？", "Clear everything?"),
    tr("草稿、AI 活动纪录、下载文件纪录、对话清单暂存、「不用回」标记、设定和配对都会清掉，AI 会断线。已下载的文件不会被删掉。\n清除后没办法复原。", "Drafts, AI activity, the downloaded-files list, the chat list cache, \"No reply needed\" marks, settings and pairing are all cleared, and the AI is disconnected. Downloaded files are not deleted.\nThis cannot be undone."),
    tr("全部清除", "Clear everything"));
  if (!yes) return;
  await clearKinds(DATA_KINDS_ALL, tr("全部", "everything"));
});
const DATA_KINDS_ALL = DATA_ROWS.map((r) => r.k);

// ---------- 切换分区（一次只看一个；网址 #activity 可以直接打开） ----------
const TITLES = { overview: tr("概览", "Overview"), activity: tr("AI 活动纪录", "AI activity"), files: tr("AI 下载的文件", "Files AI downloaded"), drafts: tr("草稿 vs 实际", "Drafts vs actual"), export: tr("导出", "Export"), data: tr("我的资料", "My data"), settings: tr("设定", "Settings") };
function show(view, push = true) {
  if (!TITLES[view]) view = "overview";
  ROOT.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "v-" + view; });
  ROOT.querySelectorAll(".menu .item").forEach((b) => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  $("viewTitle").textContent = TITLES[view];
  ROOT.querySelector(".scroll").scrollTop = 0;
  if (push && !EMBED) history.replaceState(null, "", "#" + view);
  if (view === "data") renderData();
}
ROOT.querySelectorAll(".menu .item").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
if (!EMBED) addEventListener("hashchange", () => show(location.hash.slice(1), false));
if (!EMBED && location.hash.length > 1) show(location.hash.slice(1), false);

// ---------- 概览 ----------
function draftSummary(days) {
  const since = Date.now() - days * 86400000;
  const rows = DATA.analyzed.filter((x) => Date.parse(x.d.created_at) >= since);
  const replied = rows.filter((x) => x.a.act.length);
  const used = replied.filter((x) => x.a.outcome === "same" || x.a.outcome === "edited");
  const mins = replied.map((x) => x.a.minutes).filter((m) => m != null && m >= 0).sort((a, b) => a - b);
  const n = (k) => rows.filter((x) => x.a.outcome === k).length;
  return {
    total: rows.length, replied: replied.length, used: used.length,
    same: n("same"), edited: n("edited"), rewrote: n("rewrote"), noreply: n("noreply"), waiting: n("waiting"), dismissed: n("dismissed"),
    buttons: rows.filter((x) => x.a.used_button).length,
    useRate: replied.length ? used.length / replied.length : null,
    avgSim: replied.length ? replied.reduce((t, x) => t + x.a.sim, 0) / replied.length : null,
    medianMin: mins.length ? mins[Math.floor(mins.length / 2)] : null
  };
}

function avatar(name) {
  const ch = Array.from(String(name || "?").trim())[0] || "?";
  return el("span", { class: "avatar", "aria-hidden": "true", style: null, text: ch.toUpperCase() });
}
// 删一条草稿：按两次才删（第一次变「确定删除？」，4 秒内再按）；删了就重新载入
function removeBtn(id) {
  const label = tr("删除", "Remove");
  const b = el("button", { class: "remove-btn", title: tr("从草稿清单删掉这一条（不会动 WhatsApp）", "Delete this draft from the list (WhatsApp is not touched)") }, label);
  b.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!e.isTrusted) return;
    if (!b.dataset.armed) {
      b.dataset.armed = "1"; b.textContent = tr("确定删除？", "Remove? Click again");
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = label; } }, 4000);
      return;
    }
    const r = await ask({ type: "remove_draft", id }).catch((err) => { showBanner(failText(err)); return null; });
    if (r?.ok) load(); else if (r) showBanner(r.reason || tr("删不掉这条草稿", "Couldn't remove this draft"));
  });
  return b;
}
function openBtn(chatId) {
  return el("button", {
    class: "open-btn", title: tr("打开对话（会标已读，对方会看到蓝勾）", "Open chat (marks it as read; they will see blue ticks)"),
    onclick: async (e) => {
      e.preventDefault();
      if (!e.isTrusted) return;
      const r = await ask({ type: "open_chat", chat_id: chatId }).catch((e) => { showBanner(failText(e)); return null; });
      if (r?.ok && EMBED) closeEmbed();
    }
  }, tr("打开", "Open"));
}
const AV_COLORS = ["#00a884", "#027eb5", "#7f66ff", "#c2410c", "#b07800", "#d6336c", "#2f6fb0", "#008069"];
function colorFor(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function personRow(name, metaText, late, right) {
  const av = avatar(name);
  av.style.background = colorFor(name);
  return el("li", {}, av,
    el("span", { class: "who" }, el("span", { class: "name", text: name }), el("span", { class: "meta" + (late ? " late" : ""), text: metaText })),
    right);
}

const TIP_ICONS = {
  bad: "M12 8v5M12 16.5v.5",
  mid: "M12 8v5M12 16.5v.5",
  ok: "M7 12.5l3.2 3.2L17 9",
  info: "M12 11v6M12 7.5v.5"
};
function tipIcon(cls) {
  const svg = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  svg.append(s("path", { d: TIP_ICONS[cls] }));
  return el("span", { class: "tic " + cls }, svg);
}

function renderNewDrafts() {
  const fresh = DATA.analyzed.filter(isNewDraft).sort((x, y) => Date.parse(y.d.created_at) - Date.parse(x.d.created_at));
  $("newDraftsCard").hidden = !fresh.length;
  if (!fresh.length) return;
  $("newDraftsTitle").textContent = tr(`新的 AI 草稿（${fresh.length}）`, `New AI drafts (${fresh.length})`);
  $("newDraftList").replaceChildren(...fresh.slice(0, 5).map(({ d }) => {
    const av = avatar(d.chat_name);
    av.style.background = colorFor(d.chat_name);
    return el("li", { class: "is-new" }, el("div", { class: "row" }, av,
      el("span", { class: "who" },
        el("span", { class: "name", text: (d.chat_name || tr("(没有名称)", "(no name)")) + (d.is_group ? tr("（群）", " (group)") : "") }),
        el("span", { class: "draft-full", text: d.text })),
      el("span", { class: "right" },
        el("span", { class: "tag new", text: tr("新", "New") }),
        el("time", { text: ago(d.created_at) }),
        el("span", { class: "by", text: tr("由 ", "by ") + clientName(d.source) + tr(" 写", "") }),
        el("span", { class: "btns" }, removeBtn(d.id), openBtn(d.chat_id)))));
  }));
  $("seeDrafts").textContent = fresh.length > 5 ? tr(`看全部（还有 ${fresh.length - 5} 条）`, `See all (${fresh.length - 5} more)`) : tr("看全部草稿", "See all drafts");
}
$("seeDrafts").addEventListener("click", () => { draftFilter = "all"; draftShown = 20; renderDrafts(); show("drafts"); });

function renderOverview() {
  renderNewDrafts();
  const st = DATA.stats?.ok ? DATA.stats : null;
  // 等你回（最重要的放最大）
  $("waitBig").textContent = st ? String(st.totals.waiting_people) : "–";
  const pill = $("waitPill");
  pill.hidden = !(st && st.totals.waiting_over_24h);
  if (st) pill.textContent = tr(`${st.totals.waiting_over_24h} 人超过 24 小时`, `${st.totals.waiting_over_24h} over 24 h`);
  const wl = $("waitingList");
  wl.replaceChildren();
  const waiting = st ? st.waiting_longest : [];
  const shown = showAllWaiting ? waiting : waiting.slice(0, 3);
  for (const w of shown) {
    const right = el("span", { style: null });
    right.style.display = "flex"; right.style.gap = "10px"; right.style.alignItems = "center";
    if (w.unread) right.append(el("span", { class: "badge-n", text: String(w.unread), "aria-label": tr(`${w.unread} 条未读`, `${w.unread} unread`) }));
    right.append(el("button", { class: "ignore-btn", title: tr("先不算在「等你回」里，对方再传新信息才会回来", "Hide from \"waiting for your reply\" until they send a new message"), onclick: () => setIgnored(w, true) }, tr("不用回", "No reply needed")));
    right.append(openBtn(w.id));
    wl.append(personRow(w.name, tr(`等了 ${hoursText(w.waiting_hours)}`, `waiting ${hoursText(w.waiting_hours)}`), w.waiting_hours >= 24, right));
  }
  if (!waiting.length) wl.append(el("li", {}, el("span", { class: "meta", text: st ? tr("现在没有人在等你回。", "No one is waiting for your reply right now.") : tr("打开 WhatsApp Web 后才看得到。", "Open WhatsApp Web to see this.") })));
  if (st?.ignored_count) wl.append(el("li", { class: "ignored-note" }, tr(`另外 ${st.ignored_count} 个你标了「不用回」`, `${st.ignored_count} more marked \"No reply needed\"`), el("button", { class: "text-btn", style: null, onclick: clearIgnored }, tr("全部还原", "Restore all"))));
  const ia = $("ignoreAll");
  ia.hidden = waiting.length < 2; // 只有一个人时，旁边的「不用回」就够了
  if (!ignoreAllArmed) ia.textContent = tr("全部标为不用回", "Mark all as No reply needed");
  const more = $("moreWaiting");
  more.hidden = waiting.length <= 3;
  more.textContent = showAllWaiting ? tr("收起", "Show less") : tr(`看全部（${waiting.length}）`, `See all (${waiting.length})`);

  // 右边三个数字
  const today = st?.daily?.[st.daily.length - 1];
  const stat = (k, v, small) => el("div", {}, el("dt", { text: k }), el("dd", {}, v, small ? el("small", { text: " " + small }) : null));
  $("statList").replaceChildren(
    stat(tr("未读", "Unread"), st ? String(st.totals.unread_chats) : "–", st ? tr(`个对话 · ${st.totals.unread_messages} 条`, `chats · ${st.totals.unread_messages} messages`) : ""),
    el("div", {}, el("dt", { text: tr("今天的信息", "Today's messages") }), el("dd", {}, today
      ? [el("span", { class: "io" }, el("i", { class: "key k-in", "aria-hidden": "true" }), el("small", { text: tr("收到", "Received") }), String(today.received)),
         el("span", { class: "io" }, el("i", { class: "key k-out", "aria-hidden": "true" }), el("small", { text: tr("你发出", "You sent") }), String(today.sent))]
      : "–")),
    stat(tr("你一般多快回", "How fast you usually reply"), st ? dur(st.reply_minutes_30d.median) : "–", st?.reply_minutes_30d.count ? tr("近 30 天一对一", "1-to-1 chats, last 30 days") : "")
  );

  // 你应该知道（先给 3 条）
  const ins = [];
  if (st) {
    const w = st.waiting_longest[0];
    if (st.totals.waiting_over_24h > 0) ins.push(["bad", tr(`${st.totals.waiting_over_24h} 个人等你超过 24 小时`, `${st.totals.waiting_over_24h} people have waited over 24 hours`) + (w ? tr(`，最久是「${w.name}」（${hoursText(w.waiting_hours)}）。`, `; the longest is \"${w.name}\" (${hoursText(w.waiting_hours)}).`) : tr("。", "."))]);
    else if (st.totals.waiting_people > 0) ins.push(["mid", tr(`${st.totals.waiting_people} 个人在等你回，都还不到 24 小时。`, `${st.totals.waiting_people} people are waiting for your reply, all under 24 hours.`)]);
    else ins.push(["ok", tr("现在没有人在等你回。", "No one is waiting for your reply right now.")]);
    const h = st.hours_received_30d, tot = h.reduce((a, b) => a + b, 0);
    if (tot >= 20) {
      let best = 0;
      for (let i = 0; i < 24; i++) if (h[i] + h[(i + 1) % 24] > h[best] + h[(best + 1) % 24]) best = i;
      ins.push(["info", tr(`别人最常在 ${pad(best)}:00–${pad((best + 2) % 24)}:00 找你（占 ${pct((h[best] + h[(best + 1) % 24]) / tot)}）。这段时间留意手机。`, `People message you most between ${pad(best)}:00 and ${pad((best + 2) % 24)}:00 (${pct((h[best] + h[(best + 1) % 24]) / tot)} of messages). Keep an eye on your phone then.`)]);
    }
  }
  const d = draftSummary(90);
  if (d.replied >= 3) {
    if (d.useRate < 0.3) ins.push(["mid", tr(`AI 草稿你大多自己重写（只用了 ${pct(d.useRate)}）。可以跟 AI 说清楚你的语气，例如「短一点、口语一点」。`, `You mostly rewrite AI drafts (only ${pct(d.useRate)} used). Tell your AI the tone you want, e.g. \"shorter and more casual\".`)]);
    else ins.push(["ok", tr(`AI 草稿有 ${pct(d.useRate)} 你照用或改过再发。`, `You used ${pct(d.useRate)} of AI drafts as is or after editing.`)]);
  }
  if (d.noreply > 0) ins.push(["mid", tr(`${d.noreply} 条 AI 草稿超过一天你都没回，去「草稿 vs 实际」看看是不是漏了。`, `${d.noreply} AI drafts got no reply for over a day. Check \"Drafts vs actual\" in case you missed them.`)]);
  if (st && st.reply_minutes_30d.count >= 5) ins.push(["info", tr(`一对一对话里，你一般 ${dur(st.reply_minutes_30d.median)} 内回复。`, `In 1-to-1 chats you usually reply within ${dur(st.reply_minutes_30d.median)}.`)]);
  const last = DATA.activity.marks.last_ai_request;
  ins.push(["info", last ? tr(`AI 上次读你的 WhatsApp 是 ${ago(last)}。每一次都记在「AI 活动纪录」。`, `Your AI last read your WhatsApp ${ago(last)}. Every read is listed in \"AI activity\".`) : tr("AI 还没有读过你的 WhatsApp。", "Your AI hasn't read your WhatsApp yet.")]);
  const tipsShown = showAllTips ? ins : ins.slice(0, 3);
  const ul = $("insights");
  ul.replaceChildren(...tipsShown.map(([cls, text]) => el("li", {}, tipIcon(cls), el("span", { text }))));
  if (ins.length > 3) ul.append(el("li", {}, el("button", { class: "text-btn", onclick: () => { showAllTips = !showAllTips; renderOverview(); } }, showAllTips ? tr("收起", "Show less") : tr(`再看 ${ins.length - 3} 条`, `${ins.length - 3} more`))));

  // 图表（收起在「信息趋势」里，一次一张）
  drawChart();

  const tl = $("topList");
  tl.replaceChildren();
  if (st && st.top_chats_7d.length) for (const t of st.top_chats_7d) tl.append(personRow(t.name, tr(`收到 ${t.received} · 发出 ${t.sent}${t.is_group ? " · 群" : ""}`, `Received ${t.received} · Sent ${t.sent}${t.is_group ? " · group" : ""}`), false, null));
  else tl.append(el("li", {}, el("span", { class: "meta", text: "—" })));

  $("coverage").textContent = st
    ? tr(`统计只算 WhatsApp Web 已经载入电脑的 ${st.coverage.loaded_messages} 条信息（最早 ${fmtTime(st.coverage.oldest_loaded)}）。手机上更旧的信息不算。`, `Stats only count the ${st.coverage.loaded_messages} messages WhatsApp Web has loaded on this computer (oldest ${fmtTime(st.coverage.oldest_loaded)}). Older messages on your phone are not counted.`)
    : "";
}
$("moreWaiting").addEventListener("click", () => { showAllWaiting = !showAllWaiting; renderOverview(); });

function drawChart() {
  const st = DATA?.stats?.ok ? DATA.stats : null;
  ROOT.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.chart === chartMode)));
  $("legendDaily").hidden = chartMode !== "daily";
  if (!st) { $("chart").replaceChildren(el("div", { class: "empty", text: tr("打开 WhatsApp Web 后才有统计。", "Stats appear once WhatsApp Web is open.") })); $("chartTable").replaceChildren(); return; }
  if (chartMode === "daily") drawDaily(st.daily); else drawHours(st.hours_received_30d);
}
ROOT.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { chartMode = b.dataset.chart; drawChart(); }));
$("tableToggle").addEventListener("click", () => {
  const t = $("chartTable");
  t.hidden = !t.hidden;
  $("tableToggle").textContent = t.hidden ? tr("看表格", "Show table") : tr("收起表格", "Hide table");
});

// ---------- AI 活动纪录 ----------
// 品牌色：Claude 橘色、ChatGPT / Codex 黑色
const AI_COLOR = { Claude: "#d97757", ChatGPT: "#111111", Other: "#54656f" };
function aiSvg(f, cls) {
  const svg = s("svg", { viewBox: "-20 -20 40 40", class: cls, "aria-hidden": "true" });
  (AI_ICON[f] || AI_ICON.Other)(svg);
  return svg;
}
function aiBadge(raw) { return aiSvg(clientFamily(raw), "ai-ic"); }
function dayLabel(iso) {
  const d = new Date(iso), t = new Date();
  const k = (x) => x.toDateString();
  if (k(d) === k(t)) return tr("今天", "Today");
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (k(d) === k(y)) return tr("昨天", "Yesterday");
  return tr(`${d.getMonth() + 1} 月 ${d.getDate()} 日`, `${d.getDate()}/${d.getMonth() + 1}`);
}
function renderActivity() {
  const { log, marks } = DATA.activity;
  drawActivityChart(log);
  const lastReq = log[0];
  const servers = (DATA.connection.servers || []).filter((x) => x.state === "ready");
  const fact = (k, v, sub) => el("div", { class: "fact" }, el("div", { class: "k", text: k }), typeof v === "string" ? el("div", { class: "v", text: v }) : el("div", { class: "v" }, v), el("div", { class: "s", text: sub || "" }));
  $("actFacts").replaceChildren(
    fact(tr("上次 AI 同步", "Last AI sync"), ago(marks.last_sync), marks.last_sync ? fmtTime(marks.last_sync) : tr("AI 还没成功读过", "AI hasn't read anything yet")),
    fact(tr("上一个请求", "Last request"), lastReq ? (OP_NAMES[lastReq.op] || lastReq.op) : "—", lastReq ? `${clientName(lastReq.client)} · ${ago(lastReq.time)}` : ""),
    fact(tr("现在连着", "Connected now"), servers.length ? aiIcons(servers, "mini-ai big") : tr("没有", "None"), servers.length ? [...new Set(servers.map((x) => clientName(x.client)))].join(" · ") : tr("打开 Claude / ChatGPT 就会连上", "Open Claude / ChatGPT to connect"))
  );

  const fams = ["all", ...new Set(log.map((x) => clientFamily(x.client)))];
  if (!fams.includes(actFilter)) actFilter = "all";
  $("actFilter").replaceChildren(...fams.map((f) => el("button", {
    "aria-pressed": String(f === actFilter),
    onclick: () => { actFilter = f; actShown = 20; renderActivity(); }
  }, f === "all" ? null : aiSvg(f, "chip-ic"), f === "all" ? tr("全部", "All") : f, el("span", { class: "n", text: String(f === "all" ? log.length : log.filter((x) => clientFamily(x.client) === f).length) }))));

  const rows = log.filter((x) => actFilter === "all" || clientFamily(x.client) === actFilter);
  const feed = $("actFeed");
  feed.replaceChildren();
  if (!rows.length) feed.append(el("li", { class: "empty", text: tr("还没有纪录。在 Claude / ChatGPT 里问一次「WhatsApp 状态」就会出现。", "No records yet. Ask \"WhatsApp status\" in Claude / ChatGPT and one appears.") }));
  let lastDay = "";
  for (const x of rows.slice(0, actShown)) {
    const day = dayLabel(x.time);
    if (day !== lastDay) { feed.append(el("li", { class: "day", text: day })); lastDay = day; }
    const target = x.params?.chat || x.result?.chat || (x.params?.keyword ? tr(`搜「${x.params.keyword}」`, `search \"${x.params.keyword}\"`) : x.params?.query ? tr(`搜「${x.params.query}」`, `search \"${x.params.query}\"`) : "");
    const what = (OP_NAMES[x.op] || x.op) + (target && !target.startsWith(tr("搜", "search")) ? `：${target}` : target ? `：${target}` : "");
    const res = x.ok ? (x.result?.count != null ? tr(`${x.result.count} 项`, `${x.result.count} items`) : tr("成功", "OK")) : null;
    feed.append(el("li", { class: "ev" }, aiBadge(x.client),
      el("div", { class: "what" }, what,
        el("small", {}, clientName(x.client) + " · ", x.ok ? res : el("span", { class: "fail", text: tr("失败（", "Failed (") + (x.result?.code || "") + "）" }), ` · ${x.ms} ms`)),
      el("time", { datetime: x.time, text: `${pad(new Date(x.time).getHours())}:${pad(new Date(x.time).getMinutes())}` })));
  }
  const more = $("moreAct");
  more.hidden = rows.length <= actShown;
  more.textContent = tr(`显示更多（还有 ${rows.length - actShown} 条）`, `Show more (${rows.length - actShown} left)`);

  const week = log.filter((x) => Date.now() - Date.parse(x.time) < 7 * 86400000);
  $("actAbout").textContent = tr(`共 ${log.length} 条纪录，近 7 天 ${week.length} 次（${byFamily(week)}）。`, `${log.length} records in total, ${week.length} in the last 7 days (${byFamily(week)}).`) +
    tr(`只记：时间、哪个 AI、做了什么、对话名称或搜寻字、数量、用时；不记信息内容，也不记草稿内容。只存在这台电脑，保留 90 天、最多 1000 条。`, ` Records only the time, which AI, what it did, the chat name or search word, the count and how long it took. No message or draft content. Stays on this computer for 90 days, up to 1000 records.`) +
    tr(`上次打开仪表板：${ago(marks.last_dashboard)}；上次打开插件弹窗：${ago(marks.last_popup)}。`, ` Dashboard last opened: ${ago(marks.last_dashboard)}; extension popup last opened: ${ago(marks.last_popup)}.`);
}
function drawActivityChart(log) {
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ d, n: 0, fam: {} }); }
  for (const x of log) {
    const t = new Date(x.time); t.setHours(0, 0, 0, 0);
    const row = days.find((r) => r.d.getTime() === t.getTime());
    if (row) { row.n++; const f = clientFamily(x.client); row.fam[f] = (row.fam[f] || 0) + 1; }
  }
  const total = days.reduce((a, r) => a + r.n, 0);
  $("actTotal").textContent = tr(`共 ${total} 次`, `${total} total`);
  // 图例：只列出现过的 AI
  const famsSeen = [...new Set(days.flatMap((r) => Object.keys(r.fam)))];
  $("actLegend").replaceChildren(...famsSeen.map((f) => el("span", { class: "leg" }, el("i", { style: null }), f)));
  $("actLegend").querySelectorAll("i").forEach((i, k) => { i.style.background = AI_COLOR[famsSeen[k]] || AI_COLOR.Other; });
  const W = 560, H = 150, L = 30, R = 8, T = 8, B = 24;
  const max = niceMax(Math.max(1, ...days.map((r) => r.n)));
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": tr("近 14 天每天 AI 请求次数", "AI requests per day, last 14 days") });
  const iw = W - L - R, ih = H - T - B;
  for (let i = 0; i <= 2; i++) {
    const y = T + ih - (ih * i) / 2;
    svg.append(s("line", { x1: L, x2: W - R, y1: y, y2: y, class: "gridline" }));
    const t = s("text", { x: L - 6, y: y + 4, "text-anchor": "end", class: "axis" }); t.textContent = String(Math.round((max * i) / 2)); svg.append(t);
  }
  const gw = iw / days.length, bw = Math.min(22, gw - 6);
  days.forEach((r, i) => {
    const gx = L + i * gw, bh = (ih * r.n) / max;
    const hl = s("rect", { x: gx + 1, y: T, width: gw - 2, height: ih, class: "hl", fill: "transparent" });
    const hit = s("rect", { x: gx, y: T, width: gw, height: ih + B, class: "hit", fill: "transparent" });
    svg.append(hl);
    // 每个 AI 一段，叠起来（Claude 橘色、ChatGPT 黑色）；最上面那段圆角
    const parts = Object.entries(r.fam).sort((a, b) => (a[0] === "Claude" ? -1 : 1));
    let y = T + ih;
    parts.forEach(([f, n], k) => {
      const h = (ih * n) / max, top = k === parts.length - 1;
      const x = gx + (gw - bw) / 2;
      svg.append(s("path", { d: top ? barPath(x, y - h, bw, h) : `M${x},${y}V${y - h}H${x + bw}V${y}Z`, fill: AI_COLOR[f] || AI_COLOR.Other }));
      y -= h + (top ? 0 : 1.5);
    });
    if (i % 2 === 1) { const t = s("text", { x: gx + gw / 2, y: H - 7, "text-anchor": "middle", class: "axis" }); t.textContent = `${r.d.getMonth() + 1}/${r.d.getDate()}`; svg.append(t); }
    svg.append(hit);
    const detail = Object.entries(r.fam).map(([k, v]) => `${k} ${v}`).join(" · ");
    hit.addEventListener("mousemove", (e) => { hl.classList.add("on"); showTip(e, [el("b", { text: tr(`${r.d.getMonth() + 1} 月 ${r.d.getDate()} 日`, `${r.d.getDate()}/${r.d.getMonth() + 1}`) }), el("br"), tr(`${r.n} 次`, `${r.n} requests`) + (detail ? `（${detail}）` : "")]); });
    hit.addEventListener("mouseleave", () => { hl.classList.remove("on"); hideTip(); });
  });
  $("actChart").replaceChildren(svg);
}
function byFamily(list) {
  const m = {};
  for (const x of list) { const f = clientFamily(x.client); m[f] = (m[f] || 0) + 1; }
  const parts = Object.entries(m).map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join("、") : tr("没有", "None");
}
$("moreAct").addEventListener("click", () => { actShown += 30; renderActivity(); });
$("clearAct").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  if (!(await confirmBox(tr("确定清空 AI 活动纪录？", "Clear AI activity?"), tr("清除后没办法复原。", "This cannot be undone.")))) return;
  await ask({ type: "dash_clear_activity" }).catch((e) => showBanner(failText(e)));
  load();
});

// ---------- AI 下载的文件：预览 + 安全检查 ----------
// 文件名、对话名都是对方给的，一律 textContent。缩图是插件自己重新画的 JPEG，画在 canvas 上（不用网址、不用 innerHTML）。
// 永远没有「打开」：只有「在文件夹中显示」。
let fileFilter = "all";
const KIND_IC = { image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4", av: "M5 5h10v14H5z M15 10l5-3v10l-5-3", pdf: "M6 3h9l4 4v14H6z M15 3v4h4", archive: "M6 3h12v18H6z M11 3v2h2v2h-2v2h2v2h-2", other: "M6 3h9l4 4v14H6z M15 3v4h4" };
function kindOf(x) {
  if (/^(jpeg|png|gif|webp|bmp|avif|heic|svg)$/.test(x.real) || /^image\//.test(x.mime || "")) return "image";
  if (/^(video|audio)$/.test(x.real) || /^(video|audio)\//.test(x.mime || "")) return "av";
  if (x.real === "pdf") return "pdf";
  if (/^(zip|rar|7z|gz)$/.test(x.real)) return "archive";
  return "other";
}
const REAL_LABEL = { exe: ["程序", "Program"], script: ["脚本", "Script"], html: ["网页", "Web page"], svg: ["SVG 图", "SVG image"], jpeg: ["JPEG 图片", "JPEG image"], png: ["PNG 图片", "PNG image"], gif: ["GIF 图片", "GIF image"], webp: ["WebP 图片", "WebP image"], bmp: ["BMP 图片", "BMP image"], avif: ["AVIF 图片", "AVIF image"], heic: ["HEIC 图片", "HEIC image"], video: ["影片", "Video"], audio: ["声音", "Audio"], pdf: ["PDF", "PDF"], office: ["Office 文件", "Office file"], ole: ["旧版 Office", "Old Office file"], rtf: ["RTF", "RTF"], zip: ["ZIP 压缩档", "ZIP archive"], rar: ["RAR 压缩档", "RAR archive"], "7z": ["7z 压缩档", "7z archive"], gz: ["GZ 压缩档", "GZ archive"], xml: ["XML", "XML"], text: ["文字", "Text"], unknown: ["认不出", "Unknown"] };
const realLabel = (t) => { const l = REAL_LABEL[t] || REAL_LABEL.unknown; return tr(l[0], l[1]); };
function sizeText(n) {
  if (!Number.isFinite(n)) return "";
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
function thumbCanvas(b64) {
  const cv = el("canvas", { class: "thumb-cv", "aria-hidden": "true" });
  if (typeof b64 !== "string" || !b64.startsWith("/9j/") || b64.length > 200000) return null;
  try {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" });
    createImageBitmap(blob).then((bmp) => {
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext("2d").drawImage(bmp, 0, 0); bmp.close();
    }, () => cv.remove());
  } catch (_) { return null; }
  return cv;
}
function fileState(x) {
  if (x.status === "blocked") return "blocked";
  if (x.status === "chrome_asks") return "asks";
  if (x.warnings?.length) return "warn";
  return "ok";
}
function renderFiles() {
  const list = Array.isArray(DATA.media) ? DATA.media : [];
  const counts = { all: list.length, ok: 0, warn: 0, blocked: 0 };
  for (const x of list) { const st = fileState(x); counts[st === "asks" ? "warn" : st]++; }
  const nb = list.filter((x) => fileState(x) !== "ok" && Date.now() - Date.parse(x.time) < 86400000).length, mb = $("mb-files");
  mb.hidden = !nb; mb.textContent = String(nb || "");
  const names = { all: tr("全部", "All"), ok: tr("安全检查通过", "Passed"), warn: tr("要小心", "Be careful"), blocked: tr("没存", "Not saved") };
  if (!counts[fileFilter] && fileFilter !== "all") fileFilter = "all";
  $("fileFilter").replaceChildren(...Object.keys(names).filter((k) => k === "all" || counts[k]).map((k) => el("button", {
    "aria-pressed": String(k === fileFilter), onclick: () => { fileFilter = k; renderFiles(); }
  }, names[k], el("span", { class: "n", text: String(counts[k]) }))));
  const rows = list.filter((x) => { const st = fileState(x); return fileFilter === "all" || st === fileFilter || (fileFilter === "warn" && st === "asks"); });
  const grid = $("fileGrid");
  grid.replaceChildren();
  if (!rows.length) grid.append(el("li", { class: "empty", text: tr("还没有。在 Claude / ChatGPT 里说「下载某某传给我的照片」，就会出现在这里。", "Nothing yet. Ask Claude / ChatGPT to download a photo or file someone sent you, and it shows up here.") }));
  for (const x of rows) {
    const st = fileState(x), k = kindOf(x);
    const pic = x.thumb && st !== "blocked" ? thumbCanvas(x.thumb) : null;
    const ic = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "kind-ic" });
    ic.append(s("path", { d: KIND_IC[k] }));
    const tag = st === "blocked" ? el("span", { class: "ftag bad", text: tr("没存：有危险", "Not saved: unsafe") })
      : st === "asks" ? el("span", { class: "ftag warn", text: tr("Chrome 在问你", "Chrome is asking you") })
      : st === "warn" ? el("span", { class: "ftag warn", text: tr("要小心", "Be careful") })
      : el("span", { class: "ftag ok", text: tr("检查通过", "Check passed") });
    const why = [];
    if (x.block) why.push(el("li", { class: "bad", text: tr(x.block.zh, x.block.en) }));
    for (const w of x.warnings || []) why.push(el("li", { text: tr(w.zh, w.en) }));
    if (st === "asks") why.push(el("li", { text: tr("Chrome 觉得这种文件可能有害，要你在 Chrome 的下载清单里决定。不认识对方就选「删除」。", "Chrome thinks this kind of file may be harmful and is asking you in its downloads list. If you don't know the sender, choose Delete.") }));
    const named = x.real && !["unknown"].includes(x.real) ? realLabel(x.real) : (x.mime || "");
    const actions = [];
    if (x.status === "saved" && x.exists) actions.push(el("button", { class: "text-btn", onclick: async (e) => {
      if (!e.isTrusted) return;
      const r = await ask({ type: "dash_show_file", download_id: x.download_id }).catch(() => null);
      if (!r?.ok) { e.target.textContent = tr("找不到文件（被删了或移走了）", "File not found (deleted or moved)"); e.target.disabled = true; }
    } }, tr("在文件夹中显示", "Show in folder")));
    else if (x.status === "saved") actions.push(el("span", { class: "fine", text: tr("文件已被删除或移走", "File was deleted or moved") }));
    grid.append(el("li", { class: "file " + st },
      el("div", { class: "thumb" + (pic ? "" : " none") }, pic || ic, k === "av" && pic ? el("span", { class: "play", "aria-hidden": "true", text: "▶" }) : null),
      el("div", { class: "fbody" },
        el("div", { class: "fname", title: x.file_name || "", text: x.file_name || tr("（没有名字）", "(no name)") }),
        el("div", { class: "fmeta", text: [x.chat, fmtTime(x.time), sizeText(x.size_bytes), named].filter(Boolean).join(" · ") }),
        tag,
        why.length ? el("ul", { class: "fwhy" }, why) : null,
        actions.length ? el("div", { class: "facts-row" }, actions) : null)));
  }
  $("filesAbout").textContent = tr(`共 ${list.length} 笔，只存在这台电脑，最多 40 笔、60 天。存的是文件名、对话名、检查结果和重新画过的小预览图；原文件在「下载 / AI for Business Chat Assistant」。清空这份纪录不会删掉已下载的文件。`, `${list.length} in total. Kept only on this computer, up to 40 for 60 days: the file name, chat name, check result and a small redrawn preview. The files themselves are in Downloads / AI for Business Chat Assistant. Clearing this list does not delete them.`);
}
$("unpairBtn").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  if (!(await confirmBox(tr("确定取消配对？", "Unpair?"), tr("所有 AI 会断线。之后要用，要在 AI 里问「WhatsApp 状态」拿新的配对码重新配对。", "All AI apps are disconnected. To use it again, ask your AI \"WhatsApp status\" for a new pairing code."), tr("取消配对", "Unpair")))) return;
  await ask({ type: "unpair" }).catch((err) => showBanner(failText(err)));
  load();
});
$("clearFiles").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  if (!(await confirmBox(tr("确定清空下载文件纪录？", "Clear the downloaded-files list?"), tr("已下载的文件不会被删掉。清除后没办法复原。", "Downloaded files are not deleted. This cannot be undone.")))) return;
  await ask({ type: "dash_clear_media" }).catch((err) => showBanner(failText(err)));
  load();
});

// ---------- 草稿 vs 实际 ----------
const STACK = ["same", "edited", "rewrote", "noreply", "waiting", "dismissed"];
function renderDrafts() {
  const ds = draftSummary(90);
  $("useRate").textContent = pct(ds.useRate);
  const mini = (k, v) => el("div", {}, el("dt", { text: k }), el("dd", { text: v }));
  $("draftMini").replaceChildren(
    mini(tr("草稿", "Drafts"), String(ds.total)),
    mini(tr("相似度（平均）", "Similarity (avg)"), pct(ds.avgSim)),
    mini(tr("草稿到回复", "Draft to reply"), dur(ds.medianMin))
  );
  const stack = $("stack");
  stack.replaceChildren();
  const legend = $("stackLegend");
  legend.replaceChildren();
  const parts = STACK.map((k) => [k, ds[k]]).filter(([, n]) => n > 0);
  stack.setAttribute("aria-label", parts.map(([k, n]) => `${OUTCOMES[k].label} ${n}`).join("，") || tr("还没有草稿", "No drafts yet"));
  for (const [k, n] of parts) {
    const seg = el("span", { class: "o-" + k, title: `${OUTCOMES[k].label}：${n}` });
    seg.style.flex = String(n);
    stack.append(seg);
  }
  for (const k of STACK) {
    if (!ds[k] && (k === "waiting" || k === "dismissed")) continue;
    legend.append(el("li", {}, el("i", { class: "o-" + k }), OUTCOMES[k].label, el("b", { text: String(ds[k]) })));
  }

  const keys = ["all", ...STACK];
  const count = (k) => (k === "all" ? DATA.analyzed.length : DATA.analyzed.filter((x) => x.a.outcome === k).length);
  $("draftFilter").replaceChildren(...keys.filter((k) => k === "all" || count(k)).map((k) => el("button", {
    "aria-pressed": String(k === draftFilter), title: OUTCOMES[k]?.hint || "",
    onclick: () => { draftFilter = k; draftShown = 20; renderDrafts(); }
  }, k === "all" ? tr("全部", "All") : OUTCOMES[k].label, el("span", { class: "n", text: String(count(k)) }))));

  const rows = DATA.analyzed.filter((x) => draftFilter === "all" || x.a.outcome === draftFilter);
  const list = $("draftList");
  list.replaceChildren();
  if (!rows.length) list.append(el("li", { class: "empty", text: tr("还没有 AI 草稿。在 Claude / ChatGPT 里说「帮我起草回复给 XX，存成草稿」。", "No AI drafts yet. Ask Claude / ChatGPT \"draft a reply to … and save it as a draft\".") }));
  for (const { d, a } of rows.slice(0, draftShown)) {
    const o = OUTCOMES[a.outcome];
    const av = avatar(d.chat_name);
    av.style.background = colorFor(d.chat_name);
    const summary = el("summary", {}, av,
      el("span", { class: "who" }, el("span", { class: "name", text: (d.chat_name || tr("(没有名称)", "(no name)")) + (d.is_group ? tr("（群）", " (group)") : "") }), el("span", { class: "preview", text: d.text.split("\n")[0] })),
      el("span", { class: "right" }, el("time", { text: fmtTime(d.created_at) }), isNewDraft({ d, a }) ? el("span", { class: "tag new", text: tr("新", "New") }) : null, el("span", { class: "tag plain", title: o.hint }, el("i", { class: "o-" + a.outcome }), o.label)));
    const chat = el("div", { class: "chat" },
      el("div", { class: "note", text: tr(`${clientName(d.source)} 在 ${fmtTime(d.created_at)} 写了草稿`, `${clientName(d.source)} wrote a draft at ${fmtTime(d.created_at)}`) + (d.inserted_at ? tr("，你按了「填入」", "; you pressed \"Fill in\"") : d.copied_at ? tr("，你按了「复制」", "; you pressed \"Copy\"") : "") }),
      el("div", { class: "bubble draft" }, el("span", { class: "lab", text: tr("AI 草稿（没有发送）", "AI draft (not sent)") }), d.text, el("time", { text: fmtTime(d.created_at) })),
      a.act.length
        ? a.act.map((m) => el("div", { class: "bubble mine" }, m.text || tr("[非文字]", "[not text]"), el("time", { text: fmtTime(m.time) })))
        : el("div", { class: "note", text: o.hint }));
    const foot = el("div", { class: "chat-foot" },
      el("span", { text: a.sim != null ? tr(`相似度 ${pct(a.sim)} · 草稿后 ${dur(a.minutes)} 发出第一条`, `Similarity ${pct(a.sim)} · first message ${dur(a.minutes)} after the draft`) : tr("还没有可比对的信息", "Nothing to compare yet") }),
      el("span", { class: "btns" }, removeBtn(d.id), openBtn(d.chat_id)));
    list.append(el("li", { class: isNewDraft({ d, a }) ? "is-new" : null }, el("details", {}, summary, chat, foot)));
  }
  const more = $("moreDrafts");
  more.hidden = rows.length <= draftShown;
  more.textContent = tr(`显示更多（还有 ${rows.length - draftShown} 条）`, `Show more (${rows.length - draftShown} left)`);
}
$("moreDrafts").addEventListener("click", () => { draftShown += 20; renderDrafts(); });

// ---------- 图表（手写 SVG；有提示框和表格） ----------
const tip = $("tip");
function showTip(e, html) {
  tip.replaceChildren(...html);
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.hidden = true; };

// 顶端圆角、底端贴着基线的柱子
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceMax(v) {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return v;
}

function drawDaily(days) {
  const W = 560, H = 220, L = 34, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...days.flatMap((d) => [d.received, d.sent])));
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": tr("近 14 天每天收到和发出的信息数", "Messages received and sent per day, last 14 days") });
  const iw = W - L - R, ih = H - T - B;
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - (ih * i) / 4;
    svg.append(s("line", { x1: L, x2: W - R, y1: y, y2: y, class: "gridline" }));
    const t = s("text", { x: L - 6, y: y + 4, "text-anchor": "end", class: "axis" }); t.textContent = String(Math.round((max * i) / 4)); svg.append(t);
  }
  const gw = iw / days.length, bw = Math.max(3, Math.min(14, (gw - 8) / 2));
  days.forEach((d, i) => {
    const gx = L + i * gw;
    const cx = gx + gw / 2;
    const hl = s("rect", { x: gx + 1, y: T, width: gw - 2, height: ih, class: "hl", fill: "transparent" });
    const hit = s("rect", { x: gx, y: T, width: gw, height: ih + B, class: "hit" });
    const hIn = (ih * d.received) / max, hOut = (ih * d.sent) / max;
    svg.append(hl);
    svg.append(s("path", { d: barPath(cx - bw - 1, T + ih - hIn, bw, hIn), class: "bar-in" }));
    svg.append(s("path", { d: barPath(cx + 1, T + ih - hOut, bw, hOut), class: "bar-out" }));
    if (i % 2 === (days.length - 1) % 2) {
      const t = s("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "axis" });
      t.textContent = d.date.slice(5).replace("-", "/"); svg.append(t);
    }
    svg.append(hit);
    hit.addEventListener("mousemove", (e) => { hl.classList.add("on"); showTip(e, [el("b", { text: d.date }), el("br"), tr(`收到 ${d.received} · 我发出 ${d.sent}`, `Received ${d.received} · You sent ${d.sent}`)]); });
    hit.addEventListener("mouseleave", () => { hl.classList.remove("on"); hideTip(); });
  });
  $("chart").replaceChildren(svg);
  $("chartTable").replaceChildren(table([tr("日期", "Date"), tr("收到", "Received"), tr("我发出", "You sent")], days.map((d) => [d.date, d.received, d.sent]), [false, true, true]));
}

function drawHours(h) {
  const W = 560, H = 220, L = 34, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...h));
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": tr("近 30 天每个时段收到的信息数", "Messages received per hour of day, last 30 days") });
  const iw = W - L - R, ih = H - T - B;
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - (ih * i) / 4;
    svg.append(s("line", { x1: L, x2: W - R, y1: y, y2: y, class: "gridline" }));
    const t = s("text", { x: L - 6, y: y + 4, "text-anchor": "end", class: "axis" }); t.textContent = String(Math.round((max * i) / 4)); svg.append(t);
  }
  const gw = iw / 24, bw = Math.max(4, gw - 4);
  let peak = 0;
  h.forEach((v, i) => { if (v > h[peak]) peak = i; });
  h.forEach((v, i) => {
    const gx = L + i * gw, bh = (ih * v) / max;
    const hl = s("rect", { x: gx + 1, y: T, width: gw - 2, height: ih, class: "hl", fill: "transparent" });
    const hit = s("rect", { x: gx, y: T, width: gw, height: ih + B, class: "hit" });
    svg.append(hl, s("path", { d: barPath(gx + 2, T + ih - bh, bw, bh), class: "bar-seq" }));
    if (i % 3 === 0) { const t = s("text", { x: gx + gw / 2, y: H - 8, "text-anchor": "middle", class: "axis" }); t.textContent = pad(i); svg.append(t); }
    if (i === peak && v > 0) { const t = s("text", { x: gx + gw / 2, y: T + ih - bh - 5, "text-anchor": "middle", class: "lbl" }); t.textContent = String(v); svg.append(t); }
    svg.append(hit);
    hit.addEventListener("mousemove", (e) => { hl.classList.add("on"); showTip(e, [el("b", { text: `${pad(i)}:00–${pad(i)}:59` }), el("br"), tr(`收到 ${v} 条`, `Received ${v}`)]); });
    hit.addEventListener("mouseleave", () => { hl.classList.remove("on"); hideTip(); });
  });
  $("chart").replaceChildren(svg);
  $("chartTable").replaceChildren(table([tr("时段", "Hour"), tr("收到", "Received")], h.map((v, i) => [`${pad(i)}:00`, v]), [false, true]));
}

function table(head, rows, numeric = []) {
  return el("table", { class: "tbl" },
    el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { class: numeric[i] ? "num" : null, scope: "col", text: h })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c, i) => el("td", { class: numeric[i] ? "num" : null, text: String(c) }))))));
}



// ---------- 安全检查（现在这台电脑上看得到的事实） ----------
function renderSecurity() {
  const csp = chrome.runtime.getManifest().content_security_policy?.extension_pages || "";
  const connect = (csp.match(/connect-src ([^;]+)/) || [])[1] || "";
  const onlyLocal = connect.trim().split(/\s+/).every((x) => x.startsWith("ws://127.0.0.1"));
  const perms = chrome.runtime.getManifest().permissions || [];
  const hosts = chrome.runtime.getManifest().host_permissions || [];
  const kb = DATA.storage_bytes != null ? Math.max(1, Math.round(DATA.storage_bytes / 1024)) : null;
  const paired = DATA.connection.ready > 0;
  const items = [
    [onlyLocal, tr("插件只能连这台电脑", "The extension can only connect to this computer"), tr(`Chrome 规定插件只能连 ${connect.trim() || "（未设定）"}，连不到任何外面的网站或服务器。只有一个例外：你叫 AI 下载某个文件时，会在 WhatsApp 分页里从 WhatsApp 自己的媒体服务器拿那一个文件。`, `Chrome only lets the extension connect to ${connect.trim() || "(not set)"}; it can't reach any outside website or server. One exception: when you ask AI to download a file, the WhatsApp tab gets that one file from WhatsApp's own media server.`)],
    [hosts.length === 1 && hosts[0].startsWith("https://web.whatsapp.com"), tr("只碰 WhatsApp Web", "Only touches WhatsApp Web"), tr(`网站权限只有 ${hosts.join("、")}；其他权限：${perms.join("、")}。`, `Site access: ${hosts.join(", ")} only. Other permissions: ${perms.join(", ")}.`)],
    [true, tr("没有发信息功能", "No sending feature"), tr("程序里没有发送、按 Enter、删除、标已读的代码。回复永远由你自己按发送。", "There is no code to send, press Enter, delete or mark as read. You always press send yourself.")],
    [paired, paired ? tr("已配对，有密钥保护", "Paired, protected by a secret key") : tr("还没配对", "Not paired yet"), tr("本机程序只接受这个插件（固定 ID）+ 配对过的密钥，别的网页或程序连不进来。", "The local server only accepts this extension (fixed ID) with the paired key; other web pages or programs can't connect.")],
    [true, tr("资料只存在这台电脑", "Data stays on this computer"), tr(`草稿、活动纪录都在 Chrome 插件储存里${kb ? `，现在约 ${kb} KB` : ""}，保留 90 天。AI 下载的文件在「下载 / AI for Business Chat Assistant」文件夹。`, `Drafts and AI activity are kept in the extension's storage${kb ? ` (about ${kb} KB now)` : ""} for 90 days. Files AI downloaded are in your Downloads / AI for Business Chat Assistant folder.`)],
    [true, tr("没有统计、广告、自动更新", "No analytics, ads or auto-updates"), tr("不送使用数据，不检查更新，不从网络下载程序。", "No usage data is sent, no update checks, no code downloaded from the internet.")]
  ];
  $("checks").replaceChildren(...items.map(([ok, title, sub]) => el("li", {}, icon(ok), el("div", {}, el("strong", { text: title }), el("small", { text: sub })))));
}
function icon(ok) {
  const svg = s("svg", { viewBox: "0 0 24 24", class: "ic", "aria-hidden": "true" });
  if (ok) {
    svg.append(s("path", { d: "M12 2l8.5 3.2V12c0 5.3-3.7 8.6-8.5 10-4.8-1.4-8.5-4.7-8.5-10V5.2z", fill: "#25d366" }));
    svg.append(s("path", { d: "M8.3 12.2l2.6 2.6 5-5.2", fill: "none", stroke: "#fff", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  } else {
    svg.append(s("circle", { cx: "12", cy: "12", r: "10", fill: "#f5c83b" }));
    svg.append(s("path", { d: "M12 7v6M12 16.5v.5", stroke: "#221b10", "stroke-width": "2.4", "stroke-linecap": "round" }));
  }
  return svg;
}

// ---------- 导出 ----------
function inRange(list, key) {
  const days = RANGE_DAYS;
  const since = Date.now() - days * 86400000;
  return list.filter((x) => Date.parse(key(x)) >= since);
}
function renderExportCount() {
  const n = inRange(DATA.analyzed, (x) => x.d.created_at).length;
  const m = inRange(DATA.activity.log, (x) => x.time).length;
  $("exportCount").textContent = tr(`这个范围：${n} 条草稿 · ${m} 条 AI 活动纪录`, `In this range: ${n} drafts · ${m} AI activity records`);
}
// 设定 → 语言：English（默认）/ 中文 / 跟浏览器（存在 chrome.storage.local 的 ui_lang）
function renderLangSeg() {
  const pref = typeof getUiLangPref === "function" ? getUiLangPref() : "en";
  ROOT.querySelectorAll("#langSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === pref)));
  $("subSettings").textContent = tr("语言：", "Language: ") + ({ auto: tr("跟浏览器", "Same as browser"), en: "English", zh: "中文" }[pref] || "");
}
renderLangSeg();
ROOT.querySelectorAll("#langSeg button").forEach((b) => b.addEventListener("click", async () => {
  try { await chrome.storage.local.set({ ui_lang: b.dataset.lang }); } catch (_) {}
  renderLangSeg();
  // 换语言：WhatsApp 里的仪表板会自己重新打开（sidebar.js）；独立分页就重新载入
  if (!EMBED) location.reload();
}));

// 设定 → 自动「不用回」：超过 X 天（0 = 关）
async function renderAutoSeg() {
  let d = 0;
  try { d = Number((await chrome.storage.local.get("auto_ignore_days")).auto_ignore_days) || 0; } catch (_) {}
  ROOT.querySelectorAll("#autoSeg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === d)));
}
renderAutoSeg();
ROOT.querySelectorAll("#autoSeg button").forEach((b) => b.addEventListener("click", async () => {
  try { await chrome.storage.local.set({ auto_ignore_days: Number(b.dataset.days) || 0 }); } catch (_) {}
  renderAutoSeg();
  setTimeout(load, 1500); // 索引更新后重新读
}));

// 时间范围：三个按钮（不用下拉选单，样式在 WhatsApp 页面里比较稳）
let RANGE_DAYS = 30;
ROOT.querySelectorAll("#range button").forEach((b) => b.addEventListener("click", () => {
  RANGE_DAYS = Number(b.dataset.days) || 30;
  ROOT.querySelectorAll("#range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (DATA) renderExportCount();
}));

const csvCell = (v) => {
  const t = v == null ? "" : String(v);
  // 防止试算表把信息当公式：开头（略过空白和看不见的字元）是 = + - @ | 或 Tab / 换行，前面加 '
  const lead = t.replace(/^[\s\u0000-\u001f\u00a0\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/, "");
  const safe = /^[=+\-@|\t\r\n]/.test(lead) || /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
  // 每一格都加引号：不管试算表用逗号、分号还是 Tab 分隔，内容都不会被拆成新的一格
  return `"${safe.replace(/"/g, '""')}"`;
};
const toCsv = (head, rows) => "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name });
  (ROOT.body || ROOT).append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  $("exportMsg").textContent = tr(`已存成 ${name}（在你的「下载」文件夹）。`, `Saved ${name} (in your Downloads folder).`);
}

ROOT.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", (e) => {
  if (!e.isTrusted || !DATA) return;
  const kind = b.dataset.export;
  const rows = inRange(DATA.analyzed, (x) => x.d.created_at);
  if (kind === "drafts") {
    download(`AIforBusiness-drafts-${stamp()}.csv`, toCsv(
      ["draft_id", "chat_name", "chat_id", "is_group", "created_at", "ai_source", "status", "inserted_at", "copied_at", "dismissed_at", "draft_text", "ai_note"],
      rows.map(({ d }) => [d.id, d.chat_name, d.chat_id, d.is_group, d.created_at, d.source, d.status, d.inserted_at, d.copied_at, d.dismissed_at, d.text, d.note])
    ), "text/csv;charset=utf-8");
  } else if (kind === "pairs") {
    download(`AIforBusiness-draft-vs-actual-${stamp()}.csv`, toCsv(
      ["draft_id", "chat_name", "is_group", "created_at", "ai_source", "draft_text", "outcome", "similarity", "used_fill_or_copy",
        "actual_message_count", "first_reply_at", "minutes_to_first_reply", "reply_round_closed", "actual_messages"],
      rows.map(({ d, a }) => [d.id, d.chat_name, d.is_group, d.created_at, d.source, d.text, OUTCOMES[a.outcome].label,
        a.sim == null ? "" : Math.round(a.sim * 100) / 100, a.used_button, a.act.length, a.act[0]?.time || "",
        a.minutes == null ? "" : Math.round(a.minutes), !!d.reply_closed,
        a.act.map((m) => `[${m.time}] ${m.text || ""}`).join("\n")])
    ), "text/csv;charset=utf-8");
  } else if (kind === "timeline") {
    exportTimeline(rows);
  } else if (kind === "json") {
    download(`AIforBusiness-research-${stamp()}.json`, JSON.stringify({
      exported_at: new Date().toISOString(),
      extension_version: DATA.version,
      range_days: RANGE_DAYS,
      notes: {
        actual_messages: tr("草稿建立之后，你在同一个对话发的「一轮」信息：到对方再说话、或下一条草稿、或第一句之后 6 小时为止，最多 20 条", "Messages you sent in the same chat after the draft, as one round: until the other person speaks, the next draft, or 6 hours after your first message; up to 20 messages"),
        similarity: tr("字元两两一组（bigram）Dice 相似度，0 到 1；忽略空白和标点", "Character bigram Dice similarity, 0 to 1; spaces and punctuation ignored"),
        outcome: tr("same ≥ 0.8；edited 0.4–0.8；rewrote < 0.4；noreply = 超过 24 小时没发；waiting = 还不到 24 小时", "same ≥ 0.8; edited 0.4–0.8; rewrote < 0.4; noreply = nothing sent for over 24 hours; waiting = under 24 hours")
      },
      drafts: rows.map(({ d, a }) => ({ ...d, analysis: { outcome: a.outcome, similarity: a.sim, minutes_to_first_reply: a.minutes, actual_message_count: a.act.length } }))
    }, null, 2), "application/json");
  } else if (kind === "activity") {
    const log = inRange(DATA.activity.log, (x) => x.time);
    download(`AIforBusiness-ai-activity-${stamp()}.csv`, toCsv(
      ["time", "ai_client", "operation", "target", "ok", "result_count", "error_code", "ms", "port"],
      log.map((x) => [x.time, clientName(x.client), x.op, x.params?.chat || x.params?.keyword || x.params?.query || "", x.ok, x.result?.count ?? "", x.result?.code || "", x.ms, x.port])
    ), "text/csv;charset=utf-8");
  }
}));

// 对话时间线：有草稿的对话，信息按时间排序。只记事实（什么时候、谁、写了什么），不判断哪条算「回复草稿」。
// - 你发出的每一条都在（不管是不是用草稿），每条都有时间
// - 勾「包含 AI 草稿」→ 草稿放在它建立的时间点（原本打算填进输入框的位置）
// - WhatsApp 读不到的旧信息，用草稿当时记下的「实际回复」补上
async function exportTimeline(rows) {
  const withDrafts = $("optDrafts").checked;
  const withTheirs = $("optTheirs").checked;
  const days = RANGE_DAYS;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  if (!rows.length) { $("exportMsg").textContent = tr("这个范围没有草稿，所以没有对话可以导出。", "No drafts in this range, so there are no chats to export."); return; }
  $("exportMsg").textContent = tr("正在从 WhatsApp 读这些对话…", "Reading these chats from WhatsApp…");
  const chatIds = [...new Set(rows.map((x) => x.d.chat_id))];
  const r = await ask({ type: "dash_timeline", chat_ids: chatIds, since }, 60000).catch(() => null);
  const live = r?.ok ? r.messages : [];
  const names = new Map(rows.map((x) => [x.d.chat_id, x.d.chat_name]));
  const items = [];
  const seen = new Set();
  const key = (chat, time, text, id) => id ? "id|" + id : chat + "|" + time + "|" + norm(text).slice(0, 60);
  for (const m of live) {
    if (!m.from_me && !withTheirs) continue;
    const k = key(m.chat_id, m.time, m.text, m.id);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ time: m.time, chat_id: m.chat_id, chat_name: names.get(m.chat_id) || m.chat_name, kind: m.from_me ? "sent" : "received",
      sender: m.from_me ? tr("我", "Me") : m.sender || "", msg_type: m.type || "chat", text: m.text || "", message_id: m.id || "" });
  }
  // 补：草稿记下的实际回复（WhatsApp 现在读不到时）
  for (const { d } of rows) {
    for (const m of actualOf(d)) {
      if (!m.time || m.time < since) continue;
      const k = key(d.chat_id, m.time, m.text, m.id);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ time: m.time, chat_id: d.chat_id, chat_name: d.chat_name, kind: "sent", sender: tr("我", "Me"), msg_type: m.type || "chat", text: m.text || "", message_id: m.id || "", from_draft_record: true });
    }
  }
  if (withDrafts) {
    for (const { d } of rows) {
      items.push({ time: d.created_at, chat_id: d.chat_id, chat_name: d.chat_name, kind: "ai_draft", sender: clientName(d.source), msg_type: "draft",
        text: d.text, draft_id: d.id, draft_status: d.status, filled_at: d.inserted_at || "", copied_at: d.copied_at || "", dismissed_at: d.dismissed_at || "" });
    }
  }
  // 时间顺序；同一秒时：先收到，再草稿，再我发出
  const order = { received: 0, ai_draft: 1, sent: 2 };
  items.sort((x, y) => x.time.localeCompare(y.time) || order[x.kind] - order[y.kind]);
  const KIND = { received: tr("收到", "Received"), sent: tr("我发出", "You sent"), ai_draft: tr("AI 草稿（没有发送）", "AI draft (not sent)") };
  download(`AIforBusiness-timeline-${withDrafts ? "with-drafts" : "messages-only"}-${stamp()}.csv`, toCsv(
    ["time", "chat_name", "chat_id", "kind", "sender", "message_type", "text", "message_id", "draft_id", "draft_status", "draft_filled_at", "draft_copied_at", "draft_dismissed_at"],
    items.map((x) => [x.time, x.chat_name, x.chat_id, KIND[x.kind], x.sender, x.msg_type, x.text, x.message_id || "", x.draft_id || "", x.draft_status || "", x.filled_at || "", x.copied_at || "", x.dismissed_at || ""])
  ), "text/csv;charset=utf-8");
  const sent = items.filter((x) => x.kind === "sent").length;
  $("exportMsg").textContent += tr(` 共 ${items.length} 行：你发出 ${sent} 条`, ` ${items.length} rows: you sent ${sent}`) + (withDrafts ? tr(`、AI 草稿 ${rows.length} 条`, `, AI drafts ${rows.length}`) : "") +
    (r?.unreadable_chats ? tr(`。有 ${r.unreadable_chats} 个对话 WhatsApp 现在读不到，只导出了草稿当时记下的回复。`, `. ${r.unreadable_chats} chats can't be read from WhatsApp right now; only the replies saved with the drafts were exported.`) : tr("。", ".")) +
    (r?.ok ? "" : tr(" （WhatsApp Web 没开，只有草稿当时记下的回复。）", " (WhatsApp Web is not open; only the replies saved with the drafts.)"));
}


// ---------- 嵌在 WhatsApp 里（由 sidebar.js 挂进 closed shadow DOM）----------
function closeEmbed() { if (typeof OPTS.onClose === "function") OPTS.onClose(); }
if (EMBED) {
  $("close").hidden = false;
  $("close").addEventListener("click", closeEmbed);
  $("newTab").addEventListener("click", () => ask({ type: "open_dashboard" }).catch((e) => showBanner(failText(e))));
}
$("refresh").addEventListener("click", load);
const onStore = (c, area) => {
  if (area !== "local" || !DATA) return;
  if (c.activity || c.drafts) { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 1500); }
};
let reloadTimer = null;
chrome.storage.onChanged.addListener(onStore);
show(EMBED ? "overview" : location.hash.slice(1), false);
load();
return { destroy() { chrome.storage.onChanged.removeListener(onStore); clearTimeout(reloadTimer); clearInterval(poll); } };
}

globalThis.__waAssistantDashboard = { mount };
// 独立分页（dashboard.html）：直接挂在 document
if (location.protocol === "chrome-extension:" && document.getElementById("v-overview")) mount(document, {});
})();
