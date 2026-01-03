# Subtitle Controller 重构计划

## 进度记录（Implementation Notes）

- Phase 1-3：✅ 已完成（Provider 接口 + 工厂 + YouTube/Bilibili Provider 落地）
- Phase 4：🔄 进行中（抽离共享上层模块，简化 `SubtitleController`）
- Phase 5：⏳ 计划中（可选优化：常量抽取 / i18n / 进一步性能收敛）

### 本轮 Phase 4/5 目标（This Round）

- 新增/抽离共享模块（上层复用）：
  - `VideoSync`：负责视频时间驱动的 cue index 同步（RAF loop + 二分/局部查找）
  - `SubtitleEnhancer`：负责字幕增强 pipeline（并发、bilingual on-demand、缓存/去重）
- `SubtitleController` 保持“编排层”：连接 provider ↔ sync ↔ enhancer ↔ overlay ↔ 交互/预取

## 背景

当前 `subtitle-controller.ts` 存在架构问题，需要重构以支持多平台扩展和代码复用。

---

## 核心目标：复用与解耦

### 当前问题

`SubtitleController` 混合了多个职责：
- 平台检测
- 字幕获取（YouTube/Bilibili 各自的逻辑硬编码在一起）
- 字幕增强（LLM 调用）
- 视频同步
- Overlay 渲染
- 单词卡片交互
- 预取逻辑

### 目标架构

```
SubtitleController (共享核心)
    ├── SubtitleOverlay (渲染) - 已分离
    ├── VideoSync (时间同步)
    ├── SubtitleEnhancer (LLM增强)
    └── SubtitleProvider (接口)
            ├── YouTubeProvider
            ├── BilibiliProvider
            └── (未来可扩展: Netflix, Coursera...)
```

**核心思路**：共享上层字幕实现（增强、同步、渲染、交互），不同网站采用不同的字幕获取逻辑。

---

## 涉及的文件

| 文件路径 | 说明 |
|---------|------|
| `apps/extension/src/content/subtitle-controller.ts` | 字幕控制器主文件，存在架构耦合问题 |
| `apps/extension/src/content/subtitle-overlay.ts` | 字幕渲染层（已分离，无需修改） |
| `apps/extension/src/content/index.ts` | Content Script 入口 |
| `packages/subtitles/src/bilibili/index.ts` | B站字幕适配器，API 返回空 URL |
| `packages/subtitles/src/youtube/index.ts` | YouTube 字幕适配器 |
| `packages/subtitles/src/index.ts` | 字幕包导出 |

---

## 确认的代码问题

### 1. 架构耦合（高优先级）

**文件**：`apps/extension/src/content/subtitle-controller.ts`

YouTube 特有逻辑散落在 SubtitleController 各处：

| 行号 | 代码 |
|-----|------|
| 106-108 | `youtubeAdditionalParams`、`youtubeParamsWatchToken`、`lastYouTubeCaptionsKickAt` |
| 112 | `youtubeCaptionHideStyle` |
| 154-183 | `setYouTubeNativeCaptionsHidden()` |
| 185-212 | `kickYouTubeCaptionsRequest()` |
| 214-248 | `tryGetYouTubeAdditionalParams()` |
| 250-282 | YouTube 消息监听 |
| 395-415 | YouTube 字幕获取分支 |
| 449-469 | `startYouTubeParamsWatch()` |

Bilibili 逻辑集中在 416-440 行。

**解决方案**：抽取 `SubtitleProvider` 接口，YouTube 和 Bilibili 各自实现。

### 2. 线性搜索（中优先级）

**文件**：`apps/extension/src/content/subtitle-controller.ts:623-625`

**问题**：
- `syncSubtitle()` 使用 `findIndex` 遍历所有字幕，O(n) 复杂度
- 每帧执行（60fps = 每秒60次）
- 字幕已按时间排序，但没有利用这个特性

**解决方案**：
1. **二分查找**：利用字幕按时间排序的特性，O(log n)
2. **局部搜索优先**：连续播放时，先检查当前/下一个字幕是否仍然有效，无效再 fallback 到二分查找

