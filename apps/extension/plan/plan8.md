# PLAN-8: 多渠道 Channels + 行为路由表（Routing Table）改造

目标：在不修改底层 Providers（OpenAI-compatible / Claude / Gemini / Google / Bing 适配器）的前提下，把“只能配置三家各一次”的 Options/Settings 改为“可新增多个 Channel（同一家可多条，每条只绑定一个 model）+ 用行为路由表选择每个功能走哪个渠道/翻译通道”。

---

## 0. 约束与对齐结论（已确认）

- `channelId` 是主键（int，自增）。
- Channel 内部需要 `typeId`（int，从 1 开始）供工厂选择适配器；上层请求/路由只引用 `channelId`，不直接传 `typeId`。
- `RouteKind` 优于 `typeId`，从 1 开始：
  - `1 = channel`
  - `2 = google`
  - `3 = bing`
- 行为 key 使用 **小写字符串**（可扩展，不使用行为枚举）。
- `google`/`bing` **不定义为 channel**，只作为 `RouteKind` 分支。
- 并发：固定默认 **15**，由开发者初始化/创建 channel 时设置，不在 UI 暴露给用户调整。
- icon：支持扩展内路径或 `https:` URL；保存时提示请求对应域名的 optional host permission；拉取成功后缓存到本地用于展示；未授权/失败则回退默认 icon。
- 删除 channel：允许删除；若某些行为路由引用了被删除 channel，自动回退到“第一个可用 channel”（或默认新建的默认 channel）。
- 字段扩展：允许新增字段，但通过结构体的 `extra` 容器承载，避免未来加字段导致 schema/patch 失效。

---

## 1) 数据结构（Settings / Storage）

### 1.1 Channels 表

新增 `channels: Channel[]`，每个 Channel 只绑定一个模型：

- `channelId: number`（主键，自增）
- `typeId: number`（渠道类型：1=openai-compatible，2=claude，3=gemini）
- `name: string`（用户自定义展示名）
- `model: string`（每条 channel 只允许一个 model）
- `config: object`（按 `typeId` 解释：baseUrl/apiKey/customHeaders 等）
- `iconUrl?: string`（可选；为空时使用默认 icon）
- `concurrencyLimit: number`（创建时初始化为 15，后续仅开发者可改，不在 UI 暴露）
- `extra: Record<string, unknown>`（扩展字段入口）

### 1.2 行为路由表（Routing Table）

新增 `behaviorRoutes: Record<string, RouteConfig>`，key 为小写字符串（可扩展）：

- `kind: number`（RouteKind：1=channel，2=google，3=bing）
- `channelId?: number`（当 kind=channel 必填）
- `extra: Record<string, unknown>`（扩展字段入口）

第一版需要包含所有“需要路由选择”的行为（不等后续）：

- `select_keywords`：仅允许 `kind=channel`
- `translate`：允许 `channel/google/bing`
- `dictionary`：允许 `channel/google/bing`（短板：google/bing 暂只支持“翻译型兜底”；后续补齐 google/bing 词典能力）
- `enhance_web`：仅允许 `kind=channel`
- `enhance_subtitle`：仅允许 `kind=channel`
- `chat`：仅允许 `kind=channel`
- `explain_word`：仅允许 `kind=channel`（如果未来要把“词典解释”完全统一到 `dictionary`，可在代码层做映射，但存储层保留独立 key）

> 说明：`dictionary` 与 `explain_word` 暂时都存在，便于后续补齐 “google/bing 词典” 时不破坏既有 explain 结构化输出。

---

## 2) 迁移策略（兼容旧 settings）

### 2.1 旧结构来源

当前旧结构主要包含：

- `settings.channels.openai/claude/gemini`（每家只能配置一次）
- `settings.keywordProvider`（openai/claude/gemini）
- `settings.translationProvider`（openai/claude/gemini/google/bing）
- `channelConcurrencyLimits` 等旧字段（本次改造后不对用户开放，迁移时按默认 15 处理）

### 2.2 迁移目标

在 `getSettings()` 的 migration 中：

1) 把旧的 `channels.openai/claude/gemini` 转换成 `channels: Channel[]`
   - 为每个存在的配置生成一条 Channel
   - 为缺失的配置生成一个默认 Channel（至少保证存在一个可用 channel，避免路由悬空）
