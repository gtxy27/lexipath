# TS 开发指南（Development Guide）

本文档是 TS 的 **开发规范与注意事项（source of truth）**。后续任何工程约束、接口契约、权限策略、构建方式、代码风格与 Git 提交流程，都以此为准。

---

## 0. 范围与原则（必须遵守）

- **接口定义行为**：所有包都依赖“契约（types/schemas）”，不依赖彼此内部实现细节。
- **单向依赖**：`apps/extension` 依赖 `packages/*`；`packages/core` 不得依赖任何浏览器 API、DOM 或网络实现。
- **跨浏览器一等公民**：Chrome/Edge + Firefox 同步支持。
- **默认高难 + 保守回退**：严格对齐产品规格与行为文档（若本仓库作为子目录使用，通常位于 `../docs/OPEN_SOURCE_PRODUCT_PLAN.md` 与 `../docs/TRANSLATION_BEHAVIOR.md`）；当输出可疑时，**回退而不是渲染**。
- **模型由用户定义**：我们不内置/不替用户选择模型。用户配置 **OpenAI-compatible** 的 `baseUrl` 与 `model` 字符串即可。

### 0.1 文档定位（重要）

本文档位于 `docs/DEVELOPMENT.md`，是 **Lexipath（TS rewrite）** 的开发规范与最佳实践。

注意：在某些工作区布局里，本仓库可能作为子目录被上层工程引用（例如上层还有一个 legacy extension 工程）。此时：
- 行为/产品规格等文档通常位于上层 `../docs/` 目录（本文件中会以 `../docs/...` 形式引用）。
- 上层可能还有额外的工作区规范（例如 `AGENTS.md`），以其为准。

早期非目标（可延后）：
- 不做在线熟悉度同步（仅本地；缺失熟悉度默认按 0 退化）。
- 不做任何业务侧后端逻辑（计费/额度/扣费等）。

---

## 1. 目标仓库结构（TS rewrite / lexipath）

当前采用 monorepo（接口驱动、单向依赖）。以下路径均以本仓库根目录为准：

- `apps/extension/`
  - `background/`：MV3 service worker。消息枢纽、provider 调用、缓存、会话管理、权限请求。
  - `content/`：content script + overlay。抽取、渲染、交互、字幕 UI。
  - `ui/`：React 页面
    - `popup/`：快速控制
    - `options/`：设置、provider、权限、密钥管理
    - `onboarding/`：模式矩阵向导
    - `sidebar/`：侧边栏对话

- `packages/core/`（纯 TS，可单测）
  - Qualify：站点/内容门控、语言/频道判定（仅接口与纯逻辑）
  - Strategy：tier + masterWords（i+1）
  - Validation：严格输出校验 + 回退规则
  - Cache key：缓存键与去重策略

- `packages/providers/`
  - `OpenAICompatibleProvider`：OpenAI-compatible 适配器实现
  - 通用请求/响应适配与错误分类

- `packages/subtitles/`
  - YouTube + Bilibili 字幕适配器，输出统一 cue 模型

- `packages/dictionary/`
  - 离线词典（IndexedDB）、可选在线兜底、缓存策略

依赖方向（必须遵守）：
- `packages/core`：只能依赖“纯 TS 依赖”（不允许浏览器 API、React、WebExtension API）。
- `packages/providers`：允许 `fetch`/网络细节，但不允许依赖 `apps/extension`。
- `apps/extension`：可以依赖 `packages/*`，并负责接触 `browser.*` / DOM / UI。

---

## 2. 技术栈（固定）

- 包管理/运行时：**Bun**
- 打包：**Vite**（多入口：background/content/ui）
- UI：**React + Tailwind**
- 运行时校验：**Zod**

### 2.1 浏览器与平台支持

- 目标：Chrome/Edge + Firefox 均可用（开发期不接受“先 Chrome 后 Firefox”的差异实现）。
- MV3 约束：service worker 可能被随时回收，必须做到“状态可恢复”。

### 2.2 TypeScript 配置（建议默认）

- `strict: true`（必须）
- `noImplicitAny: true`（必须）
- `useUnknownInCatchVariables: true`（建议）
- `exactOptionalPropertyTypes: true`（建议）

原则：
- 任何“跨包 public API”的输入/输出必须是显式类型，并尽量与 Zod schema 一一对应。

