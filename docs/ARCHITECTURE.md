# AI for Business Chat Assistant

Chrome 插件 + 本机 MCP 程序：让 Claude（桌面版 / Claude Code）或 ChatGPT（桌面版 / Codex）读你自己开着的 **WhatsApp Web**，找出谁在等你回、整理群聊、起草回复。**程序永远不发信息**，发送由人按。

学员安装：[`docs/安装说明.md`](docs/安装说明.md) · 隐私政策：[`PRIVACY.md`](PRIVACY.md) · 商店资料：[`docs/store-listing.md`](docs/store-listing.md)

> 非官方工具：跟 WhatsApp / Meta 没有关系，也没有得到他们的认可。「WhatsApp」只用来说明它配合哪个网站使用。

## 架构

```
Claude / ChatGPT ──stdio(MCP)──▶ plugins/chat-assistant/server/server.js ──ws://127.0.0.1:47821-47830──▶ Chrome 插件 ──▶ web.whatsapp.com
```

每个 AI 对话都会启动一份 server.js，数量没有上限：第一份占端口、连插件（主），其他的经过它（从）；主的关了，由一份从的接手，从第一个端口开始占（`lib/hub.js`）。同时只会有一份主：主的太慢没回应时，新的会等，不会另开一份；万一出现两份，端口号较大的那份会自己退下、并过去。

- `extension/` Chrome 插件（MV3）。固定 ID `hmajmekaiaiilhneebgbnchonfkblndb`（manifest 的 `key`）
  - `indexer.js` 即时索引（MAIN world，常驻）：工作量只跟「有变动的对话」有关，跟对话总数无关
    - 每个对话一份摘要，只有变动时才重算（用 WhatsApp 自己的变动事件；每分钟一次签名比对当保险）
    - 总数、未读、每日 / 每小时信息数用累计值：对话变动时减掉旧的、加上新的；等你回的清单按等待时间排好（二分搜寻插入）
    - 回覆时间、最活跃对话这类慢变的统计最多每分钟算一次
    - 只把变动送出去：`content.js` 写进 `chrome.storage.session`（只在记忆体）：每个对话一个 key `c:<id>`（全部对话，不设上限）+ 固定大小的总览 `wa_meta`（总数、统计、等最久的 100 人、最近 100 个对话）
    - 弹窗 / 仪表板 / AI 打开时只读 `wa_meta`；要「显示全部」、搜寻或筛选时才读全部 `c:*`
    - 实测（假资料）：一个对话变动的处理时间 500 / 5000 / 20000 个对话都约 2 ms；`wa_meta` 都约 80 KB
  - `reader.js` 只读读取器（MAIN world，按需注入）：读某个对话的信息、搜索等；`WAWebCollections` + IndexedDB `model-storage`（readonly）
  - `actions.js` 唯一的画面动作：打开对话（只接受弹窗里真人点击）
  - `content.js` WhatsApp 页面里的 AI 草稿预览卡（closed shadow DOM，浮在输入框上方；「填入输入框」= 贴上文字，不按发送）
  - `drafts.js` 草稿清单（`chrome.storage.local`，90 天）
  - `activity.js` AI 活动纪录（每次 MCP 请求：时间、哪个 AI、指令、数量；不存信息内容；90 天 / 1000 条）
  - `sidebar.js` WhatsApp 左边侧栏的「AI」图示 → 整页仪表板（iframe 嵌插件页面，`use_dynamic_url`）
  - `dashboard.html/js/css` 仪表板：概览统计、AI 活动纪录、草稿 vs 实际、数据安全图、导出（CSV / JSON，存在本机）
  - `background.js` 连本机程序、配对、转送指令
- `plugins/chat-assistant/` Claude Code / ChatGPT（Codex）插件：只有插件设定、图示和 `server/`（本机 MCP 程序，**零外部套件**：手写 MCP stdio + 最小 WebSocket 服务器）
- `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json` 插件市场（指向上面的插件文件夹）
- `mcpb/` Claude 桌面版扩展（.mcpb）设定
- `scripts/build-release.sh` 打包给学员的 zip

## MCP 工具

| 工具 | 类型 | 做什么 |
|---|---|---|
| `get_status` | 只读 | 连线 / 配对状态；没配对时给 6 位数配对码 |
| `list_chats` | 只读 | 列对话（未读 / 群 / 关键字） |
| `get_messages` | 只读 | 读某个对话最近 N 条（≤100） |
| `search_messages` | 只读 | 搜已存的信息（含图片说明、文件名、地点、联系人、投票） |
| `get_media` | 只读 | 看一条信息里的图片 / 贴图 / 文件（只用电脑里已有的，不下载；常常只有模糊小图） |
| `download_media` | 下载 | 下载一条信息里的图片 / 影片 / 语音 / 文件，存到「下载 / AI for Business Chat Assistant」；只有 AI 通过 MCP 叫才会做；只存查得完的类型（照片、影片、声音、文字、PDF、新版 Office），存档前逐个部分检查（`scan.js`），压缩档等其他类型一律不存；仪表板「AI 下载的文件」可以看预览 |
| `list_awaiting_reply` | 只读 | 对方最后发、我还没回 |
| `save_draft` | 写草稿清单 | 存一条回复草稿（不发送） |
| `list_drafts` | 只读 | 草稿 + 时间 + 实际回复（研究比对用） |