2) 生成 `behaviorRoutes` 默认值：
   - `select_keywords`：从旧 `keywordProvider` 映射到对应 channelId
   - `translate`：从旧 `translationProvider` 映射：
     - google/bing → 对应 kind
     - openai/claude/gemini → kind=channel + 对应 channelId
   - `dictionary`：默认跟随 `translate`
   - `enhance_web/enhance_subtitle/chat/explain_word`：默认使用 kind=channel +（优先旧 translationProvider 为 LLM 的 channelId，否则用 keywordProvider 的 channelId）
3) 清理旧字段（保留最小兼容窗口，后续再移除）

### 2.3 “strict + parse” 的注意事项

由于当前存储与 Options 保存中使用了 `SettingsSchema.partial().strict()` + `SettingsSchema.parse(...)`，
未来字段扩展必须进入 `extra` 容器，避免：

- patch 因未知字段被 strict 拒绝
- parse 时未知字段被剥离导致“存不住”

---

## 3) Background 路由与 Provider 工厂

新增统一函数：

- `resolveRoute(behaviorKey, settings) -> { kind, channelId? }`
- `resolveChannel(channelId, settings) -> Channel | null`
- `getChatProviderByChannel(channel) -> provider`（内部用 `channel.typeId` 选择适配器）

行为落地规则：

- `select_keywords`：强制走 channel；缺失则回退第一个 channel
- `translate`：按 route 走 google/bing 或 channel
- `dictionary`：
  - 先离线词典
  - miss 后按 route：
    - google/bing：先做“翻译兜底”（后续补齐词典能力）
    - channel：走 LLM explain
- `enhance_web/enhance_subtitle/chat/explain_word`：仅走 channel；缺失则回退第一个 channel

并发：

- channel 级并发：使用 `channel.concurrencyLimit`（默认 15）
- google/bing：固定并发（由开发者在代码里常量管理，不暴露到 UI）

---

## 4) Options UI（新增：Channels 管理 + 行为路由选择）

### 4.1 Channels 管理

- 列表展示：name、typeId、model、baseUrl（若适用）、icon 预览、操作（复制/删除）
- 新增 Channel：选择 typeId → 输入 model + config
- 复制 Channel：复制 config + iconUrl + extra，生成新 channelId（model 可保持/可编辑）
- 删除 Channel：允许删除；保存时自动修复引用（回退第一个可用 channel）

### 4.2 行为路由选择（Routing Table）

为每个行为 key 提供选择器：

- 仅 channel 的行为：下拉选择 “使用哪个 channel”
- 允许 google/bing 的行为：选择 `RouteKind`（google/bing/channel）+（当 channel 时再选 channelId）

### 4.3 iconUrl 权限与缓存提示

- 保存时：
  - 若 iconUrl 为 https URL：提示并请求该 origin 的 optional host permission
  - 用户拒绝：保留 iconUrl（可选），但显示默认 icon + 提示未授权；不执行缓存
  - 用户同意：后台拉取、校验、缓存成功后显示本地图标预览

---

## 5) Icon 拉取与安全校验（非杀毒级保证，但做风险控制）

实现策略：

- 仅允许：
  - 扩展内路径（如 `assets/icons/...`）
  - `https:` URL
- 拉取限制：
  - 最大字节数（例如 256KB/512KB）
  - `Content-Type` 必须是图片（建议拒绝 svg）
  - 进行图片魔数校验（PNG/JPEG/WebP/GIF/ICO）
- 缓存：
  - 使用 IndexedDB 存储（避免 storage.local 容量问题）
  - LRU/TTL（例如最多 100 个，过期或超限清理）

默认 icon：

- 按 `typeId` 映射默认 icon（扩展内资源）；后续开发者将图标下载到本地后只需替换映射/资源路径。

---

## 6) 验收与回归（手工）

- Options：
  - 新增/复制/删除 channel
  - 行为路由切换：channel ↔ google ↔ bing（仅允许的行为）
  - iconUrl：保存触发授权提示；授权/拒绝均正确回退；授权后缓存预览正常
- 功能链路：
  - `select_keywords` 走指定 channel
  - 翻译：google/bing/channel 三种都可用
  - 词典：离线命中优先；miss 后按 dictionary route 兜底
  - web/subtitle/chat/explain 等 LLM-only 行为走指定 channel
- 删除被引用 channel 后：路由自动回退到可用 channel，不崩溃、不死循环