### 2.3 构建与产物约定

- 构建输出必须包含：
  - 可加载的扩展目录
  - 浏览器差异 `manifest.json`（见第 5 节）
- 不允许把“需要后端服务才能启动”的逻辑写成强依赖。

### 2.4 代码格式化与静态检查（推荐，但保持可选）

本项目允许在早期不引入 lint/format 工具，但一旦引入：
- 格式化建议使用 Prettier，统一风格，避免争论。
- Lint 建议使用 ESLint（TypeScript + React 规则集）。

无论是否启用工具，代码风格必须遵守第 13 节。

---

## 3. 开发环境与常用命令（lexipath）

前置：
- 安装 Bun
- Windows 需要可用的 `tar`（`bun run release` 用 `tar --format=zip` 打包；Windows 10/11 通常自带 bsdtar）

安装依赖：
- （若你当前在上层工作区）`cd lexipath`
- `bun install`

常用脚本（见 `package.json`）：
- `bun run dev`：启动扩展开发（extension dev）
- `bun run build`：构建全部产物（Chrome + Firefox）
- `bun run build:chrome`：仅构建 Chrome 产物
- `bun run build:firefox`：仅构建 Firefox 产物
- `bun run typecheck`：TypeScript 全量类型检查（推荐提交/发 PR 前跑）
- `bun run test`：Vitest 单测（有新增/改动纯逻辑时必跑）
- `bun run release`：构建 + 打包输出到 `dist/`（zip/xpi + sha256）
- `bun run release:skip-build`：跳过构建，仅打包已有构建产物

---

## 4. 加载扩展（手动验证）

Chrome/Edge：
- `chrome://extensions` → Developer mode → Load unpacked → 选择构建产物目录

Firefox：
- `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → 选择构建产物的 `manifest.json`

---

## 5. 跨浏览器 Manifest 策略

构建时生成两份：
- `manifest.chrome.json`
- `manifest.firefox.json`

并针对目标浏览器输出最终 `manifest.json`。

需要处理的差异（必须显式管理，不要靠“碰运气”）：
- MV3 service worker 生命周期差异
- permissions / host permissions 字段与行为差异

补充说明（当前实现）：
- Chrome/Edge：使用 `background.service_worker`（MV3）
- Firefox：目前使用 `background.scripts`（MV3 兼容实现），并在 manifest 中设置 `browser_specific_settings.gecko.strict_min_version`
  - 若后续目标 Firefox 版本完整支持 `service_worker`，再统一字段；在此之前必须显式维护差异并保证行为等价

---

## 6. 权限与网络（Providers / Translators）

### 6.1 用户配置（多渠道 + 路由）

用户在 Options 中配置 **Channels**（可同时存在多个渠道；每个渠道仅允许一个模型）：
- `channels.openai`：OpenAI-compatible（必填 `baseUrl` + `model`；可选 `apiKey` + `customHeaders`）
- `channels.claude`：Claude / Anthropic（必填 `model` + `apiKey`；可选 `baseUrl` + `customHeaders`）
- `channels.gemini`：Gemini（必填 `model` + `apiKey`；可选 `baseUrl` + `customHeaders`）

并配置 **Routing**（允许选词与翻译使用不同渠道）：
- `keywordProvider`：`openai | claude | gemini`（选词只支持 LLM）
- `translationProvider`：`openai | claude | gemini | google | bing`

并发控制（Advanced）改为按渠道配置（避免 `baseUrl|model` 这种难理解的 JSON key）：
- `channelConcurrencyLimits.openai | claude | gemini | google | bing`：每渠道并发上限（1-500；为空走默认 20）

所有网络请求必须由 **background** 发起（content/popup 不允许直接 fetch 模型或翻译接口）。

### 6.2 Claude / Gemini 请求方式（实现约定）

为保持跨供应商一致，我们在 `packages/providers` 中将不同厂商的接口适配为“OpenAI-like chat”：

- **Claude（Anthropic Messages API）**
  - 默认 baseUrl：`https://api.anthropic.com/v1`
  - 端点：`POST /v1/messages`
  - 鉴权/头：`x-api-key: <API_KEY>`、`anthropic-version: <version>`
  - Body 核心字段：`model`、`messages: [{ role, content }]`、`max_tokens`

