# PLAN-11: 平台配置系统与场景化翻译策略

**状态：设计讨论完成，待实施**
**日期：2026-01-05**

---

## 背景

通过分析沉浸式翻译的网站适配机制，发现针对不同平台和场景使用专用的翻译策略和 Prompt 可以显著提升翻译质量。当前 LexiPath 使用统一的字幕翻译 Prompt，缺乏针对不同内容类型的优化。

---

## 核心思路

**配置驱动的平台特定翻译策略：**

- 不同视频平台（YouTube、Coursera、Bilibili）使用不同的翻译配置
- 不同内容类型（娱乐、学术、动漫）使用不同的 Prompt 模板
- 通过配置注入的方式构造最终的提示词
- 保持灵活性，便于扩展和调整

---

## 设计方案

### 1. 平台配置结构

```typescript
interface PlatformConfig {
  // 平台识别
  platform: string;
  matches: string[];

  // 翻译策略
  translationConfig: {
    promptScenario: "casual" | "academic" | "entertainment" | "anime";
    batchSize: number; // 批量翻译大小
    useContext: boolean; // 是否保持字幕上下文（高级功能）
    preferredModel?: string; // 优先使用的模型
    specialRules?: string[]; // 特殊规则（如保留二次元用语）
  };

  // UI 配置
  uiConfig: {
    overlayPosition: "top" | "bottom";
    fontSize: number;
    hideNativeSubtitles: boolean;
  };
}
```

### 2. 场景配置示例

**YouTube 娱乐视频：**

- Prompt: 口语化、幽默感、保持轻松氛围
- 批量: 10 条字幕
- 上下文: 可选（高级功能）

**Coursera 学术课程：**

- Prompt: 专业术语准确、逻辑严谨、学术风格
- 批量: 5 条字幕（更精细）
- 上下文: 可选（高级功能）
- 优先模型: GPT-4（质量优先）

**Bilibili 动漫：**

- Prompt: 保留二次元用语、网络梗、角色称谓
- 批量: 10 条字幕
- 特殊规则: 保留日语拟声词、敬语系统

**TED 演讲：**

- Prompt: 演讲风格、激励性语气、保持感染力
- 批量: 8 条字幕
- 上下文: 可选（高级功能）

### 3. 实现流程

```
用户访问视频网站
    ↓
detectPlatform(url)
    ↓
加载对应的 PlatformConfig
    ↓
createSubtitleProvider(config.platform)
    ↓
获取字幕
    ↓
buildPromptWithConfig(config.translationConfig)
    ↓
调用 LLM 翻译
```

### 4. Prompt 构造方式

**当前实现：**

```typescript
buildSubtitleAdaptPrompt({
  subtitle: "...",
  sourceLang: "en",
  targetLang: "zh",
  difficultyLevel: "B1",
});
```

**扩展后：**

```typescript
buildSubtitleAdaptPrompt({
  subtitle: "...",
  sourceLang: "en",
  targetLang: "zh",
  difficultyLevel: "B1",
  scenario: "academic", // 新增：场景标识
  specialRules: ["保留专业术语"], // 新增：特殊规则
});
```

---

## 技术细节

### 1. 配置存储位置

```
apps/extension/src/content/platform-configs.ts  // 平台配置
packages/providers/src/prompts/scenarios/       // Prompt 模板
```

### 2. 配置格式

```typescript
// platform-configs.ts
export const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  "youtube-entertainment": {
    platform: "youtube",
    matches: ["https://www.youtube.com/watch*"],
    translationConfig: {
      promptScenario: "casual",
      batchSize: 10,
      useContext: false, // 默认关闭（高级功能）
    },
    uiConfig: {
      overlayPosition: "bottom",
      fontSize: 18,
      hideNativeSubtitles: true,
    },
  },

  "coursera-academic": {
    platform: "generic",
    matches: ["https://www.coursera.org/learn/*"],
    translationConfig: {
      promptScenario: "academic",
      batchSize: 5,
      useContext: false, // 默认关闭
      preferredModel: "gpt-4",
    },
    uiConfig: {
      overlayPosition: "bottom",
      fontSize: 20,
      hideNativeSubtitles: true,
    },
  },
};
```

### 3. Prompt 模板

```typescript
// prompts/scenarios/casual-subtitle.ts
export const CASUAL_SUBTITLE_PROMPT = `
你是字幕翻译助手，正在翻译娱乐视频。
请保持：
- 口语化、自然流畅
- 幽默感和轻松氛围
- 网络流行语的传达
...
`;

// prompts/scenarios/academic-subtitle.ts
export const ACADEMIC_SUBTITLE_PROMPT = `
你是学术字幕翻译助手，正在翻译教育课程。
请保持：
- 专业术语的准确性
- 逻辑的严谨性
- 学术风格和正式语气
...
`;
```

---

## 实施计划

### MVP 阶段（先验证效果）

**阶段 1：硬编码 2-3 个场景**

- YouTube 娱乐 vs Coursera 学术
- 直接在 `buildSubtitleAdaptPrompt` 中添加场景判断
- 不抽象配置系统
- **目标**：验证不同 Prompt 是否有明显效果差异

