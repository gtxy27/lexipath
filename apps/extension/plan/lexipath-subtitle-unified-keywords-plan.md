# LexiPath：字幕与网页翻译/关键词统一方案（上下文与分阶段计划）

本文件用于记录当前讨论结论与后续实施计划，确保后续模型无需猜测即可继续推进。

工作区根目录：`d:\test\ries-2.38.xpi`  
实际主要代码库：`lexipath/`（它本身是一个独立的 git 仓库）

---

## 0. 约束与规范

### 0.1 用户约束
- **在用户明确说“可以修改代码”之前，不允许修改代码**（先对齐方案）。
- **在用户明确说“可以提交”之前，不允许提交**。
- 一旦进入实施阶段：**每个阶段必须以一个 Git commit 结束**（分阶段、可回滚、可 review）。

### 0.2 代码规范（与当前讨论直接相关）
- WebExtension（MV3）代码保持现有 async/await 与 browser API 使用风格一致。
- 避免全局重构与无关改动；只做与目标相关的最小变更。
- **尽量避免 `innerHTML`**（用户日志出现 Trusted Types 报错；我们在 overlay 里应继续用 DOM API + `textContent`）。
- 对模型输出做最小“兜底校验”（trim、去重、过滤空值/异常值），但：
  - **不在 UI 层做复杂正则去识别人名地名**；
  - **人名地名的排除由 prompt 约束模型来判断**。

### 0.3 Git 要求
- 使用 **Conventional Commits**：
  - `feat(extension): ...`
  - `fix(subtitles): ...`
  - `refactor(extension): ...`
  - `test(extension): ...`
- 每个阶段结束必须单独 commit；不要把多个阶段揉进一个提交。

---

## 1. 当前状态（已落地的事实）

### 1.1 已定位并解决的 YouTube 关键问题
- 早期问题：`Fetched 0 subtitle cues` 的根因是 YouTube `/api/timedtext` 真实请求需要额外参数（从 `potc=...` 开始），仅凭 `captionTracks.baseUrl` 拉取会返回空。
- 对齐参考：`src-extension` 的实现是通过 `webRequest.onBeforeRequest` 拦截真实 timedtext 请求，提取 `potc=...` 并缓存，再由 content script 查询/补参。

### 1.2 已合入（lexipath 仓库内）的提交记录（供后续模型快速定位）
- `43c91fe feat(extension): improve YouTube subtitle overlay`
  - timedtext 拦截 + 补参拉取字幕成功
  - 获取到字幕后隐藏 YouTube 原生字幕
  - subtitle overlay 采用 Trusted Types safe 的 DOM 渲染
  - `EXPLAIN_WORD`：优先查 IndexedDB 字典，查不到走 provider（AI）并缓存/回写
- `ed3a55d feat(extension): show subtitle word meanings on hover`
  - 字幕词义卡片 hover 展示（click 可 pin）
  - 仅少量“互动词”显示下划线（不是全句每个词）
  - `EXPLAIN_WORD` 请求做 in-flight 去重

---

## 2. “网页 vs 字幕”现有上层逻辑是否两套（结论）

结论：**目前是两套上层逻辑，但共用同一套基础设施（消息通道、provider、缓存/去重框架）。**

### 2.1 网页 ENHANCE_WEB
- 后台：`ENHANCE_WEB` 使用 `buildWebEnhancePrompt`
- 输出：`WebEnhanceOutput`
  - `content_result`（整段结果）
  - `convert_word[]`（结构化重点词/替换词，用于 UI 高亮/替换）
- UI：依赖 `convert_word` 来标注重点词（不是逐词解释链路）

### 2.2 字幕 ENHANCE_SUBTITLE
- 后台：`ENHANCE_SUBTITLE` 使用 `buildSubtitleEnhancePrompt`
- 输出：`SubtitleEnhanceOutput` 只有 `line*_final`，**没有结构化关键词列表**
- UI：当前的词级交互主要来自 UI 自己拆分 + `EXPLAIN_WORD`（这不是 ENHANCE_SUBTITLE 的输出）

---

## 3. 产品方向（讨论已对齐的“目标模型”）

目标：**字幕也像网页一样通过大模型返回“重点词/词组列表”，以支持词组（phrase）优先、固定搭配等真实翻译需求，并统一调用路径。**

### 3.1 两阶段方案（核心）
- 阶段 1（快模型）：只做 **关键词/词组选择**，输出 **JSON array of strings**（不带下标；不信任 AI 下标）。
  - 允许输出词组 + 单词
  - 人名地名通过 prompt 排除
  - 我们做最小异常过滤（空、重复、超长等）
- 阶段 2（好模型）：对阶段 1 选出的项做解释/词义（或翻译/释义），用于 hover/卡片。

### 3.2 匹配与重叠策略
- 不使用 AI 下标。
- UI 侧做匹配：
  - phrase 优先、最长匹配优先
  - 允许模型返回重叠项；存储层无所谓，但渲染层避免重复高亮。