- **Gemini**
  - 默认 baseUrl：`https://generativelanguage.googleapis.com/v1beta`
  - 端点：`POST /v1beta/models/{model}:generateContent?key=<API_KEY>`
  - Body 核心字段：`contents: [{ role, parts: [{ text }] }]`

> 说明：我们只要求“能稳定拿到一段文本输出”，并通过 schema + validator 做严格回退。

### 6.3 Host 权限（推荐方案）

使用 **`optional_host_permissions`** 动态申请，按需授权：

流程：
1) 用户在 Options 中点击“测试连接”时，按所选渠道推导出请求 origin：
   - OpenAI：来自 `channels.openai.baseUrl`
   - Claude：来自 `channels.claude.baseUrl`（为空用默认 `https://api.anthropic.com/v1`）
   - Gemini：来自 `channels.gemini.baseUrl`（为空用默认 `https://generativelanguage.googleapis.com/v1beta`）
   - Google/Bing：使用内置固定域名
2) background 请求该 origin 对应 host 权限
3) 授权成功 → 允许 background 对该 origin 发起请求
4) 授权失败 → 显示可解释错误（PERMISSION_DENIED / PERMISSION_REQUEST_FAILED）

注意：
- 权限申请必须以“可解释的 UI 文案”提示用户为什么需要权限。
- 避免请求宽泛的 `*://*/*` 级别权限（除非明确是产品策略的一部分）。

---

## 7. 内部消息协议（扩展内部“前后端对齐”）

content/popup/ui 与 background 的交互全部走 `runtime.sendMessage`。

约定：
- `type` 使用 `SCREAMING_SNAKE_CASE`
- `payload` 在发送端与接收端都用 Zod 校验
- 失败必须返回结构化错误（不要吞）

初始消息类型（后续可扩展）：
- `GET_SETTINGS` / `SET_SETTINGS`
- `REQUEST_HOST_PERMISSION`
- `TEST_PROVIDER_CONNECTION`
- `ENHANCE_WEB`
- `ENHANCE_SUBTITLE`
- `TRANSLATE_KEYWORDS`
- `EXPLAIN_WORD`
- `CHAT`

---

## 8. 输出 Schema 与质量门控（Zod）

模型输出一律视为 **不可信输入**。

每条链路都必须：
- 定义 Zod schema
- 定义 validator，输出 `{ ok: true, value }` 或 `{ ok: false, fallback }`

任务类型（初版）：
- Web 增强：必须能解析为 JSON 且包含 `{ content_result: string, convert_word?: ... }`
- 字幕增强：必须能解析为 JSON 且包含 `{ line1_final: string, line2_final?: string, line3_final?: string }`
- Explain：词卡解释（中文结构化输出）
- Chat：侧边栏对话（中文结构化输出）

回退规则（必须确定性）：
- schema 不通过 → 不渲染
- 语言约束失败 → 不渲染
- 长度膨胀超阈值 → 不渲染
- 失败时：返回原文/隐藏增强/降级模式（按场景与配置决定）

---

## 9. 字幕支持（YouTube + Bilibili）

字幕统一成 cue 模型：
- `Cue`: `{ id, startMs, endMs, text, lang, source }`

UI 行为（对齐 `../docs/OPEN_SOURCE_PRODUCT_PLAN.md`）：
- 默认：只显示“目标语增强字幕”（单语增强）
- 切换：点击切换双语（目标语增强 + 原字幕/辅助层）
- 救命：字幕场景提供“按住临时双语/松开恢复”（网页阅读默认不提供）

平台差异逻辑必须封装在 `packages/subtitles` 内，禁止泄漏到 `packages/core`。

---

## 10. 熟悉度（本地）

- 未命中熟悉度时默认 0（自然退化）
- 熟悉度更新来自本地事件（查词、收藏、标记已学会等）
- 默认不向用户展示内部熟悉度分数

---

## 11. UI 与样式注意事项

- 扩展页面（popup/options/onboarding/sidebar）使用 React + Tailwind。
- content script 注入 UI 必须隔离样式（推荐 Shadow DOM），避免污染网页或被网页污染。
- UI 文本走 i18n key（不要硬编码字符串），保证可本地化。

---

## 12. 手工验收清单（TS rewrite 版）