**阶段 2：效果评估**

- 对比翻译质量
- 收集用户反馈
- 决定是否继续

**阶段 3：抽象配置系统**

- 如果效果明显，实施完整的平台配置系统
- 如果效果不明显，保持简单统一的 Prompt

### 完整实施（如果 MVP 验证成功）

**Step 1：创建配置文件**

- `platform-configs.ts` - 平台配置
- `prompts/scenarios/*.ts` - Prompt 模板

**Step 2：扩展 Prompt 构造函数**

- 在 `buildSubtitleAdaptPrompt` 中添加 `scenario` 参数
- 根据场景返回不同的 Prompt 模板

**Step 3：集成到现有流程**

- 在 `subtitle-controller.ts` 中检测平台
- 加载对应配置
- 传递给翻译函数

**Step 4：UI 暴露（可选）**

- 在设置页面允许用户选择/自定义场景
- 提供 Prompt 预览和编辑功能

---

## 其他讨论的功能

### 1. 备份方案（已决策）

**结论：继续使用 JSON 备份**

- 优势：简单、可读、跨平台兼容
- 不采用 SQLite：引入复杂度、体积增加、不易调试
- 可选优化：添加 gzip 压缩、分块导出

### 2. 多服务降级（可选功能）

**功能描述：**

- OpenAI 失败 → 自动切换到 Claude
- Claude 失败 → 自动切换到 Gemini
- Gemini 失败 → 自动切换到 Google Translate

**当前状态：** 未实现（用户手动切换）

**是否实施：** 取决于用户需求

- 如果用户 API 配额用完或服务宕机希望自动切换 → 实施
- 如果手动切换即可 → 暂不实施

### 3. 请求头修改（按需实施）

**使用场景：**

- 遇到字幕 API CORS 问题时
- 需要访问有防盗链的资源时

**实现方式：**

- 使用 `declarativeNetRequest` API
- 配置 `rules.json` 文件
- 在 `manifest.json` 中引用

**当前状态：** 暂未遇到问题，按需实施

---

## YouTube 和 Bilibili 特殊适配（缺失功能）

### 当前实现状态对比

#### YouTube 已实现 ✅

1. 隐藏原生字幕 - `hideNativeCaptions()`
2. 字幕参数拦截 - `additionalParams` 机制
3. 自动点击字幕按钮 - `kickYouTubeCaptionsRequest()`
4. 参数持续监听 - `startYouTubeParamsWatch()`

#### YouTube 缺失 ❌

1. **YouTube Live 直播字幕适配**
2. **YouTube Shorts 适配**
3. **YouTube 会员字幕适配**

#### Bilibili 已实现 ✅

1. 隐藏原生字幕 - `hideNativeCaptions()`
2. 多语言轨道选择 - 智能匹配语言
3. 分P视频支持 - `cid` 处理

#### Bilibili 缺失 ❌

1. **弹幕干扰处理**（暂停/恢复弹幕）
2. **会员字幕适配**

---

### 缺失功能详解与实现方案

#### 1. YouTube Live 直播字幕适配

**问题描述：**

- 直播字幕使用不同的 API 端点
- 字幕是实时流式推送，不是预先获取的完整文件
- 需要持续拉取最新字幕片段

**沉浸式翻译的实现方式（基于文档分析）：**

```typescript
// 1. 检测是否为直播
async function checkIsLive(): Promise<boolean> {
  // 方法1：检查播放器元素
  const liveButton = document.querySelector('.ytp-live-badge');
  if (liveButton) return true;

  // 方法2：检查URL参数
  const url = window.location.href;
  return url.includes('/live/') || url.includes('&live=1');

  // 方法3：检查ytInitialPlayerResponse
  const playerResponse = window.ytInitialPlayerResponse;
  return playerResponse?.videoDetails?.isLiveContent === true;
}

// 2. 获取直播字幕
async function fetchLiveSubtitles(): Promise<SubtitleFetchResult> {
  const isLive = await this.checkIsLive();
  if (!isLive) return this.fetchSubtitles();

  // 直播字幕API端点不同
  const liveUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=track&lang=${lang}&tlang=${targetLang}&fmt=json3&live=1`;

  // 持续轮询获取新字幕
  return this.startLiveSubtitlePolling(liveUrl);
}

// 3. 轮询机制
private startLiveSubtitlePolling(url: string): void {
  const pollInterval = 2000; // 2秒拉取一次
  let lastSeqNum = 0;

  const poll = async () => {
    const response = await fetch(url);
    const data = await response.json();

    // 只处理新的字幕片段
    const newEvents = data.events?.filter(e => e.seqId > lastSeqNum) || [];
    if (newEvents.length > 0) {
      lastSeqNum = newEvents[newEvents.length - 1].seqId;
      this.processLiveSubtitles(newEvents);
    }

    if (!this.destroyed && this.isLive) {
      setTimeout(poll, pollInterval);
    }
  };

  poll();
}
```

**API 细节：**

- **端点**: `https://www.youtube.com/api/timedtext`
- **关键参数**:
  - `live=1` - 标识直播模式
  - `seqId` - 序列号，用于增量获取
- **轮询间隔**: 建议 2-3 秒