**预期收益**：
- 1000 条字幕：从 ~1000 次比较 → ~10 次比较
- 连续播放时：O(1)~O(2)，几乎零开销

### 2.1 预取窗口查找（低优先级）

**文件**：`apps/extension/src/content/subtitle-controller.ts:837-844`

**问题**：
- `prefetchAhead()` 从 `currentCueIndex` 开始线性遍历找窗口内的字幕
- 如果用户跳转到视频后半部分，且 `currentCueIndex` 还是旧值，需要遍历很多

**解决方案**：
- 用二分查找定位窗口起始位置（找到第一个 `endMs > nowMs` 的 cue）
- 然后线性收集窗口内的字幕

**预期收益**：
- 仅在跳转场景有收益
- 正常连续播放时已经是 O(1) 起步

### 3. 硬编码字符串（低优先级）

**文件**：`apps/extension/src/content/subtitle-controller.ts`

- 第410行：`'LexiPath: 请先在 YouTube 打开字幕 (CC)，我才能读取并增强字幕'`
- 第680行：`'（翻译加载中…）'` / `'(Loading translation...)'`

### 4. 魔法数字（低优先级）

**文件**：`apps/extension/src/content/subtitle-controller.ts`

以下数字重复出现但未定义常量：
- `800` - 慢日志阈值（出现3次）
- `1500` - debounce 时间（出现3次）
- `10_000` - 重试间隔

---

## 待解决问题

### B站字幕不可用

**文件**：`packages/subtitles/src/bilibili/index.ts`

状态：**已定位问题**

#### 调试结果

控制台日志：
```
[LexiPath] Content script initialized
[LexiPath] Detected video platform: bilibili
[SubtitleController] Video info: Object
[SubtitleOverlay] Mounted successfully
[SubtitleController] No subtitle tracks found    <-- 关键
[SubtitleController] Initialized successfully
[LexiPath] Subtitle controller initialized
```

**结论**：代码流程正常执行，但 `getAvailableTracks()` 返回空数组。

#### 问题根因（已确认）

B站 API (`x/player/v2`) **需要登录Cookie** 才能返回字幕列表：

| 请求状态 | `need_login_subtitle` | `subtitles` |
|---------|----------------------|-------------|
| 无Cookie | `true` | `[]` 空数组 |
| 有Cookie | `false` | 完整字幕列表 |

原代码中 `fetch` 请求未携带 `credentials: 'include'`，导致跨域请求不发送Cookie。

#### 修复方案（已完成 ✅）

在 `packages/subtitles/src/bilibili/index.ts` 的 fetch 请求中添加 `credentials: 'include'`：

```typescript
const response = await fetch(url, {
  method: 'GET',
  headers: { Accept: 'application/json' },
  credentials: 'include',  // 携带B站登录Cookie
});
```

已修复位置：
- `getCid()` 函数（第83-87行）
- `getAvailableTracks()` 函数（第159-163行）

#### 字幕轨道选择逻辑

B站 API 会返回多种字幕（CC字幕 + AI字幕），扩展按以下优先级选择**单个轨道**：

```typescript
// subtitle-controller.ts:430-436
const desired = this.settings.targetLanguage.toLowerCase();
const preferred =
  tracks.find(t => t.languageCode === desired) ??           // 1. 精确匹配
  tracks.find(t => t.languageCode.startsWith(`${desired}-`)) ?? // 2. 前缀匹配
  tracks.find(t => t.languageCode.includes(desired));       // 3. 包含匹配
const track = preferred || tracks[0];  // 4. 否则用第一个
```

**示例**：B站返回 `zh-CN`、`en-US`、`ai-zh` 三个字幕时：

| 用户设置 `targetLanguage` | 选中轨道 |
|--------------------------|---------|
| `en` | `en-US` (前缀匹配) |
| `zh` | `zh-CN` (前缀匹配，优先于 `ai-zh`) |
| `ai-zh` | `ai-zh` (精确匹配) |