我们维护一份类似 `../docs/MANUAL_TESTS.md` 的清单，用于跨浏览器手工验证：
- popup 打开与切换
- optional host permissions 授权流程
- Web 增强：门控 → 请求 → 校验 → 渲染/回退 → 切回原文
- 词卡：查词、TTS、收藏、解释
- 侧边栏对话：多轮、截断、过期清理
- 字幕：YouTube + Bilibili 单语/双语切换 + 按住临时双语
- background：service worker 重启后的鲁棒性


---

## 13. 代码风格与命名规范（必须遵守）

### 13.1 通用

- 缩进：2 空格
- 换行：LF
- 语言：TS rewrite 区域全部使用 TypeScript
- 命名：
  - 变量/函数：`camelCase`
  - 类/React 组件：`PascalCase`
  - 常量：`SCREAMING_SNAKE_CASE`（仅用于"真正常量"与 message types）
  - 文件名：`kebab-case.ts` 或 `camelCase.ts` 二选一（项目内必须统一；默认建议 `kebab-case`）

### 13.2 TypeScript

- 公共接口（跨包导出）必须：
  - 有明确类型
  - 有 Zod schema（或至少与 schema 同步设计）
- `any` 禁止（除非在隔离层，且有注释说明为什么无法避免）。
- `unknown` 优于 `any`；外部输入先校验再使用。
- 不要为了"省事"写复杂的类型体操；以可读性与稳定性优先。

### 13.3 React + Tailwind

- React 组件：
  - 单文件单组件（小组件可同文件），避免超大文件。
  - 复杂状态优先下沉到 `packages/core` 或自定义 hooks，避免 UI 层堆算法。
- Tailwind：
  - UI 页面可以使用 Tailwind utility classes。
  - content script 的样式必须隔离（Shadow DOM + 自己的样式入口），避免影响网页。

### 13.4 错误处理与日志

- 模型输出、网络响应、存储读取都视为不可信输入。
- background 作为"后端"必须返回结构化错误（可用于 UI 展示与埋点）。
- 不要在 UI 层吞错误；至少做到"可观测"。

### 13.5 性能与运行时效率（必须遵守）

这不是“优化选项”，而是扩展产品形态决定的硬要求：content script 在高频滚动与复杂 DOM 页面里运行，任何低效实现都会直接变成卡顿与电量消耗。

- **内容脚本（content）**
  - 禁止对整页做高频全量扫描；优先用 `MutationObserver` + 精准过滤 + 批处理。
  - 任何会触发大量重排/重绘的操作必须合并（读写分离、批量 DOM 更新）。
  - 长列表/大量标注渲染必须做“可见区域优先”（IntersectionObserver/虚拟化/分段渲染）。
  - 计算密集任务（分词/语言识别/策略计算）必须缓存并去重；优先按段落粒度而不是按节点粒度。

- **后台（background/service worker）**
  - 以“随时被回收”为前提：不要依赖常驻内存状态；关键状态必须可从 `storage.*` 恢复。
  - 网络请求必须支持超时与取消（AbortController）；同一内容请求必须去重（in-flight dedupe）。

- **UI（popup/options/onboarding/sidebar）**
  - 只在需要复杂交互的页面使用 React；避免把算法/大数据处理放在 UI 层。
  - 控制 bundle 体积：避免引入重量级依赖；能用原生 Web API 就别引第三方库。

- **校验与解析（Zod/JSON）**
  - 模型输出解析与 Zod 校验只做一次：不要在多层调用链重复 `JSON.parse` / `schema.parse`。
  - 对外部输入（模型输出/网络响应/存储）先校验再使用，避免异常导致循环重试或渲染风暴。

- **性能与卡顿控制（建议）**
  - 避免长时间同步任务占用主线程；必要时分帧/空闲切片（`requestIdleCallback`/`requestAnimationFrame`）。
  - 以“滚动/输入优先”为原则：非关键工作必须可延后、可取消、可中断；渲染与计算尽量做缓存、去重与批处理。
---

## 14. Git 工作流与提交规范（必须遵守）

### 14.1 分支与协作

- 开发分支：`dev`（日常开发与集成）
- 发布分支：`main`（版本发布分支；只接收来自 `dev` 的发布合并与紧急 hotfix）
- 功能分支命名：
  - `feat/<topic>`、`fix/<topic>`、`docs/<topic>`、`refactor/<topic>`