---

#### 2. YouTube Shorts 适配

**问题描述：**

- Shorts 页面结构与普通视频不同
- URL 格式为 `/shorts/{videoId}`
- 播放器元素选择器不同
- 字幕容器位置不同

**沉浸式翻译的实现方式：**

```typescript
// 1. 检测 Shorts
function detectPlatform(url: string): Platform {
  if (
    url.includes("youtube.com/shorts/") ||
    url.includes("youtube.com/short/")
  ) {
    return "youtube-shorts";
  }
  if (url.includes("youtube.com/watch")) {
    return "youtube";
  }
  // ...
}

// 2. Shorts 专用选择器
const SHORTS_SELECTORS = {
  video: "#shorts-player video",
  container: "#shorts-container",
  captionButton: 'button[aria-label*="字幕"]',
  captionContainer: "#shorts-player .caption-window",
};

// 3. Shorts 字幕覆盖层定位
function createShortsOverlay(): void {
  const container = document.querySelector("#shorts-player");
  if (!container) return;

  // Shorts 是竖屏，字幕位置需要调整
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.bottom = "120px"; // 避开操作按钮
  overlay.style.left = "50%";
  overlay.style.transform = "translateX(-50%)";
  overlay.style.width = "90%";
  overlay.style.textAlign = "center";

  container.appendChild(overlay);
}
```

**关键差异：**

- 视频元素: `#shorts-player video` (vs 普通的 `video`)
- 容器: `#shorts-container`
- 字幕位置: 更靠下（避开点赞、评论等按钮）
- 竖屏适配: 字幕宽度 90%（vs 80%）

---

#### 3. YouTube 会员字幕适配

**问题描述：**

- 部分视频的字幕需要 YouTube Premium 会员
- API 返回 403 或特殊错误码
- 需要检测用户会员状态

**沉浸式翻译的实现方式：**

```typescript
// 1. 检测会员状态
async function checkPremiumStatus(): Promise<boolean> {
  // 方法1：检查页面元素
  const premiumBadge = document.querySelector('[aria-label*="Premium"]');
  if (premiumBadge) return true;

  // 方法2：检查 ytInitialData
  const ytData = window.ytInitialData;
  return ytData?.topbar?.desktopTopbarRenderer?.isPremium === true;
}

// 2. 处理会员字幕错误
async function fetchSubtitles(): Promise<SubtitleFetchResult> {
  try {
    const cues = await fetchYouTubeSubtitles(videoId, lang, {
      additionalParams,
    });
    return { cues, lang };
  } catch (error) {
    // 检查是否为会员限制错误
    if (error.status === 403 || error.message?.includes("premium")) {
      const isPremium = await this.checkPremiumStatus();
      if (!isPremium) {
        return {
          cues: [],
          statusMessage: getI18nMessage("subtitle_requiresPremium"),
        };
      }
    }
    throw error;
  }
}

// 3. 使用用户 Cookie 获取会员字幕
async function fetchPremiumSubtitles(videoId: string): Promise<Cue[]> {
  // 需要带上用户的认证 Cookie
  const response = await fetch(subtitleUrl, {
    credentials: "include", // 关键：包含 Cookie
    headers: {
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": "2.0",
    },
  });

  if (!response.ok) {
    throw new Error("Premium subtitle access denied");
  }

  return parseSubtitleResponse(await response.text());
}
```

**API 细节：**

- **认证方式**: 使用浏览器 Cookie（`credentials: 'include'`）
- **错误码**: 403 表示需要会员权限
- **检测方法**:
  1. 页面元素 `[aria-label*="Premium"]`
  2. `ytInitialData.topbar.isPremium`

---

#### 4. Bilibili 弹幕干扰处理

**问题描述：**

- 弹幕会遮挡字幕，影响阅读
- 需要在显示字幕时自动暂停弹幕
- 字幕消失后恢复弹幕

**沉浸式翻译的实现方式（基于文档）：**

```typescript
// 1. 获取弹幕控制器
private danmuController: any = null;

function getDanmuController(): any {
  // 方法1：从播放器实例获取
  const player = (window as any).player;
  if (player?.danmaku) return player.danmaku;

  // 方法2：从 DOM 查找
  const danmuEl = document.querySelector('.bilibili-player-video-danmaku');
  if (danmuEl && (danmuEl as any).__danmaku__) {
    return (danmuEl as any).__danmaku__;
  }

  return null;
}

// 2. 暂停弹幕
function pauseDanmu(): void {
  const controller = this.getDanmuController();
  if (!controller) return;

  // 隐藏所有弹幕元素
  const danmuElements = document.querySelectorAll('.bilibili-player-video-danmaku-item');
  danmuElements.forEach(el => {
    (el as HTMLElement).style.display = 'none';
  });

  // 暂停弹幕渲染
  if (typeof controller.pause === 'function') {
    controller.pause();
  }
}

// 3. 恢复弹幕
function resumeDanmu(): void {
  const controller = this.getDanmuController();
  if (!controller) return;

  // 显示弹幕元素
  const danmuElements = document.querySelectorAll('.bilibili-player-video-danmaku-item');
  danmuElements.forEach(el => {
    (el as HTMLElement).style.display = '';
  });

  // 恢复弹幕渲染
  if (typeof controller.resume === 'function') {
    controller.resume();
  }
}

// 4. 字幕显示时自动管理弹幕
function onSubtitleShow(subtitleText: string): void {
  this.pauseDanmu();

  // 字幕持续时间后恢复弹幕
  setTimeout(() => {
    this.resumeDanmu();
  }, 3000); // 3秒后恢复
}
```

