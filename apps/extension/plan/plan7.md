# 已完成
# PLAN-7: 字幕 Phase 4/5（上层共享模块抽离）

说明：
- 不修改现有 `plan4.md` / `plan5.md`（视为作者已完成的计划文档）。
- 本计划只覆盖 PLAN-4 的 Phase 4/5：整理项目结构，抽离字幕“上层共享”模块，简化 `SubtitleController`，保持行为不变。

---

## 目标

- 把 `SubtitleController` 从“巨型类”收敛为“编排层”（orchestrator）。
- 把可复用的“上层共享逻辑”抽离成独立模块，便于后续扩展平台与测试。

---

## 涉及文件（本轮）

- 现有：
  - `apps/extension/src/content/subtitle-controller.ts`
- 新增：
  - `apps/extension/src/content/subtitle-video-sync.ts`
  - `apps/extension/src/content/subtitle-enhancer.ts`

---

## 非目标（本轮不做）

- PLAN-5 的“DEVELOPMENT.md 对齐缺口收敛”各项：协议 schema、权限收紧、Options 测试连接迁移、chat 持久化、AbortController 真正取消等。
- 大范围目录重命名/跨层移动（只做最小必要的抽离）。

---

## 结构设计（对齐 plan4 的目标架构）

`SubtitleController`（共享核心/编排层）
- Provider 生命周期（init/fetch/destroy）
- Overlay 渲染与交互（模式切换、word card）
- 关键词预取 pipeline
- 平台字幕按钮监听（CC/字幕开关）与 overlay 显隐同步

抽离模块：

1) `SubtitleVideoSync`（对应 plan4 的 VideoSync）
- 负责 RAF loop 与“当前 cue index”计算
- 复用现有优化策略：
  - fast path：current / next / prev cue 检查
  - fallback：二分查找
- 对外暴露：
  - `start()` / `stop()`
  - `setCues(cues)` / `setVideo(video)`
  - `getCurrentCueIndex()`
  - `onCueIndexChange(index)` 回调

2) `SubtitleEnhancer`（对应 plan4 的 SubtitleEnhancer）
- 负责增强队列、并发控制、in-flight 去重、bilingual on-demand
- 不直接依赖 `sendMessage`：通过注入回调保持解耦
- 对外暴露：
  - `setCues(cues, { generationToken, subtitleLanguage })`（cues 变化时重置）
  - `start()` / `stop()`（stop 只阻止调度新任务，不强制 cancel in-flight）
  - `getEnhanced(cueId)`
  - `ensureBilingual(cue)`

---

## 实施步骤（必须按顺序）

1. 新增 `subtitle-video-sync.ts`（只抽离，不改行为）
2. 新增 `subtitle-enhancer.ts`（只抽离，不改行为）
3. 重构 `SubtitleController`：
   - 删除内部 sync/enhance 相关状态与方法，改为调用模块
   - 保持现有对 overlay/provider 的调用时机不变
4. `bun run typecheck` 通过后再提交

---

## 手工验收建议（抽离后必做）

- YouTube：
  - cue 跟随播放变化
  - 单语/双语切换正常
  - hover/click word card 正常
  - 关闭 CC 后 overlay 立即隐藏
- Bilibili：
  - cue 跟随播放变化
  - 关闭字幕按钮后 overlay 隐藏
  - 多 P（`?p=`）字幕仍能正确对齐