协作原则（推荐）：
- 不直接往 `main` 提交代码；发布时从 `dev` 合并到 `main`（建议 PR）。
- 功能分支从 `dev` 拉出，完成后合回 `dev`。
- 需要线上紧急修复时，从 `main` 拉 `hotfix/<topic>`；合回 `main` 后，**必须再同步回 `dev`**。
- 本地整理历史可以 `rebase`，但不要改写已经推送并被他人基于的公共分支历史（尤其是 `dev/main`）。

### 14.2 版本与发布（main 分支）

推荐流程（最小可行）：
- 在 `dev` 完成功能与验收（至少 Chrome + Firefox 各 1 个网页场景 + 1 个字幕场景）。
- bump version（保持一致）：
  - `apps/extension/package.json`
  - `apps/extension/public/manifest.chrome.json`
  - `apps/extension/public/manifest.firefox.json`
- 若远端尚无 `main`（例如远端默认分支仍指向 `dev`），首次发布前先创建发布分支：
  - `git switch dev`
  - `git pull --ff-only`
  - `git switch -c main`
  - `git push -u origin main`
- `dev` → `main`：合并并打 tag（例如 `v0.1.0`），再执行 `bun run release` 产出 `dist/` 包。

### 14.3 提交信息（Conventional Commits）

格式：
- `<type>(<scope>): <subject>`

允许的 `type`（常用）：
- `feat`：新功能
- `fix`：修复
- `docs`：文档
- `refactor`：重构（不改变行为）
- `chore`：杂项（依赖、脚本、配置）
- `test`：测试
- `build`：构建相关

示例：
- `feat(core): add zod schema for enhance web`
- `fix(extension): handle optional host permission denial`
- `docs: update TS rewrite development guide`

提交粒度：
- 一次提交只做一类事情，避免"功能 + 格式化 + 重构"混杂。
- 如必须大规模格式化，请单独提交，并在 subject 中标明 `format`。

### 14.4 禁止提交的内容

- 任何真实 `apiKey`、token、个人隐私信息
- 大体积词典/资源（例如类似 `assets/extracted_analysis_results.jsonl` 级别）

### 14.5 PR / 变更说明（如果使用 PR）

每个 PR 至少包含：
- 变更摘要（做了什么）
- 影响范围（哪些包/页面）
- 手工验证清单（Chrome + Firefox，包含至少一个网页场景 + 一个字幕场景）
- 如涉及权限：说明新增/变更的 permission 与原因



---

## 15. 工作拆解与分工（建议）

本节用于把"要做什么"拆成可落地的工作包（Workstreams）。原则：
- **契约优先**：先定接口与 schema，再写实现。
- **单向依赖**：UI/扩展壳依赖 core/providers/subtitles；core 不反向依赖 UI。
- **跨浏览器同时验收**：每个工作包的 DoD 都要包含 Chrome + Firefox 的手工验证。

### 15.1 产品与交互（PM/Design）

目标：把 `../docs/OPEN_SOURCE_PRODUCT_PLAN.md` 的"模式矩阵/默认策略/字幕语义"固化为可实现的规格。

主要工作：
- 明确模式矩阵：Web(native/target) × Video(native/target) × 强度档位（按文档），并定义每档的行为差异（何时显示中文、何时替换/注入）。
- 明确字幕交互：默认单语增强、一键双语、按住临时双语（仅字幕场景）。
- 输出 UI 文案与 i18n key（避免硬编码）。

DoD（完成标准）：
- 规格能映射到可实现的 settings 结构（与 `GET_SETTINGS/SET_SETTINGS` 对齐）。

### 15.2 扩展 UI（前端：popup/options/onboarding/sidebar）

目标：用 React + Tailwind 实现扩展页面，提供配置/控制入口，但不在 UI 层承载算法。

主要工作：
- `popup`：当前站点状态、模式切换、快捷开关（例如启用/停用、字幕切换入口）。
- `options`：
  - provider 管理：`baseUrl`、`model`、`apiKey`、自定义 headers
  - 权限管理：按需触发 `optional_host_permissions` 授权/撤销
  - 语言与模式矩阵配置（首发 zh-CN + en，但接口预留）