**关键选择器：**

- 弹幕容器: `.bilibili-player-video-danmaku`
- 弹幕元素: `.bilibili-player-video-danmaku-item`
- 播放器实例: `window.player.danmaku`

**实现策略：**

1. 字幕出现 → 隐藏所有弹幕 + 暂停渲染
2. 3秒后（或字幕消失后）→ 恢复弹幕
3. 优化：可以只隐藏字幕区域的弹幕（底部 20%）

---

#### 5. Bilibili 会员字幕适配

**问题描述：**

- 部分番剧、影视剧需要大会员
- 字幕 API 返回需要登录/会员的错误
- 需要检测用户会员状态

**沉浸式翻译的实现方式：**

```typescript
// 1. 检测会员状态
async function checkVipStatus(): Promise<boolean> {
  // 方法1：检查 __INITIAL_STATE__
  const initialState = (window as any).__INITIAL_STATE__;
  const userInfo = initialState?.userInfo;

  if (userInfo) {
    // vipType: 0=普通, 1=月度大会员, 2=年度大会员
    return userInfo.vipType > 0;
  }

  // 方法2：检查页面元素
  const vipBadge = document.querySelector(".vip-info");
  return Boolean(vipBadge);
}

// 2. 获取会员字幕
async function fetchSubtitles(): Promise<SubtitleFetchResult> {
  try {
    const tracks = await getBilibiliAvailableTracks(bvid, cid);
    if (tracks.length === 0) {
      // 检查是否需要会员
      const requiresVip = await this.checkIfRequiresVip();
      if (requiresVip) {
        const isVip = await this.checkVipStatus();
        if (!isVip) {
          return {
            cues: [],
            statusMessage: getI18nMessage("subtitle_requiresVip"),
          };
        }
      }
    }

    // 使用用户 Cookie 获取字幕
    const cues = await fetchBilibiliSubtitles(trackUrl, {
      credentials: "include", // 带上登录 Cookie
    });

    return { cues, lang: track.languageCode };
  } catch (error) {
    // 处理会员限制错误
    if (error.code === -403 || error.message?.includes("大会员")) {
      return {
        cues: [],
        statusMessage: getI18nMessage("subtitle_requiresVip"),
      };
    }
    throw error;
  }
}

// 3. 检查是否需要会员
async function checkIfRequiresVip(): Promise<boolean> {
  // 检查视频信息中的付费标识
  const initialState = (window as any).__INITIAL_STATE__;
  const videoData = initialState?.videoData;

  return (
    videoData?.rights?.is_cooperation === 1 || // 联合投稿
    videoData?.rights?.pay === 1
  ); // 付费内容
}
```

**API 细节：**

- **会员检测**: `window.__INITIAL_STATE__.userInfo.vipType`
  - 0 = 普通用户
  - 1 = 月度大会员
  - 2 = 年度大会员
- **字幕 API**: 需要 `credentials: 'include'` 携带登录态
- **错误码**: `-403` 表示需要大会员

---

### 实施优先级

**高优先级（影响用户体验）：**

1. ✅ **Bilibili 弹幕处理** - 弹幕遮挡字幕严重影响体验
2. ✅ **YouTube Shorts** - Shorts 流行，用户需求高

**中优先级：** 3. ⚠️ **YouTube Live** - 直播场景有一定需求

**低优先级：** 4. ❌ **YouTube 会员字幕** - 需要用户订阅 Premium，场景较少 5. ❌ **Bilibili 会员字幕** - 需要大会员，场景较少

---

### 技术要点总结

#### YouTube Live

- **检测方式**: URL 包含 `/live/` 或 `ytInitialPlayerResponse.isLiveContent`
- **API 端点**: `api/timedtext?live=1`
- **关键技术**: 轮询机制（2-3秒间隔），`seqId` 增量获取

#### YouTube Shorts

- **检测方式**: URL 包含 `/shorts/`
- **选择器差异**: `#shorts-player video`, `#shorts-container`
- **UI 调整**: 竖屏适配，字幕位置更靠下

#### Bilibili 弹幕

- **控制器**: `window.player.danmaku` 或 DOM 元素的 `__danmaku__` 属性
- **操作**: `pause()` / `resume()` 方法
- **选择器**: `.bilibili-player-video-danmaku-item`

#### 会员检测

- **YouTube**: `ytInitialData.topbar.isPremium`
- **Bilibili**: `__INITIAL_STATE__.userInfo.vipType`
- **关键**: `credentials: 'include'` 携带 Cookie

---

## 流媒体平台扩展支持（Netflix、Disney+等）

### 沉浸式翻译支持的流媒体平台

