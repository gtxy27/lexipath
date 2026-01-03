# PLAN-5: DEVELOPMENT.md 对齐缺口收敛

目标：
- 让 `lexipath/apps/extension` 的实现更严格对齐 `docs/DEVELOPMENT.md` 的注意事项与 DoD
- 收敛“当前可运行但不符合规范 / 存在潜在风险”的点

**涉及文件（预计）**：
- `apps/extension/src/content/subtitle-overlay.ts`
- `apps/extension/src/content/i18n.ts`
- `apps/extension/public/_locales/en/messages.json`
- `apps/extension/public/_locales/zh_CN/messages.json`
- `apps/extension/src/shared/messages.ts`
- `packages/core/src/types/index.ts`（或新增 schemas 文件）
- `apps/extension/src/background/index.ts`
- `apps/extension/src/ui/options/Options.tsx`
- `apps/extension/public/manifest.chrome.json`
- `apps/extension/public/manifest.firefox.json`
- `lexipath/package.json`

---

## 需求一：移除 content 层硬编码文案（i18n 收口）

### 问题
- 字幕 overlay 的模式文案 / loading 文案存在硬编码，不走 i18n。

### 证据
- `apps/extension/src/content/subtitle-overlay.ts:284` 返回 `单语/双语/双语(按住)`
- `apps/extension/src/content/subtitle-overlay.ts:298` 使用 `Loading…`

### 影响
- 与 `docs/DEVELOPMENT.md`（扩展 UI 文案 & i18n key）要求不一致。
- 无法稳定支持多语言/后续文案调整成本高。

### 方案
- content 层统一通过 `apps/extension/src/content/i18n.ts#getI18nMessage` 获取文案。
- 增加 i18n keys（示例）：
  - `subtitleModeSingle`
  - `subtitleModeBilingual`
  - `subtitleModeBilingualHold`
  - `wordCardLoading`

### DoD
- content 侧 UI 可见文案不再出现中文/英文硬编码（prompt/system message 等“非 UI 文案”除外）。
- locale 切换时上述文案能正确变化。

---

## 需求二：消息协议 payload/value 全量 schema 化（去掉 z.unknown）

### 问题
- `apps/extension/src/shared/messages.ts` 中：
  - `ENHANCE_WEB/ENHANCE_SUBTITLE/EXPLAIN_WORD` 的 `payloadSchema` 是 `z.unknown()`
  - `EXPLAIN_WORD` 的 `valueSchema` 是 `z.unknown()`

### 影响
- 不满足“所有输入必须走 Zod 校验”的边界约束。
- 出错定位困难，fallback 规则难统一。

### 方案
- 在 `@lexipath/core` 定义并导出：
  - `EnhanceWebPayloadSchema`
  - `EnhanceSubtitlePayloadSchema`
  - `ExplainWordPayloadSchema`
  - 以及相应的输出 `ExplainWordOutputSchema`（或至少 Error/Success 的结构化 schema）
- 更新 `apps/extension/src/shared/messages.ts` 的 `messageDefinitions` 使用这些 schema。
- 调整 background/content 的 payload 构造，避免“随意字段”。

### DoD
- `sendMessage` 与 background registry 入口能在边界处校验 payload/value。
- 至少补 1-2 个单测覆盖“非法 payload -> INVALID_PAYLOAD”。

---

## 需求三：将 Options “测试连接” 迁移到 background（网络请求收敛）

### 问题
- `apps/extension/src/ui/options/Options.tsx` 直接 `new OpenAICompatibleProvider(...)` 并发起网络请求。

### 影响
- 偏离 `docs/DEVELOPMENT.md` 15.4 的设计：Provider 调用应收敛到 background。
- 网络/权限/错误分类逻辑分散，后续更难维护。

### 方案
- 新增消息类型（示例）：`TEST_PROVIDER_CONNECTION`。
- UI 只负责：
  - 发送 provider config（已走 Zod 校验）
  - 展示结果（success / error code）
- background 负责：
  - `REQUEST_HOST_PERMISSION`（origin = baseUrl 的 origin）
  - 调用 provider `testConnection()`
  - 统一返回结构化错误（code + message）

### DoD
- UI 层不再直接 fetch。
- “测试连接”的错误可解释（至少区分：权限拒绝 / 鉴权失败 / 超时 / 解析失败）。

---

## 需求四：权限策略收紧（避免广泛 origins 与通配符输入）

### 问题
- manifest 中存在非常宽泛的可选权限：
  - `apps/extension/public/manifest.chrome.json:32` `optional_host_permissions: ["https://*/*", ...]`
  - `apps/extension/public/manifest.firefox.json` `optional_permissions: ["https://*/*", ...]`
- background 的 `REQUEST_HOST_PERMISSION` 允许 `'<all_urls>'` / `'*'` 等输入路径（当前实现会原样放行）。

### 影响
- 与 `docs/DEVELOPMENT.md` “Never request broad `*://*/*` permissions” 精神冲突。
- 存在被误用的口子：理论上可请求任意 origin。