## 语言

- Chrome 插件：浏览器语言是中文（zh-*）就用中文，其他一律英文（`extension/i18n.js` 的 `tr(中文, English)`、`localizeDOM()`；插件名称和说明在 `_locales/`）
- AI 插件 / 本机程序（`plugins/chat-assistant`）：全部英文；AI 会用用户自己的语言回答

## 安全设计

- 程序里没有发送、按 Enter、标已读、删除的代码；填字和打开对话只认 `event.isTrusted` 的真人点击
- WebSocket 只绑 `127.0.0.1`；只接受 `Origin: chrome-extension://<固定 ID>` 且 `Host: 127.0.0.1:<端口>`；6 位数配对码（SPAKE2，每次只能猜一个码；AI 给码后 3 分钟内有效、同一个码试 5 次就换、每次启动最多 12 次）→ 64 位随机密钥（`~/.whatsapp-readonly-mcp/secret`，权限 600）
- 多份 server.js 共用连线：同一个 127.0.0.1 端口，双方用 `~/.whatsapp-readonly-mcp/hub-token`（权限 600，密钥本身不传送）互相验证；带 `Origin` 的请求（任何网页）一律拒绝；只能叫那 9 个指令；切换时读取会重试，存草稿绝不重复
- 插件 CSP：`connect-src ws://127.0.0.1:*`；权限只有 `scripting`、`storage`、`alarms`、`downloads`、`offscreen` + `https://web.whatsapp.com/*`
- 对外网络只有一种：AI 通过 MCP 叫 `download_media` 时，WhatsApp 分页从 WhatsApp 自己的媒体服务器拿那一个文件（SHA-256 一样才收；`downloader.js`、`media.js`）。其他零对外网络请求：没有统计、更新检查、远程程序、网络字体

## 开发

```
sh extension/icons/make-icons.sh         # 用 Chrome 把 logo.svg 画成插件 / Claude 图示
./mcpb/build.sh                           # 打包 .mcpb
./scripts/build-release.sh                # 打包学员 zip（dist/）
node --test tests/media.test.mjs          # 非文字信息测试（假资料 + 无画面 Chrome）
node --test tests/scan.test.mjs            # 防恶意文件检查（假文件）
node --test tests/rogue.test.mjs           # 本机连线：假程序拿不到密钥、做不了事（真插件程序 + 真本机程序）
node --test tests/download.e2e.mjs        # 下载：真插件 + 测试用 Chromium + 假 WhatsApp（CHROMIUM_PATH 指定；约 1 分钟）
node --test tests/hub.test.mjs            # 共用连线测试（用自己的端口和资料夹，不碰真的配对）；要 Node 22+
```

插件（这个仓库 / 学员 zip 的根目录本身就是插件市场）：

- Claude Code：`/plugin marketplace add <文件夹或 aiforbusiness-hq/whatsapp-readonly-mcp>` → `/plugin install chat-assistant@aiforbusiness`（`plugins/chat-assistant/.claude-plugin/plugin.json`，`${CLAUDE_PLUGIN_ROOT}`）
- ChatGPT 桌面版 / Codex：`codex plugin marketplace add <同上>` → `codex plugin add chat-assistant@aiforbusiness`（`plugins/chat-assistant/plugin.json` + `mcp.json` stdio，`${PLUGIN_ROOT}`）
- Claude 桌面版：`dist/chat-assistant.mcpb`

## 文件

- `docs/安装说明.md` 学员安装说明；`docs/store-listing.md` 商店资料；`PRIVACY.md` 隐私政策
- `keys/` 插件签名私钥（`*.pem`）**不进 git**（只有 Xun 有；打包 .crx 才需要）；git 里只有公钥 `pub.b64` 和插件 ID

## 状态 / 已知限制

- 连线状态四种，仪表板 / 弹窗一致：已连上、要配对（可直接在仪表板输入配对码）、还没连上过（显示设定步骤）、AI 没开（配对过，打开 AI 自动连上）；插件重新载入后旧页面会提示重新整理
- 「不用回」清单（`chrome.storage.local` 的 `ignored_waiting`）同时作用在仪表板、弹窗和 MCP `list_awaiting_reply`（`include_ignored: true` 可看全部）
- 仪表板的统计只算 WhatsApp Web 已载入电脑的信息；「对话时间线」导出按时间排序，可选是否放入 AI 草稿（放在草稿建立的时间点）
- Mac 测过读取、配对、Claude Code、Claude 桌面版；**Windows、ChatGPT 桌面版、「打开对话」、「填入输入框」还没实测**
- 每个对话只读得到 WhatsApp Web 已存在电脑里的信息
- 非官方读法：WhatsApp 改版可能失效；有账号被限制的风险
- 图示右下角有 WhatsApp 样式标志，只适合私下发给学员；上架 Chrome 网上应用店要拿掉

© AI for Business（aiclassmalaysia.com）。保留所有权利，仅供学员使用。