根据 `default_config.json` 中的 `supportedVideoSubtitleSites`，沉浸式翻译支持 **100+ 视频字幕网站**，主要包括：

**主流流媒体：**

- Netflix
- Disney+
- Prime Video (Amazon)
- HBO Max / HBO GO
- Hulu
- Paramount+

**教育平台：**

- Coursera
- Udemy
- Khan Academy
- edX
- Skillshare
- MasterClass

**视频平台：**

- YouTube (已支持)
- Bilibili (已支持)
- TikTok
- Vimeo
- Dailymotion

**其他：**

- TED
- BBC
- Bloomberg
- LinkedIn Learning
- 等 100+ 平台

---

### 平台分类与技术挑战

#### 1. DRM 加密平台（高难度）

**平台：**

- Netflix
- Disney+
- HBO Max
- Prime Video

**技术挑战：**

1. **DRM 保护**
   - Widevine / PlayReady 加密
   - 字幕嵌入在加密流中
   - 无法直接访问字幕 API

2. **字幕获取方式**
   - 需要拦截播放器内部的字幕流
   - 或使用 OCR 识别屏幕字幕（低精度）

3. **法律风险**
   - 绕过 DRM 可能违反 DMCA
   - 仅供学习用途

**沉浸式翻译的实现方式（推测）：**

```typescript
// 方法1：拦截 manifest 文件（Netflix）
class NetflixSubtitleProvider implements SubtitleProvider {
  async fetchSubtitles(): Promise<SubtitleFetchResult> {
    // Netflix 使用 TTML 格式嵌入在 manifest 中
    const manifest = await this.interceptManifest();
    const ttmlUrl = this.extractSubtitleUrl(manifest);

    if (ttmlUrl) {
      const ttml = await fetch(ttmlUrl).then((r) => r.text());
      const cues = parseTTML(ttml);
      return { cues, lang: "en" };
    }

    // Fallback: 使用 MutationObserver 监听 DOM 字幕
    return this.observeDOMSubtitles();
  }

  // 监听 Netflix 播放器字幕容器
  private observeDOMSubtitles(): SubtitleFetchResult {
    const subtitleContainer = document.querySelector(".player-timedtext");
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const textNode = mutation.target.textContent;
        if (textNode) {
          this.onSubtitleUpdate(textNode);
        }
      });
    });

    observer.observe(subtitleContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return { cues: [], statusMessage: "Waiting for subtitles..." };
  }
}
```

**关键选择器（Netflix）：**

```typescript
const NETFLIX_SELECTORS = {
  video: "video",
  subtitleContainer: ".player-timedtext",
  subtitleText: ".player-timedtext-text-container span",
  player: ".NFPlayer",
};
```

---

#### 2. 开放 API 平台（中等难度）

**平台：**

- Coursera
- Udemy
- Khan Academy
- edX
- TED

**技术特点：**

- 提供公开的字幕 API
- 使用标准格式（WebVTT / SRT）
- 无 DRM 限制

**实现方式：**

```typescript
// Coursera 字幕提取
class CourseraSubtitleProvider implements SubtitleProvider {
  async fetchSubtitles(): Promise<SubtitleFetchResult> {
    // Coursera API: https://www.coursera.org/api/onDemandLectureSubtitles.v1/{lectureId}
    const lectureId = this.extractLectureId(window.location.href);
    const url = `https://www.coursera.org/api/onDemandLectureSubtitles.v1/${lectureId}?includes=text`;

    const response = await fetch(url, {
      credentials: "include", // 需要登录态
    });

    const data = await response.json();
    const vttUrl = data.elements[0]?.subtitles?.en?.url;

    if (vttUrl) {
      const vtt = await fetch(vttUrl).then((r) => r.text());
      const cues = parseWebVTT(vtt);
      return { cues, lang: "en" };
    }

    return { cues: [] };
  }
}
```

**API 端点示例：**

```typescript
const API_ENDPOINTS = {
  coursera:
    "https://www.coursera.org/api/onDemandLectureSubtitles.v1/{lectureId}",
  udemy: "https://www.udemy.com/api-2.0/courses/{courseId}/captions/",
  ted: "https://www.ted.com/talks/{talkId}/subtitles/download?format=vtt&lang=en",
  edx: "https://courses.edx.org/courses/{courseId}/xblock/{blockId}/handler/transcript",
};
```

---

#### 3. DOM 字幕平台（简单）

**平台：**

- Vimeo
- Dailymotion
- TikTok (部分)

**技术特点：**

- 字幕直接渲染在 DOM 中
- 使用 MutationObserver 监听即可
- 不需要 API

**实现方式：**

```typescript
class VimeoSubtitleProvider implements SubtitleProvider {
  async init(url: string, settings: Settings): Promise<void> {
    this.observeSubtitleContainer();
  }