**结论**：
- CC字幕和AI字幕格式相同（`{ body: [{ from, to, content }] }`），无需额外适配
- 当存在 CC 字幕时，AI字幕 (`ai-zh`) 会被排在后面
- 修复 `credentials: 'include'` 后，两种字幕都可正常获取和解析

---

## 重构步骤（草案）

### Phase 1: 定义 Provider 接口

```typescript
interface SubtitleProvider {
  platform: Platform;

  // 初始化（平台特有设置）
  init(url: string, settings: Settings): Promise<void>;

  // 获取字幕
  fetchSubtitles(): Promise<Cue[]>;

  // 平台特有的原生字幕处理
  hideNativeCaptions?(): void;
  showNativeCaptions?(): void;

  // 清理
  destroy(): void;
}
```

### Phase 2: 抽取 YouTubeProvider

将 YouTube 特有逻辑移出 SubtitleController：
- webRequest 拦截参数获取
- CC 按钮触发
- 原生字幕隐藏样式

### Phase 3: 实现/修复 BilibiliProvider

- 调试当前 B站 字幕获取问题
- 实现 BilibiliProvider

### Phase 4: 简化 SubtitleController

移除平台特有逻辑后，SubtitleController 只保留：
- 字幕增强
- 视频同步
- Overlay 渲染
- 单词交互
- 预取逻辑

### Phase 5: 优化（可选）

- 二分查找优化 syncSubtitle
- 抽取常量
- i18n 硬编码字符串

---

## 未实现功能清单

### 1. 站点白名单/黑名单（中优先级）

**文档位置**：PM 3.5, PLAN 3.2

**需求**：
- 站点级门控：先判断当前站点是否允许处理
- 支持"默认处理除禁用站点外所有" vs "只处理白名单站点"
- popup 提供当前站点状态、模式切换控制入口

**当前状态**：⚠️ 部分实现

| 组件 | 状态 | 位置 |
|-----|------|------|
| 核心门控逻辑 | ✅ | `packages/core/src/qualify/site.ts` - `qualifySite()` |
| 站点匹配算法 | ✅ | 支持主机名、路径前缀、通配符等 |
| 类型定义 | ✅ | `siteMode`, `excludedSites`, `allowedSites` |
| Options UI | ✅ | `Options.tsx` - `siteMode` 切换 |
| Content Script 门控 | ❌ | `content/index.ts:565` 只检查 `enabled`，未调用 `qualifySite()` |

**待实现**：
- [ ] Content Script 中调用 `qualifySite()` 进行站点门控检查
- [ ] Popup 中的当前站点状态显示与快速切换 UI（可选）

### 2. 深入对话（侧边栏）

**文档位置**：PM 3.3, PLAN 3.5

**当前状态**：✅ **已完整实现**

| 功能 | 状态 | 实现位置 |
|-----|------|---------|
| 续聊 id 机制 | ✅ | `background/index.ts:634` `generateSessionId()` |
| 历史截断 | ✅ | `background/index.ts:632` `CHAT_MAX_HISTORY_MESSAGES = 20` |
| 过期清理 | ✅ | `background/index.ts:631` `CHAT_SESSION_TTL_MS = 1小时` |
| 会话数量限制 | ✅ | `background/index.ts:630` `CHAT_SESSION_MAX_COUNT = 10` |

### 3. 字幕平台扩展（低优先级）

**文档位置**：PLAN 3.3

| 平台 | 状态 |
|-----|------|
| YouTube | ✅ |
| Bilibili | ✅ 已修复（需登录Cookie） |

### 4. Provider 扩展（低优先级）

**文档位置**：PLAN 5.2

| Provider | 状态 |
|---------|------|
| OpenAI-compatible | ✅ |
| Gemini | ❌ 未实现 |
| Claude | ❌ 未实现 |



---

## 备注

- YouTube 的上层字幕实现目前运行良好，可作为共享核心的参考
- 重构时需要保持 YouTube 功能不退化
