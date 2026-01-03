# 已完成

# 字幕预加载排查 — 交接总结

本文档用于总结近期围绕 LexiPath 的 **字幕关键词选择（Stage 1）** 与 **词/词组解释预加载（Stage 2）** 的讨论与排查结论，给后续新对话/新模型提供上下文。

## 场景与约束（我们已对齐的前提）

- 目标场景：**YouTube 字幕**，信息流非常快。仅靠“用户 hover/click 时现请求”体验必然跟不上，因此 **解释必须预加载**，否则字幕一闪而过。
- 产品偏好：**相信模型语义判断**。
  - 不要先用前端硬规则做强过滤（例如 stopwords 白名单/黑名单、每条强行限制关键词数量等）。
  - 可以在提示词里加“软约束”（例如“不要返回明显低于该等级的基础词、数字、功能词”），但不要把主要策略做成硬编码规则。
- 输出格式：
  - Stage 1：只输出 JSON 数组（string array），每个元素是原文中出现的 **词或短语（短语优先）**。
  - Stage 2：输出 JSON 对象（字段尽量少、尽量规整），用于词卡展示。
- Git 要求：
  - 使用 Conventional Commits，按阶段提交。
  - **本次排查期间**用户要求：在 bug 修好之前不要继续提交（历史上已经有调试提交存在，但后续新对话按该要求执行）。

## 当前实现的核心抽象（重要心智模型）

### Stage 1：`SELECT_KEYWORDS`

- 输入：单条字幕 cue（或一句话）。
- 输出：JSON array（关键词/短语）。
- 用途：
  - 字幕 overlay 的高亮/可交互词（或短语）集合。
  - Stage 2 的预加载目标来源。

### Stage 2：`EXPLAIN_WORD`

- 输入：一个词或一个词组 +（可选）上下文句子。
- 输出：结构化解释（翻译/释义/音标/例句等），用于词卡展示。
- 用途：
  - hover/click 词卡。
  - 预读缓存（保证实时场景可用）。

### 预加载窗口策略

- 预读窗口：**向前 15 秒**（用户已确认）。
- 期望：随着 cue 变化持续滚动预读，而不是等用户点了才开始。

## 排查过程中得到的事实（来自真实日志）

1. 没出现 background 侧 “provider concurrency saturated/wait” 的日志，说明至少在“后台并发闸门”这一层没有明显排队。
2. content 侧日志显示：
   - `SELECT_KEYWORDS` 有时会慢到 **数秒甚至更久**（不同运行阶段波动大）。
   - 早期的预读逻辑存在缺陷：会等待预读窗口内所有 cue 的 Stage 1 全部结束（例如 `Promise.all`），导致 cue 往前走时频繁出现 `Prefetch aborted (token changed)`，从而 Stage 2 根本来不及启动。
3. 修正调度后：
   - 能看到 Stage 2 开始执行（例如 `Prefetch EXPLAIN_WORD start ...`）。
   - 但 Stage 2 的队列仍可能堆积（例如 `Prefetch queue saturated ... queued=N`），于是用户体感仍会“hover 等待”。
4. 用户手动在 provider 里测试 Stage 2（`EXPLAIN_WORD`）提示词：**单次只要 ~5 秒**。
   - 这意味着：最差的体验不一定是“模型推理必须很慢”，而更可能是 **预加载/排队/优先级/取消策略**导致“用户需要的那个词还没被预读到”。

## 最新结论（强证据）：慢的根因是“thinking/深度思考”默认开启

我们用一个独立的基准脚本把“扩展侧调度/并发”变量剥离掉，直接测同一个网关同一个模型的请求耗时。结果显示：

- **同样的 Stage 1 / Stage 2 提示词**，当请求里显式 `thinking.type=disabled` 后，耗时从 **7–18 秒级**直接降到 **0.5–1.8 秒级**。
- 因而：扩展里看到的 Stage1/Stage2 “很慢”，并不是网络链路或纯排队问题，而是 **服务端/网关把模型跑在深度思考模式（thinking enabled / auto）**导致的推理时延。

### 证据 1：baseline（极短请求 tiny）并不慢

在同一台网关（`http://10.126.126.5:3000`）上，`tiny` 请求（几乎不生成内容）耗时在 1s 级：

复现命令（不包含密钥；密钥用环境变量传入）：

```
python lexipath/apps/extension/plan/llm_benchmark.py --base-url http://10.126.126.5:3000 --model doubao-seed-1-6-flash --scenario tiny --runs 10 --concurrency 1
```

```
Scenario=tiny Runs=10 Concurrency=1 TimeoutMs=30000
Latency ms: min=832 p50=986 p90=1309 p95=1459 avg=1070 max=1459
```

说明网络/网关本身不“普遍慢”，慢主要来自实际业务 prompt 对应的推理路径。

### 证据 2：Stage 1（keyword）在 thinking 未关闭时非常慢

同样的 keyword prompt，`--disable-thinking` 之前（默认）实测：

复现命令：

```
python lexipath/apps/extension/plan/llm_benchmark.py --base-url http://10.126.126.5:3000 --model doubao-seed-1-6-flash --scenario keyword --runs 10 --concurrency 1 --timeout-ms 30000
```