### 方案
- background 层强制收口：
  - 必须用 `new URL(origin)` 解析
  - 仅允许 `url.origin + '/*'`
  - 拒绝 `<all_urls>`
  - 拒绝任何包含 `*` 的 pattern
  - 可选：只允许 `https:` + `http://localhost`（开发）
- 权限策略（产品决策二选一）：
  - A) 允许任意自定义 provider：manifest 仍需要“可覆盖任意 https 域”的 optional pattern，但 runtime 请求只能是 provider origin
  - B) 默认只允许 known providers（openai/azure/自建域名需手动开启高级开关），从根上避免 broad optional pattern

### DoD
- 无法通过消息请求 `<all_urls>` 或 wildcard pattern。
- Options 页面明确解释“为什么要请求该 origin 权限”。

---

## 需求五：Chat 会话持久化（支持 service worker 回收后的会话恢复）

### 问题
- `apps/extension/src/background/index.ts` 的 `chatSessions` 为内存 Map；service worker 回收会丢失会话。

### 影响
- 与 `docs/DEVELOPMENT.md` 的“会话恢复/续聊”预期不一致。
- 用户体验不稳定（后台重启后对话断档）。

### 方案
- 定义 `ChatSessionSchema` 并持久化到 `storage.local`：
  - 按 `conversationId` 分 key（便于 TTL/数量管理）
  - 或统一 key 存数组（注意大小限制）
- 读取时做：TTL 清理 + 条数截断（沿用现有 `CHAT_MAX_HISTORY_MESSAGES`）。

### DoD
- 强制重启 service worker 后仍可续聊（至少最近 1 个会话可恢复）。
- TTL/数量上限逻辑仍生效。

---

## 需求六：取消/超时能力一致化（AbortController 真正可取消）

### 问题
- `packages/providers/src/openai-compatible.ts` 中 `cancel()` 的 `abortController` 当前并未绑定到实际的 fetch（`fetchWithTimeout` 用的是局部 controller）。

### 影响
- cancellation 形同虚设。
- 与 `docs/DEVELOPMENT.md` 15.4 的“超时/取消”能力不一致。

### 方案
- 为每个 in-flight 请求保存 controller（按 cacheKey 记录），或把 controller 绑定到实例字段。
- `cancel()` 需要：
  - abort 当前 controller(s)
  - 清理 `inFlightRequests`

### DoD
- 单测：cancel 后请求会被 abort，错误分类为可识别的“取消/超时”。

---

## 需求七：lint/format 脚本可用性（可选但不能“写了跑不起来”）

### 问题
- `lexipath/package.json` 存在 `lint/format` 脚本，但未看到对应依赖（可能导致新环境无法运行）。

### 影响
- `docs/DEVELOPMENT.md` 2.4：一旦引入工具，就需要可用且可复现。

### 方案
- 方案 A：补齐 `eslint/prettier` 依赖 + 最小配置
- 方案 B：移除脚本，仅保留“可选”文档说明

### DoD
- 干净环境下 `bun run lint` / `bun run format` 可运行（或脚本被移除且文档写清楚）。

---

## 需求八：Content 性能策略补齐（IntersectionObserver/可见区域优先）

### 问题
- `apps/extension/src/content/index.ts` 已有 MutationObserver + queue + requestIdleCallback，但未实现“可见区域优先/虚拟化”的建议项。

### 影响
- 长页面（大量段落）可能仍会处理过多元素，影响性能。

### 方案
- 引入 `IntersectionObserver`：
  - 优先处理可见区域内的候选元素
  - 滚动时动态调度
- MutationObserver 回调进一步批处理/过滤（避免每个 mutation 都触发大量候选）。

### DoD
- 长页面滚动时无明显卡顿（主观验证 + 可选性能日志）。

---

## 需求九：跨浏览器 MV3 背景字段再确认

### 问题
- Firefox manifest 当前使用 `background.scripts`（而非 `service_worker`），需要确认与目标 Firefox MV3 支持版本一致。

### 方案
- 在文档/README 中明确 Firefox 的 MV3 约束与选择理由。
- 如目标版本支持 `service_worker`，则统一；否则明确差异并保证功能等价。

### DoD
- Firefox 临时加载无 background 相关报错；消息可通、核心功能可用。

---

## 验收建议（手工）
- 以 `docs/MANUAL_TESTS.md` 为基线补充验证：
  - Options “测试连接”（权限允许/拒绝/超时/鉴权失败）
  - 权限请求只能针对 provider origin（拒绝 wildcard/<all_urls>）
  - service worker 重启后 chat 能续聊
  - locale 切换后字幕模式按钮文案同步变化

---

## 需求十：补齐全局 i18n（清理其他硬编码用户可见文案）

### 问题
- 除了字幕模式按钮外，仍有多处**用户可见文案**直接写死英文/中文，不走 `_locales/*/messages.json`。

### 证据（示例）
- `apps/extension/src/background/index.ts:610`：`Failed to load definition`（fallback）
- `apps/extension/src/ui/components/WordCardPopover.tsx:61`：`Failed to load definition`（UI 渲染）
- `apps/extension/src/content/subtitle-controller.ts:448`：`(Loading translation...)`（字幕第二行加载态）
- `apps/extension/src/content/index.ts:591`：`Provider not configured, skipping page processing`（日志/状态提示）
- 另见：`apps/extension/src/content/subtitle-overlay.ts:284`（`单语/双语/双语(按住)`）