  private observeSubtitleContainer(): void {
    const container = document.querySelector(".vp-captions");
    if (!container) return;

    const observer = new MutationObserver((mutations) => {
      const text = container.textContent?.trim();
      if (text) {
        this.onSubtitleChange({
          text,
          startMs: performance.now(),
          endMs: performance.now() + 3000,
        });
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}
```

---

### 字幕格式解析器实现

#### 1. TTML Parser (Netflix, Disney+)

```typescript
// packages/subtitles/src/parsers/ttml-parser.ts
import type { Cue } from "@lexipath/core";

export function parseTTML(ttml: string): Cue[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(ttml, "text/xml");

  const cues: Cue[] = [];
  const pElements = doc.querySelectorAll("p");

  pElements.forEach((p, index) => {
    const begin = p.getAttribute("begin");
    const end = p.getAttribute("end");
    const text = p.textContent?.trim();

    if (!begin || !end || !text) return;

    const startMs = parseTimeExpression(begin);
    const endMs = parseTimeExpression(end);

    cues.push({
      id: `ttml:${startMs}-${endMs}:${index}`,
      startMs,
      endMs,
      text,
      lang: "en",
      source: "ttml",
    });
  });

  return cues;
}

function parseTimeExpression(time: string): number {
  // 支持多种格式:
  // - 00:01:30.500 (HH:MM:SS.mmm)
  // - 1.5s (秒)
  // - 1500ms (毫秒)

  if (time.endsWith("ms")) {
    return Number.parseInt(time.slice(0, -2), 10);
  }

  if (time.endsWith("s")) {
    return Number.parseFloat(time.slice(0, -1)) * 1000;
  }

  // HH:MM:SS.mmm 格式
  const parts = time.split(":");
  if (parts.length === 3) {
    const hours = Number.parseInt(parts[0], 10);
    const minutes = Number.parseInt(parts[1], 10);
    const seconds = Number.parseFloat(parts[2]);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  return 0;
}
```

#### 2. WebVTT Parser (通用格式)

```typescript
// packages/subtitles/src/parsers/webvtt-parser.ts
import type { Cue } from "@lexipath/core";

export function parseWebVTT(vtt: string): Cue[] {
  const lines = vtt.split("\n");
  const cues: Cue[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]?.trim();

    // 跳过 WEBVTT 头部和空行
    if (!line || line === "WEBVTT" || line.startsWith("NOTE")) {
      i++;
      continue;
    }

    // 时间戳行: 00:01:30.500 --> 00:01:33.000
    const timeMatch = line.match(
      /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/,
    );
    if (timeMatch) {
      const startMs = parseVTTTime(timeMatch[1]);
      const endMs = parseVTTTime(timeMatch[2]);

      // 读取字幕文本（可能多行）
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i]?.trim()) {
        textLines.push(lines[i].trim());
        i++;
      }

      const text = textLines.join("\n");
      if (text) {
        cues.push({
          id: `vtt:${startMs}-${endMs}`,
          startMs,
          endMs,
          text: stripVTTTags(text),
          lang: "und",
          source: "webvtt",
        });
      }
    }

    i++;
  }

  return cues;
}

function parseVTTTime(time: string): number {
  const [hours, minutes, seconds] = time.split(":");
  const [secs, millis] = seconds.split(".");

  return (
    Number.parseInt(hours, 10) * 3600000 +
    Number.parseInt(minutes, 10) * 60000 +
    Number.parseInt(secs, 10) * 1000 +
    Number.parseInt(millis, 10)
  );
}

function stripVTTTags(text: string): string {
  // 移除 WebVTT 标签: <v Speaker>、<c>、<i>、<b> 等
  return text
    .replace(/<v\s+[^>]+>/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}
```

#### 3. SRT Parser (通用格式)

```typescript
// packages/subtitles/src/parsers/srt-parser.ts
import type { Cue } from "@lexipath/core";

export function parseSRT(srt: string): Cue[] {
  const blocks = srt.split(/\n\s*\n/).filter(Boolean);
  const cues: Cue[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split("\n");
    if (lines.length < 3) return;

    // 第一行：序号
    // 第二行：时间戳 00:01:30,500 --> 00:01:33,000
    // 第三行及以后：字幕文本

    const timeLine = lines[1];
    const timeMatch = timeLine?.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/,
    );

    if (!timeMatch) return;

    const startMs = parseSRTTime(timeMatch[1]);
    const endMs = parseSRTTime(timeMatch[2]);
    const text = lines.slice(2).join("\n").trim();

    if (text) {
      cues.push({
        id: `srt:${startMs}-${endMs}:${index}`,
        startMs,
        endMs,
        text,
        lang: "und",
        source: "srt",
      });
    }
  });

  return cues;
}

function parseSRTTime(time: string): number {
  const [hours, minutes, secondsAndMillis] = time.split(":");
  const [seconds, millis] = secondsAndMillis.split(",");

  return (
    Number.parseInt(hours, 10) * 3600000 +
    Number.parseInt(minutes, 10) * 60000 +
    Number.parseInt(seconds, 10) * 1000 +
    Number.parseInt(millis, 10)
  );
}
```

---

### 实施计划

#### 阶段 1：字幕格式解析器（基础）

**优先级：高 ✅**

1. 实现 WebVTT Parser
2. 实现 SRT Parser
3. 实现 TTML Parser
4. 单元测试覆盖

**时间估算：** 2-3 天

**文件结构：**

```
packages/subtitles/src/parsers/
  ├── webvtt-parser.ts
  ├── srt-parser.ts
  ├── ttml-parser.ts
  ├── index.ts
  └── __tests__/
      ├── webvtt-parser.test.ts
      ├── srt-parser.test.ts
      └── ttml-parser.test.ts
```

---

#### 阶段 2：开放 API 平台（中等难度）

**优先级：中 ⚠️**

**平台清单：**

1. ✅ Coursera - 教育类，API 公开
2. ✅ TED - 演讲类，API 公开
3. ✅ Udemy - 教育类，需要登录
4. ⚠️ Khan Academy - 教育类，API 公开
5. ⚠️ edX - 教育类，需要登录

**实现方式：**

- 创建对应的 SubtitleProvider
- 调用平台 API 获取字幕 URL
- 使用对应的 Parser 解析

**时间估算：** 每个平台 1-2 天

---

#### 阶段 3：DRM 加密平台（高难度）

**优先级：低 ❌**

**平台清单：**

1. ❌ Netflix - DRM 保护
2. ❌ Disney+ - DRM 保护
3. ❌ Prime Video - DRM 保护
4. ❌ HBO Max - DRM 保护

**技术方案：**

1. **方案 A：DOM 监听（推荐）**
   - 监听字幕容器的 DOM 变化
   - 实时提取显示的字幕文本
   - 优点：合法、简单
   - 缺点：无法提前翻译

2. **方案 B：拦截 manifest（风险）**
   - 拦截播放器的 manifest 请求
   - 提取 TTML URL
   - 优点：可提前翻译
   - 缺点：可能违反 ToS

**建议：** 暂不实施，风险太高

---

### 技术要点总结

| 平台类型    | 字幕格式   | 获取方式     | 难度 | 优先级    |
| ----------- | ---------- | ------------ | ---- | --------- |
| YouTube     | JSON3/XML  | API          | 低   | ✅ 已实现 |
| Bilibili    | JSON       | API          | 低   | ✅ 已实现 |
| Coursera    | WebVTT     | API          | 中   | ⚠️ 建议   |
| TED         | WebVTT     | API          | 中   | ⚠️ 建议   |
| Udemy       | WebVTT/SRT | API          | 中   | ⚠️ 建议   |
| Netflix     | TTML       | DOM/Manifest | 高   | ❌ 不建议 |
| Disney+     | TTML       | DOM/Manifest | 高   | ❌ 不建议 |
| Prime Video | TTML       | DOM/Manifest | 高   | ❌ 不建议 |

---

### 文件组织结构

```
lexipath/
├── packages/
│   └── subtitles/
│       └── src/
│           ├── parsers/            # 新增：字幕格式解析器
│           │   ├── webvtt-parser.ts
│           │   ├── srt-parser.ts
│           │   ├── ttml-parser.ts
│           │   └── index.ts
│           ├── youtube/
│           ├── bilibili/
│           ├── coursera/           # 新增：Coursera 适配
│           ├── ted/                # 新增：TED 适配
│           ├── udemy/              # 新增：Udemy 适配
│           └── index.ts
└── apps/
    └── extension/
        └── src/
            └── content/
                └── subtitle-providers/
                    ├── youtube-subtitle-provider.ts
                    ├── bilibili-subtitle-provider.ts
                    ├── coursera-subtitle-provider.ts  # 新增
                    ├── ted-subtitle-provider.ts       # 新增
                    ├── udemy-subtitle-provider.ts     # 新增
                    └── create-subtitle-provider.ts    # 更新：添加新平台
```

---

## 渐进式加载实现状态

### 网页场景已实现 ✅

**IntersectionObserver（第630-656行）**

```typescript
new IntersectionObserver(
  (entries) => {
    // 元素进入视口时优先处理
  },
  {
    rootMargin: "400px 0px", // 提前400px预加载
    threshold: 0.01,
  },
);
```

**双队列系统（优先级队列 + 普通队列）**

```typescript
priorityQueue.push(el); // 可见元素优先
elementQueue.push(el); // 普通队列
```

**并发控制**

```typescript
MAX_IN_FLIGHT = 3; // 同时处理3个元素
```

**requestIdleCallback**

```typescript
// 利用浏览器空闲时间，避免卡顿
requestIdleCallback(run, { timeout: 200 });
```

**去重机制**

```typescript
queuedElements.has(el); // 避免重复处理
inFlightElements.has(el); // 避免重复请求
```

### 字幕场景已实现 ✅

**基于时间轴的预加载**

```typescript
private readonly keywordPrefetchLookaheadMs = 15_000;  // 15秒预加载窗口
```

**批量翻译队列**

```typescript
pump(): void {
  while (this.inFlight < this.maxInFlight && this.queueIndex < this.cues.length) {
    const cue = this.cues[this.queueIndex++];
    // 顺序翻译，控制并发数
  }
}
```

**预取管理**

```typescript
onCueIndexChange: (index) => {
  this.currentCueIndex = index;
  this.startPrefetchWindow(); // 触发预加载
};
```

---

## 风险与挑战

### 1. 过度设计风险

- 配置系统可能过于复杂
- 场景太多导致难以维护
- **缓解**：从 MVP 开始，逐步验证

### 2. 效果验证困难

- 不同 Prompt 的效果差异可能不明显
- 主观评价标准不统一
- **缓解**：选择对比度大的场景（娱乐 vs 学术）

### 3. 维护成本

- 每个平台需要单独优化 Prompt
- 配置文件可能快速增长
- **缓解**：抽象通用模板，减少重复

### 4. 上下文功能的控制

- `useContext` 作为高级功能，应默认关闭
- 需要在设置页面让用户选择是否启用
- 或根据用户的订阅等级决定是否可用

---

## 下一步行动

1. **立即实施：** 硬编码 2 个场景（YouTube 娱乐 + Coursera 学术）
2. **验证效果：** 对比翻译质量差异
3. **根据反馈决定：** 是否继续抽象配置系统
4. **高优先级功能：** Bilibili 弹幕处理、YouTube Shorts 适配
5. **字幕格式解析器：** 实现 WebVTT、SRT、TTML Parser

---

## 相关讨论

- 沉浸式翻译的四层网站适配机制分析
- 工厂模式 vs 配置驱动的区别
- 批量翻译队列（已实现）
- 缓存系统（已实现）
- 主题系统（已实现）
- 渐进式加载（已实现）
- YouTube 和 Bilibili 特殊适配（待实施）
- 流媒体平台扩展支持（字幕格式解析器优先实施）
- 会员功能验证机制（本地控制 vs API 验证）

---

## 英语输入纠正功能（即时英文纠错）

### 功能描述

用户在输入框输入英文后，连续按 3 次空格自动触发纠正检查。

- **有问题**：自动替换为正确版本 + 弹出小卡片说明
- **没问题**：弹出小卡片鼓励用户

### 核心流程

```
用户输入英文 → 3 次空格 → AI 分析
  ├─ 有错误 → 自动替换 + 卡片提示（可撤销）
  └─ 无错误 → 卡片鼓励（自动关闭）
```

### 提示词模板

```markdown
你是一个英语写作助手，分析用户输入的英文文本。

返回 JSON 格式：
{
"hasError": boolean, // 是否有错误
"corrected": string | null, // 纠正后的文本
"message": string // 中文反馈（鼓励或说明，50字以内）
}
```

### 技术实现

**1. 按键检测**

```javascript
const triggerKey = "space";
const triggerTimes = 3;
const triggerTimeout = 500; // ms

let pressCount = 0;
let lastPressTime = 0;

document.addEventListener("keyup", (e) => {
  if (e.key !== triggerKey) return;

  const now = Date.now();
  if (now - lastPressTime > triggerTimeout) {
    pressCount = 1;
  } else {
    pressCount++;
  }
  lastPressTime = now;

  if (pressCount === triggerTimes) {
    pressCount = 0;
    triggerCorrection();
  }
});
```

**2. AI 调用**

```javascript
async function triggerCorrection() {
  const userText = getInputText(activeElement);
  const prompt = template.replace("{{USER_INPUT}}", userText);
  const result = await callAI(prompt);

  if (result.hasError) {
    setInputText(activeElement, result.corrected);
    showCard(result.message, "corrected", () => {
      setInputText(activeElement, userText); // 撤销
    });
  } else {
    showCard(result.message, "encouragement");
    setTimeout(closeCard, 3000);
  }
}
```

**3. 小卡片 UI**

```css
.correction-card {
  position: fixed;
  z-index: 999999;
  width: 300px;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.corrected {
  border-left: 4px solid #10b981;
}
.encouragement {
  border-left: 4px solid #3b82f6;
}
```

### 开发优先级

**Phase 1: MVP（2-3天）**

- [ ] 按键检测机制（3次空格）
- [ ] AI 调用集成
- [ ] 基础卡片 UI
- [ ] 自动文本替换
- [ ] 撤销功能

**Phase 2: 增强（2-3天）**

- [ ] 卡片智能定位
- [ ] 动画效果
- [ ] 快捷键支持（Enter/Esc）
- [ ] 移动端适配

**Phase 3: 高级（可选）**

- [ ] 学习统计
- [ ] 个性化建议
- [ ] 错误分类分析

### 配置项

```typescript
interface CorrectionConfig {
  enabled: boolean;
  triggerKey: string; // "space"
  triggerTimes: number; // 3
  triggerTimeout: number; // 500
  autoCloseDelay: number; // 3000
  showUndoButton: boolean;
}
```

### 文件结构

```
packages/core/src/correction/
  ├── prompt-template.md
  ├── types.ts
  └── index.ts

apps/extension/src/content/
  ├── correction-handler.ts    # 按键检测
  └── correction-card.ts        # 卡片 UI
```

### 风险与应对

| 风险      | 应对                           |
| --------- | ------------------------------ |
| 误触发    | 提高时间窗口精度、手动禁用选项 |
| AI 不稳定 | 重试机制、降级方案、错误日志   |
| 卡片遮挡  | 智能定位、手动拖拽             |
| 性能影响  | 防抖机制、缓存、轻量级模型     |

### 相关文档

- 完整设计总结：`docs/english_correction_discussion_summary.md`
- 提示词模板：`docs/english_correction_prompt_template.md`
- 沉浸式翻译参考：`content_script.js:7448`