- `onboarding`：按文档的初始化向导（水平选择、场景选择、默认高难策略说明）。
- `sidebar`：侧边栏对话 UI（多轮对话、会话恢复、错误展示、清理提示）。

注意事项：
- UI 只负责展示与发送消息；所有输入必须走 Zod 校验（尤其是 provider 配置）。
- i18n key 必须统一管理，禁止直接写中文/英文硬编码到代码里。

DoD：
- Chrome + Firefox：页面可打开、配置可保存、权限弹窗可用、错误可见。

### 15.3 Content Script（前端：页面注入与渲染）

目标：实现网页增强与字幕增强的"渲染层 + 交互层"，并严格遵守性能约束。

主要工作：
- Web：文本抽取与段落级处理、overlay 渲染（建议 Shadow DOM）、原文/增强切换（含快捷键）、词卡交互入口。
- Video：字幕层渲染（单语/双语/按住临时双语）、与 `packages/subtitles` 的 cue 对接。

DoD：
- 至少 1 个网页场景 + YouTube + Bilibili 各 1 个场景可用（Chrome/Firefox）。

### 15.4 Background（"后端"：消息枢纽、网络、缓存、会话）

目标：作为扩展内部的"后端"，承接所有网络请求与跨页状态。

主要工作：
- 消息路由：统一处理 `ENHANCE_WEB/ENHANCE_SUBTITLE/TRANSLATE_KEYWORDS/EXPLAIN_WORD/CHAT`。
- Provider 调用：只走 `packages/providers`，支持超时/取消、错误分类、重试/退避策略。
- 去重与缓存：in-flight 去重、结果缓存（按 cache-key；注意隐私与过期）。
- 会话管理：续聊、历史截断、过期清理（对齐行为文档）。
- 权限：实现 `optional_host_permissions` 申请/校验。

DoD：
- service worker 被回收后能恢复基本状态，不出现"必须重装/清缓存"才能用的故障。

### 15.5 Core（算法与契约：qualify/strategy/validators）

目标：把核心行为抽象成纯 TS 包，保证可复用、可测试、可解释。

主要工作：
- `qualify`：站点门控 + 内容门控 + channel 判定。
- `strategy`：tier + masterWords（基于本地熟悉度，缺失默认 0）。
- `validators`：Web/Video/Explain/Chat 四套 schema + 校验 + 回退结构。
- `cacheKey`：稳定、可控的缓存键设计（含上下文、模式、语言、tier 等）。

DoD：
- core 对外接口稳定、类型齐全，并与 Zod schema 同步。

### 15.6 Providers（OpenAI-compatible）

目标：让用户自定义 provider（baseUrl/model），我们只保证协议兼容与健壮性。

主要工作：
- OpenAI-compatible 请求适配（按最终 API 契约）。
- 通用错误模型：网络错误、鉴权错误、超时、不可解析。
- Options "测试连接"。

DoD：
- 用户填任意合法 baseUrl + model，可通过"测试连接"得到可解释结果。

### 15.7 Subtitles（YouTube + Bilibili）

目标：把平台差异封装在 `packages/subtitles`，统一输出 cue。

主要工作：
- YouTube/Bilibili 字幕获取与 cue 归一化。

DoD：
- 两个平台都能稳定拿到 cue，并能驱动 content 层渲染。

### 15.8 Dictionary & TTS（词卡支撑能力）

目标：离线优先、体验稳定。

主要工作：
- IndexedDB 存储结构与查询接口。
- 小启动包（开箱即用）+ 大包下载接口预留。
- 浏览器 TTS 接入。

DoD：
- 词卡查词/发音可用；离线可用（至少启动包）。

### 15.9 构建、打包与发布

目标：构建产物可重复生成、可加载、可分浏览器。

主要工作：
- Vite 多入口构建（background/content/ui）
- manifest 生成（chrome/firefox）
- 可选：打包 zip/xpi。

DoD：
- `bun install` + `bun run build` 可生成可加载目录。

### 15.10 手工验收（QA）

目标：用清单确保"行为一致 + 跨浏览器一致"。

主要工作：
- 维护 TS rewrite 专用验收清单（可从第 12 节扩展为单独文件）。
- 每次大改必须跑：Chrome + Firefox + 1 网页 + YouTube + Bilibili。

DoD：
- 每个里程碑都有可复现的验收记录（浏览器版本 + URL + 截图/录屏可选）。