### 方案
- 将 content/UI 层所有“用户可见字符串”统一收敛到 i18n：
  - 对 content 层：使用 `apps/extension/src/content/i18n.ts#getI18nMessage()`
  - 对 React UI：使用 `browser.i18n.getMessage()`（或统一封装 `t()`）
- 在 `apps/extension/public/_locales/en/messages.json` 与 `apps/extension/public/_locales/zh_CN/messages.json` 增加对应 key。

### DoD
- `rg -n "Failed to load definition|No definition available|\(Loading translation\.\.\.\)|单语|双语" apps/extension/src` 不再命中（仅测试代码可例外）。
- 以上 UI/字幕加载态文案均可按 locale 正确显示。

---

## 需求十一：支持 YouTube（以及潜在 B 站）SPA 导航（同站内切换视频可恢复）

### 问题
- content script 在初始化时只读取一次 `window.location.href` 并初始化字幕控制器，站内 SPA 切换视频（URL 变化）后不会重新初始化。
- `YouTubeSubtitleProvider` 在 `init()` 时固化 `videoId`，不会随 URL 更新。

### 证据
- `apps/extension/src/content/index.ts:573`：仅初始化时读取 URL
- `apps/extension/src/content/subtitle-providers/youtube-subtitle-provider.ts:34`：`videoId` 固化

### 方案
- 在 content 层增加“URL 变化检测”并触发重建：
  - 方案 A：定时对比 `location.href`（轻量，最稳）
  - 方案 B：hook `history.pushState/replaceState` + 监听 `popstate`
- 当 URL 变化且平台仍为 YouTube/Bilibili：
  - `subtitleController.destroy()`
  - 重新 `initSubtitleController(detectPlatform(nextUrl), nextUrl)`

### DoD
- YouTube：同一个 tab 内切换到另一个视频页面，字幕增强仍可工作。
- B 站：同站内切换分集/视频（若属于 SPA），字幕增强不需要刷新页面也可恢复。

---

## 需求十二：Web 增强词替换算法支持“重复词/多次出现”

### 问题
- `createEnhancedElement()` 通过 `indexOf()` 计算每个词的出现位置，容易只命中“第一次出现”，导致重复词或多次出现时替换不完整/错位。

### 证据
- `apps/extension/src/content/index.ts:139`：`indexOf(word.original...)`

### 方案
- 实现“左到右单次扫描”的替换策略，确保同词多次出现也能被处理，且不发生重叠替换：
  - 维护 `cursor` 指针，从当前位置起找“最靠前的下一个匹配词”
  - 每次匹配后推进 cursor，继续寻找后续匹配
  - 对大小写/边界（单词边界）做可控策略（至少英文场景用 `\b` 边界）
- 或者：在 prompt/输出契约里让模型返回每个词的 start/end index（更稳，但需要更新 schema）。

### DoD
- 段落中同一个词出现多次时，能稳定高亮多处出现。
- 不出现死循环/性能退化（长文本处理时间可控）。

---

## 需求十三：TTS 语言从 settings 计算（避免固定 en-US）

### 问题
- `WordCard` 当前固定使用 `en-US` 发音，学习非英语语言时会错误。

### 证据
- `apps/extension/src/ui/components/WordCard.tsx:42`：`await speak(data.word, 'en-US')`

### 方案
- 从 `Settings.targetLanguage` 推导 `SpeechSynthesisUtterance.lang`：
  - `en -> en-US`
  - `ja -> ja-JP`
  - `ko -> ko-KR`
  - `fr -> fr-FR`
  - `de -> de-DE`
  - `zh -> zh-CN`（或根据用户设置补充 zh-TW）
- `WordCard` 需要拿到 settings：
  - 方案 A：上层（popover/controller）传入 `lang` 或 settings
  - 方案 B：WordCard 内部 `GET_SETTINGS`（不推荐：UI 组件职责膨胀）

### DoD
- 不同 targetLanguage 下，TTS 使用对应语言码。
- 单测更新：不再断言固定 `en-US`。

---

## 需求十四：修复 DictionaryService 并发 init（IndexedDB open 去重）

### 问题
- `DictionaryService.lookup/upsert/bulkImport` 在 `db` 为空时会 `await init()`，但 `init()` 没有做并发去重；并发调用可能触发多次 `indexedDB.open()`。

### 证据
- `packages/dictionary/src/dictionary-service.ts:40`：`if (!this.db) { await this.init(); }`
- `packages/dictionary/src/dictionary-service.ts:17`：`init()` 每次调用都会 `indexedDB.open(...)`

### 方案
- 增加 `private initPromise: Promise<void> | null`：
  - 若 `db` 已存在直接返回
  - 若 `initPromise` 存在则复用
  - 失败时清空 `initPromise`，允许后续重试

### DoD
- 并发调用 `lookup()` 不会导致多个 open；不会出现偶发的 IDB 状态错误。
- 单测（可选）：mock indexedDB.open 调用次数为 1。