```
Scenario=keyword Runs=10 Concurrency=1 TimeoutMs=30000
Latency ms: min=6123 p50=7536 p90=15587 p95=18126 avg=9517 max=18126
```

这足以解释为什么“预读 15s”在实际体验里顶不住：**Stage 1 单次经常就超过 15s**。

### 证据 3：显式关闭 thinking 后，Stage 1 / Stage 2 立刻变快

使用 Ark/火山兼容的请求字段：

- `thinking: { type: "disabled" }`
- 并用 `messages[].content` 的 parts 格式（`[{type:"text", text:"..."}]`）发请求

Stage 1（keyword）变为 <1s：

复现命令：

```
python lexipath/apps/extension/plan/llm_benchmark.py --base-url http://10.126.126.5:3000 --model doubao-seed-1-6-flash --scenario keyword --runs 5 --concurrency 1 --disable-thinking --content-format parts
```

```
Scenario=keyword Runs=5 Concurrency=1 TimeoutMs=30000
Latency ms: min=487 p50=632 p90=727 p95=727 avg=629 max=727
```

Stage 2（explain）变为 ~1.6s：

复现命令：

```
python lexipath/apps/extension/plan/llm_benchmark.py --base-url http://10.126.126.5:3000 --model doubao-seed-1-6-flash --scenario explain --runs 5 --concurrency 1 --disable-thinking --content-format parts
```

```
Scenario=explain Runs=5 Concurrency=1 TimeoutMs=30000
Latency ms: min=1478 p50=1569 p90=1768 p95=1768 avg=1595 max=1768
```

并且输出内容质量正常（keyword 返回 JSON array，explain 返回 JSON object）。

### 推论：扩展内“预读策略/并发”不是第一优先级瓶颈

在 thinking 未关闭时：

- Stage 1 p50≈7.5s、p95≈18s
- Stage 2 p50≈8–12s（之前实测）

即使调度完美、并发充足，也很难保证 15s lookahead 场景下 hover 即时命中。

而在 thinking 关闭后：

- Stage 1/2 的单次请求稳定进入 0.5–2s 区间

此时再去优化“预读算法/队列/抢占”，才有意义（能真正把 hover 体验做到接近即时）。

## 当前核心问题（新对齐）

- “单词一定要预加载，因为字幕非常快。”
- 主要怀疑点：**预加载逻辑有问题（排队/取消/优先级/策略）**，而不是简单归因“模型慢”。
- 目标：在用户 hover/click 时，尽可能从缓存命中（或至少等待极短）。

## 下一轮对话建议重点验证的假设

1. **取消/饥饿（starvation）**：cue 变化时，预读任务是否反复被取消或被更低优先级压制？
2. **队列策略不合理**：预读队列是否没有按“当前 cue/最近将出现 cue”优先，导致用户点的词不在队首？
3. **Stage 依赖耦合过强**：Stage 2 必须等 Stage 1 返回关键词；若 Stage 1 对某些 cue 慢，就会造成“解释目标到达太晚”。
4. **预读量过大**：短语 + 单词都进队列，导致 backlog 过大，即使单次请求 ~5 秒也会排很久。
5. **重复请求**：是否因为 cache key/context 变化导致同一词被重复解释、同一 cue 被重复选词？

## 相关代码位置（后续定位入口）

- 字幕预读、队列、缓存（content）：
  - `lexipath/apps/extension/src/content/subtitle-controller.ts`
- 消息处理与并发闸门（background）：
  - `lexipath/apps/extension/src/background/index.ts`
- 提示词（providers）：
  - `lexipath/packages/providers/src/prompts/keyword-select-prompt.ts`
  - `lexipath/packages/providers/src/prompts/explain-word-prompt.ts`

## 下一步行动建议（供新对话制定计划）

1. 明确定义字幕成功指标（可量化）：
   - 例如：对“高亮词/短语”，hover 词卡 **缓存命中率**、以及未命中时 **最大等待时间**。
2. 增加可观测性：
   - cue 进入时间 → Stage 1 返回 → Stage 2 缓存写入 的耗时链路统计。
   - 队列长度随时间变化、取消次数、hover 命中率。
3. **优先修正：在 provider 请求体里显式关闭 thinking**
   - 对 Ark/火山兼容：加入 `thinking: { type: "disabled" }`。
   - 同时确认服务端对 `messages[].content` 是否要求 parts 格式（如果是，需要用 `[{type:"text", text:"..."}]`）。
   - 目标是把 Stage 1/2 的 p95 拉回到 2s 左右，再评估 15s/30s lookahead 是否需要调整。
4. 调整预读策略（以用户体验优先）：
   - 预读优先级：当前 cue > 未来 15 秒 cue > 更远。
   - hover/click 应该具备“抢占”能力（即时插队/更高优先级）。
   - 如果单条解释仍无法满足体验，考虑 Stage 2 批量解释（一次请求返回多项 JSON array）。
5. 词典加速（后续议题）：
   - 讨论离线词典作为快路径（尤其是单词/常见词组），模型作为兜底。
   - 需要评估数据授权（license）与包体大小限制后再实施。