### 3.3 性能/体验策略
- 字幕必须“实时”：字幕文本先显示（原文/增强句），模型工作异步进行（progressive enhancement）。
- Prefetch：**预读 15 秒窗口**（约 4 句话）：
  - 对当前播放时间 ~ +15s 的 cues 做阶段 1（关键词/词组抽取）
  - 已确认：阶段 2 对该 15s 窗口内**全部关键词**做预读（体验优先；后续根据效果再调优/限流）
- 并发：用户希望按“渠道/模型”配置最大并发（允许较大默认值，用户自行调节）：
  - 推荐 key：`baseUrl + model`（或等价：模型级并发限制）

---

## 4. 待确认点（已经对齐到什么程度）

已对齐：
- 阶段 1 关键词输出：JSON array（字符串数组）
- 不做下标输出（不信任 AI 逻辑定位）
- 人名地名 prompt 排除；我们只做异常兜底
- 预读 15 秒（约 4 句话）
- 阶段 2 预取策略：15s 窗口内关键词**全部预读**（体验优先）
- 标点/撇号：交由模型在关键词输出中决定；客户端不做标点规则判断（仅做异常过滤 + 匹配）
- 并发按 `baseUrl+model`（或模型级）配置，默认可激进

仍可留待实现前最后确认：
- 匹配细节：是否要求“单词边界（word boundary）”来避免子串误匹配（见下方术语说明）
- UI 展示策略：高亮密度控制（避免“全句都像链接”）

### 术语说明：单词边界（word boundary）
这里的“单词边界”指的是：当我们把模型输出的关键词/词组在原句中做字符串匹配时，是否要求它必须作为一个“完整的词/词组”出现，而不是作为其它单词的子串出现。

例子：
- 关键词是 `he` 时，如果不要求边界，可能会错误命中 `the` 中的 `he`。
- 关键词是 `at` 时，如果不要求边界，可能会错误命中 `late` 中的 `at`。

实现上不一定要用复杂的标点规则；常见做法是仅检查命中片段左右两侧是否为英文字母（`A-Z/a-z`），从而避免大多数子串误匹配。

---

## 5. 分阶段实施计划（用户允许“修改代码”后执行）

> 每个阶段结束必须有一个独立 commit（Conventional Commits）。

### Phase 1 — 抽象“文本片段增强”动作（web + subtitle 统一入口）
- 抽一个共享的 orchestrator：输入（文本片段/语言/等级/场景）→ 输出（统一结构）
- 保持原有消息类型可用（先做适配层，不破坏已有功能）
- Commit: `refactor(extension): extract segment enhancement pipeline`

### Phase 2 — 新增 Stage 1 关键词/词组抽取（字幕用）
- 新增消息类型或扩展现有通道，提供“关键词抽取”API（快模型）
- Prompt：返回 JSON array（不带空格/无多余字段），排除人名地名，支持词组+单词
- 输出过滤：trim / 去重 / 丢弃空值/超长
- Commit: `feat(extension): add subtitle keyword selection (stage 1)`

### Phase 3 — UI 匹配与高亮（词组优先、最长优先）
- 实现确定性匹配策略（不靠 AI 下标）
- 重叠处理：最长优先；避免重复包裹 DOM
- 保持 Trusted Types safe（DOM API）
- Commit: `feat(extension): highlight subtitle phrases via matching`

### Phase 4 — Stage 2 解释（好模型）+ Prefetch 15s
- 解释对象支持“词组”（不仅是单词）
- 按 15s 窗口预取（阶段 1/2 任务队列、去重、可取消）
- hover/click 仍然按需兜底（未命中缓存时请求）
- Commit: `feat(extension): prefetch subtitle phrase explanations (stage 2)`

### Phase 5 — 并发控制（按 baseUrl+model / 模型级）
- Settings 增加并发配置结构
- 队列调度器按配置限制并发（阶段 1/2 可共享或分开）
- Options UI 增加高级设置项（或先隐藏但可写入）
- Commit: `feat(options): configure per-model concurrency limits`

### Phase 6 — 测试与文档
- 单测：关键词输出解析、去重、匹配、重叠、队列并发/取消
- 文档：说明字幕两阶段、prefetch 15s、并发设置含义
- Commit: `test(extension): cover keyword matching and prefetch`

---

## 6. 风险提示
- 字幕 cues 可能非常多（上千）；必须严格控制为“窗口预取”，避免全量处理。
- 并发默认值过高可能触发 provider 限流/429；需允许用户调整并保留后续优化空间。
- 不信任 AI 下标是正确方向；但匹配策略必须足够稳健处理标点/大小写/重复出现。


## 补充（与“标点/撇号交给模型判断”不冲突）：
- 不建议直接用 JS 正则的 `\b` 当边界：它的“word char”定义包含 `_`，而且像 `don't` 这种带撇号的词会出现不符合直觉的边界切分。
- 建议实现为：命中后只检查“命中片段左右两侧”是否是字母/数字（英文场景即可），从而避免 `he` 命中 `the` 这类子串误匹配。
- 对撇号（`'`/`’`）不做规则清洗；如果模型输出带撇号，就按原样匹配；必要时只做最小字符归一（例如把 `’` 统一成 `'`）以提高命中率。
