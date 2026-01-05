# 沉浸式翻译网站特殊适配详解

## 目录

1. [网站适配体系](#1-网站适配体系)
2. [准确性配置](#2-准确性配置)
3. [即时翻译模式](#3-即时翻译模式)
4. [请求头修改](#4-请求头修改)
5. [Userscript域名白名单](#5-userscript域名白名单)
6. [对你项目的启发](#6-对你项目的启发)

---

## 1. 网站适配体系

沉浸式翻译有**四层次的网站适配机制**：

```
┌─────────────────────────────────────────────────────────────┐
│  层次1: 准确性配置              │
│  └── 针对特定网站的翻译策略（AO3等）                      │
├─────────────────────────────────────────────────────────────┤
│  层次2: 即时翻译模式                         │
│  └── 社交媒体等滚动密集网站的优化配置                     │
├─────────────────────────────────────────────────────────────┤
│  层次3: 请求头修改           │
│  └── 20+网站的CORS/Referer适配（漫画站、博客等）          │
├─────────────────────────────────────────────────────────────┤
│  层次4: Userscript域名白名单              │
│  └── 60+API域名的特殊权限配置                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 准确性配置

### 2.1 配置结构

从`default_config.json`提取：

```json
{
  "accurateConfigs": {
    "AO3": {
      "enable": false,
      "matches": [
        "https://archiveofourown.org/*",
        "https://isnull.info/*",
        "https://i.aois.top/*",
        "https://xn--iao3-lw4b.ws/*",
        "https://browser.immersivetranslate.*/ebook-reader/*"
      ],
      "translationService": "deepseek-pro",
      "serviceConfig": {
        "assistantId": "ao3",
        "enableAIContext": true
      }
    }
  }
}
```

### 2.2 AO3（Archive of Our Own）深度分析

#### 为什么需要特殊适配？

AO3是**同人小说网站**，包含大量：
- 专业术语（动漫、游戏角色名）
- 角色对话（需要上下文）
- 长文本（小说章节）
- 特殊格式（HTML富文本）

#### 适配策略

##### 1. 使用DeepSeek-Pro模型

```javascript
// 为什么选择DeepSeek-Pro？
translationService: "deepseek-pro"
```

**对比：**
| 模型 | 优势 | 劣势 | 适用场景 |
|------|------|------|---------|
| **Google/Bing** | 免费、快速 | 上下文弱、术语差 | 通用文本 |
| **OpenAI GPT-4** | 上下文强、准确 | 成本高 | 复杂文本 |
| **DeepSeek-Pro** | 长上下文、性价比高 | 中文优秀、英文一般 | 小说、文档 |
| **Claude** | 理解能力强 | 成本高 | 对话、分析 |

##### 2. 启用AI上下文

```javascript
"serviceConfig": {
  "assistantId": "ao3",           // 专用助手ID
  "enableAIContext": true          // 启用上下文
}
```

**AI上下文原理：**
```javascript
// 传统翻译（无上下文）
translate("Harry") → "哈里"  // 可能错误
translate("Harry Potter") → "哈利·波特"  // 正确

// AI上下文翻译（有上下文）
const context = {
  previousParagraph: "He picked up his wand.",
  currentParagraph: "Harry looked at Hermione.",
  domain: "fantasy-novel"  // 域信息
};

translateWithContext("Harry", context) → "哈利"  // 正确
```

##### 3. 多域名匹配

```javascript
"matches": [
  "https://archiveofourown.org/*",      // 主站
  "https://isnull.info/*",              // 镜像站
  "https://i.aois.top/*",              // 镜像站
  "https://xn--iao3-lw4b.ws/*",       // 国际化域名
  "https://browser.immersivetranslate.*/ebook-reader/*"  // 内置阅读器
]
```

**问题：** 同一个网站有多个域名/镜像站
**解决：** 使用通配符匹配所有变体

##### 4. 特殊Prompt（推测）

```javascript
// AO3专用的翻译Prompt（从assistantId: "ao3"推断）
const ao3Prompt = `
你正在翻译Archive of Our Own (AO3)网站的同人小说。
请遵循以下规则：
1. 保留角色名、地名、术语不翻译
2. 理解上下文，保持对话一致性
3. 风格：小说化、文学化
4. 特殊标记：[[保留]]
示例：
- "Harry Potter" → "哈利·波特"（保留）
- "Expecto Patronum" → "呼神护卫"（咒语翻译）
- "I love you" → "我爱你"（对话语气）
`;

function translateWithPrompt(text, context) {
  return aiService.translate({
    text,
    systemPrompt: ao3Prompt,
    context: context
  });
}
```

---

## 3. 即时翻译模式

### 3.1 配置结构

```json
{
  "immediateTranslationPattern": {
    "matches": [
      "twitter.com",
      "x.com",
      "*.twitter.com",
      "*.x.com",
      "medium.com",
      "*.medium.com",
      "https://old.reddit.com/",
      "https://www.reddit.com/r/popular/",
      "https://www.reddit.com/",
      "https://www.reddit.com/hot/",
      "https://www.reddit.com/new/",
      "https://www.reddit.com/top/",
      "https://www.reddit.com/.compact",
      "https://app.immersivetranslate.*/pdf*",
      "https://bsky.app"
    ],
    "excludeMatches": [],
    "selectorMatches": [
      "meta[property='al:ios:url'][content^='medium://']"
    ],
    "selectorExcludeMatches": []
  }
}
```

### 3.2 为什么这些网站需要即时翻译？

#### 1. Twitter/X（社交媒体）

**特点：**
- 滚动密集（用户不断下拉）
- 短文本（140-280字符）
- 高频更新（实时推流）

**传统翻译的问题：**
```javascript
// 传统方式：手动触发翻译
用户浏览Twitter → 用户手动点击翻译按钮 → 翻译当前页面
问题：用户必须手动操作，效率低
```

**即时翻译方案：**
```javascript
// 即时翻译：自动触发
用户浏览Twitter → 自动翻译可见推文 → 用户无需操作
```

**实现原理：**
```javascript
class ImmediateTranslation {
  constructor() {
    this.observer = null;
    this.viewport = new Set(); // 已翻译的元素
  }

  setupTwitterTranslation() {
    // 监控新推文插入
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (this.isTweet(node)) {
            this.translateTweet(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  isTweet(node) {
    // 检查是否是推文元素
    return node.matches?.('[data-testid="tweet"]') ||
           node.closest?.('[data-testid="tweet"]');
  }

  async translateTweet(tweetElement) {
    const text = tweetElement.querySelector('[data-testid="tweetText"]')?.textContent;
    if (!text) return;

    // 检查是否在视口中（节省翻译资源）
    if (!this.isInViewport(tweetElement)) {
      return;
    }

    const translated = await translate(text);

    // 插入译文
    this.insertTranslation(tweetElement, translated);
  }

  isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  insertTranslation(tweetElement, translation) {
    // 在推文下方插入译文
    const translationDiv = document.createElement('div');
    translationDiv.className = 'imt-twitter-translation';
    translationDiv.textContent = translation;

    tweetElement.appendChild(translationDiv);
  }
}

new ImmediateTranslation().setupTwitterTranslation();
```

#### 2. Medium（博客平台）

**特点：**
- 长文章（需要保持上下文）
- 富文本（HTML格式）
- 渐进加载（滚动加载更多）

**特殊适配：**
```javascript
// 使用meta标签检测Medium文章
"selectorMatches": [
  "meta[property='al:ios:url'][content^='medium://']"
]
```

**实现原理：**
```javascript
// 通过meta标签识别Medium文章
function isMediumArticle() {
  const meta = document.querySelector('meta[property="al:ios-url"]');
  return meta?.content?.startsWith('medium://');
}

// Medium文章的翻译策略
if (isMediumArticle()) {
  // 1. 保持HTML结构
  // 2. 分段翻译（按段落）
  // 3. 保留链接、图片

  document.querySelectorAll('article p').forEach(async (paragraph) => {
    const html = paragraph.innerHTML;
    const text = paragraph.textContent;

    const translated = await translate(html, {
      mode: 'html',  // 保留HTML
      context: {
        previousParagraph: getPreviousText(paragraph),
        nextParagraph: getNextText(paragraph)
      }
    });

    paragraph.innerHTML = translated;
  });
}
```

#### 3. Reddit（论坛）

**特点：**
- 多层级结构（帖子→评论→子评论）
- Markdown格式
- 动态加载（Lazy Load）

**URL匹配策略：**
```javascript
"matches": [
  "https://old.reddit.com/",      // 旧版Reddit
  "https://www.reddit.com/r/popular/",  // 热门
  "https://www.reddit.com/hot/",       // 热门
  "https://www.reddit.com/new/",       // 最新
  "https://www.reddit.com/top/",       // 置顶
  "https://www.reddit.com/.compact"   // 紧凑模式
]
```

**实现原理：**
```javascript
// Reddit评论翻译
function setupRedditTranslation() {
  // 监控评论动态加载
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (this.isComment(node)) {
          this.translateComment(node);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function isComment(node) {
  // Reddit评论的选择器
  return node.matches?.('[data-test-id="comment"]') ||
         node.closest?.('[data-test-id="comment"]');
}

async function translateComment(commentElement) {
  const text = commentElement.querySelector('[data-click-id="text"]')?.textContent;
  if (!text) return;

  const translated = await translate(text, {
    mode: 'markdown',  // Reddit使用Markdown
    format: 'comment'
  });

  // 插入译文（保持层级结构）
  const translationDiv = document.createElement('div');
  translationDiv.className = 'imt-reddit-translation';
  translationDiv.innerHTML = translated;

  commentElement.appendChild(translationDiv);
}
```

---

## 4. 请求头修改

### 4.1 核心配置

`request_modifier_rule.json`定义了**20+网站的CORS和Referer适配**。

### 4.2 技术原理

#### 1. DeelL翻译服务的适配

**问题：**
```javascript
// 直接调用Deepl API会失败
fetch('https://api.deepl.com/jsonrpc', {
  method: 'POST',
  headers: {
    'Origin': 'chrome-extension://lexipath...'  // 扩展的Origin会被拒绝
  }
})
// Response: 403 Forbidden（Origin不允许）
```

**解决方案：**
```json
{
  "id": 200,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [
      {
        "header": "Referer",
        "operation": "set",
        "value": "https://www.deepl.com/"  // 伪造Referer为官方网页
      },
      {
        "header": "origin",
        "operation": "set",
        "value": "chrome-extension://cofdbpoegempjloogbagkncekinflcnj"  // 伪造Origin为官方插件
      }
    ]
  },
  "condition": {
    "urlFilter": "https://api.deepl.com/jsonrpc*",
    "resourceTypes": ["xmlhttprequest"]
  }
}
```

**实现效果：**
```javascript
// 修改后的请求（Deepl认为来自官方插件）
fetch('https://api.deepl.com/jsonrpc', {
  method: 'POST',
  headers: {
    'Referer': 'https://www.deepl.com/',
    'Origin': 'chrome-extension://cofdbpoegempjloogbagkncekinflcnj'
  }
})
// Response: 200 OK（成功）
```

#### 2. 漫画站图片防盗链适配

**网站：** Pixiv、Toonily、ReadComicOnline等

**问题：**
```html
<!-- 漫画站的防盗链机制 -->
<img src="https://i.pximg.net/img-original/123.jpg" />
<!-- 如果Referer不是https://www.pixiv.net/，返回403 -->
```

**解决方案：**
```json
{
  "id": 301,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [
      {
        "header": "referer",
        "operation": "set",
        "value": "https://www.pixiv.net/"  // 伪造Referer
      }
    ]
  },
  "condition": {
    "urlFilter": "https://i.pximg.net/*"
  }
}
```

**效果：**
```javascript
// 请求图片时自动添加正确的Referer
fetch('https://i.pximg.net/img-original/123.jpg', {
  headers: {
    'Referer': 'https://www.pixiv.net/'  // 自动添加
  }
})
// Response: 200 OK（图片加载成功）
```

#### 3. 微博图片防盗链

**问题：**
```html
<!-- 微博图片防盗链 -->
<img src="https://*.sinaimg.cn/large/123.jpg" />
<!-- 如果没有Referer，返回403 -->
```

**解决方案：**
```json
{
  "id": 314,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [
      {
        "header": "referer",
        "operation": "set",
        "value": "https://weibo.com/"
      }
    ]
  },
  "condition": {
    "urlFilter": "https://*.sinaimg.cn/"
  }
}
```

#### 4. 本地开发服务器适配

**场景：** 用户使用本地AI服务（如Ollama、LM Studio）

**问题：**
```javascript
// 本地API调用会被浏览器CORS拦截
fetch('http://localhost:11434/api/generate')
// Response: CORS Error
```

**解决方案：**
```json
{
  "id": 315,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [
      {
        "header": "origin",
        "operation": "set",
        "value": "http://127.0.0.1:11434"
      }
    ]
  },
  "condition": {
    "urlFilter": "http://*:11434"
  }
}
```

---

## 5. Userscript域名白名单

### 5.1 配置结构

从`background.js`中提取的`userscript_domains`：

```javascript
userscript_domains: [
  "google.com",
  "translate.googleapis.com",
  "api-edge.cognitive.microsofttranslator.com",
  "edge.microsoft.com",
  "transmart.qq.com",
  "translate.yandex.net",
  "tmt.tencentcloudapi.com",
  "www2.deepl.com",
  "w.deepl.com",
  "immersive-translate.owenyoung.com",
  "generativelanguage.googleapis.com",
  "chat.openai.com",
  "bing.com",
  "www.bing.com",
  "open.volcengineapi.com",
  "fanyi.baidu.com",
  "api.fanyi.baidu.com",
  "api.interpreter.caiyunai.com",
  "api-free.deepl.com",
  "api.deepl.com",
  "api.openl.club",
  "openapi.youdao.com",
  "translate.volcengine.com",
  "api.niutrans.com",
  "immersivetranslate.com",
  "test-api2.immersivetranslate.com",
  "api2.immersivetranslate.com",
  "config.immersivetranslate.com",
  "app.immersivetranslate.com",
  "dash.immersivetranslate.com",
  "api.immersivetranslate.com",
  "immersive-translate.deno.dev",
  "www.googleapis.com",
  "www.google-analytics.com",
  "translate-pa.googleapis.com",
  "api.cognitive.microsofttranslator.com",
  "api.groq.com",
  "api.x.ai",
  "api.papago-chrome.com",
  "api.openai.com",
  "api.interpreter.caiyunai.com",
  "api.cognitive.microsofttranslator.com",
  "aidemo.youdao.com",
  "dict.youdao.com",
  "openai.azure.com",
  "mt.aliyuncs.com",
  "subhub.weixin.so",
  "api.anthropic.com",
  "localhost",
  "127.0.0.1",
  "ai.immersivetranslate.com",
  "test-ai.immersivetranslate.com",
  "openrouter.ai",
  "dashscope.aliyuncs.com",
  "api.deepseek.com",
  "aip.baidubce.com",
  "ark.cn-beijing.volces.com",
  "hunyuan.tencentcloudapi.com",
  "public-beta-api.siliconflow.cn",
  "api.siliconflow.cn",
  "open.bigmodel.cn",
  "store.immersivetranslate.com",
  "qianfan.baidubce.com",
  "aigw1.immersivetranslate.com"
]
```

### 5.2 作用分析

#### 1. 跨域请求白名单

**问题：**
```javascript
// 浏览器默认CORS策略
fetch('https://api.anthropic.com/v1/messages')
// Response: CORS Error（除非anthropic.com允许）
```

**解决：**
```javascript
// manifest.json
"host_permissions": [
  "<all_urls>"  // 允许访问所有URL
]
```

**但为什么还需要userscript_domains？**
```javascript
// userscript_domains用于其他场景：
// 1. Greasemonkey/OilMonkey用户脚本兼容
// 2. 特殊API权限
// 3. 内嵌iframe的域名白名单
```

#### 2. 特殊API权限

```javascript
// 本地开发服务器
"localhost",
"127.0.0.1"

// 允许调用本地AI服务
fetch('http://localhost:11434/api/generate')
```

#### 3. 自托管服务

```javascript
// 用户自部署的翻译服务
"immersivetranslate.owenyoung.com",
"test-api2.immersivetranslate.com",
"api2.immersivetranslate.com"
```

---

## 6. 对你项目的启发

### 6.1 建立网站适配系统

```typescript
// apps/extension/src/content/site-adapters/site-adapter-manager.ts
interface SiteConfig {
  platform: string;
  matches: string[];
  excludeMatches?: string[];
  selectorMatches?: string[];
  translationStrategy: 'immediate' | 'manual' | 'hover';
  subtitleStrategy: 'native' | 'overlay' | 'ocr';
  specialFeatures: {
    hideNativeSubtitles?: boolean;
    preserveFormatting?: boolean;
    useAIContext?: boolean;
    batchSize?: number;
  };
}

class SiteAdapterManager {
  private configs: SiteConfig[] = [
    {
      platform: 'youtube',
      matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
      translationStrategy: 'immediate',
      subtitleStrategy: 'native',
      specialFeatures: {
        hideNativeSubtitles: true,
        preserveFormatting: true,
        batchSize: 10
      }
    },
    {
      platform: 'bilibili',
      matches: ['https://www.bilibili.com/*'],
      translationStrategy: 'immediate',
      subtitleStrategy: 'native',
      specialFeatures: {
        hideNativeSubtitles: true,
        handleDanmu: true
      }
    },
    {
      platform: 'netflix',
      matches: ['https://www.netflix.com/*'],
      translationStrategy: 'manual',
      subtitleStrategy: 'overlay',
      specialFeatures: {
        useAIContext: true,
        batchSize: 5
      }
    },
    {
      platform: 'vimeo',
      matches: ['https://vimeo.com/*'],
      translationStrategy: 'manual',
      subtitleStrategy: 'ocr',
      specialFeatures: {
        ocrEngine: 'tesseract',
        ocrAccuracy: 'high'
      }
    }
  ];

  detectPlatform(url: string): SiteConfig | null {
    for (const config of this.configs) {
      if (this.matches(url, config.matches)) {
        return config;
      }
    }
    return null;
  }

  private matches(url: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // 支持通配符匹配
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );
      return regex.test(url);
    });
  }

  getSubtitleProvider(platform: string): SubtitleProvider {
    switch (platform) {
      case 'youtube':
        return new YouTubeSubtitleProvider();
      case 'bilibili':
        return new BilibiliSubtitleProvider();
      case 'netflix':
        return new NetflixSubtitleProvider();
      case 'vimeo':
        return new VimeOCRSubtitleProvider();
      default:
        return new GenericSubtitleProvider();
    }
  }
}

// 使用
const adapterManager = new SiteAdapterManager();
const config = adapterManager.detectPlatform(window.location.href);

if (config) {
  const provider = adapterManager.getSubtitleProvider(config.platform);
  provider.init(window.location.href, settings);
}
```

### 6.2 针对YouTube的特殊适配

#### 你已有的代码优化

```typescript
// apps/extension/src/content/subtitle-providers/youtube-subtitle-provider.ts
export class YouTubeSubtitleProvider implements SubtitleProvider {
  readonly platform = 'youtube' as const;

  private videoId: string | null = null;
  private youtubeParams = '';
  private hideNativeStyle: HTMLStyleElement | null = null;

  // ✅ 已有：隐藏原生字幕
  hideNativeCaptions(): void {
    const style = document.createElement('style');
    style.id = 'lexipath-hide-youtube-captions';
    style.textContent = `
      .ytp-caption-window-container,
      .caption-window.ytp-caption-window-container,
      #movie_player .ytp-caption-window-container {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    document.documentElement.appendChild(style);
    this.hideNativeStyle = style;
  }

  // ✅ 已有：获取额外参数
  private async tryGetYouTubeAdditionalParams(videoId: string, options: any) {
    // ... 现有逻辑
  }

  // 🔥 新增：YouTube Live直播字幕适配
  async fetchLiveSubtitles(): Promise<SubtitleFetchResult> {
    const isLive = await this.checkIsLive();
    if (!isLive) {
      return this.fetchSubtitles(); // 普通视频
    }

    // Live字幕特殊处理
    const liveUrl = `https://www.youtube.com/api/timedtext?v=${this.videoId}&type=track&lang=en`;
    const response = await fetch(liveUrl);
    const data = await response.json();

    // 解析Live字幕（实时更新）
    return {
      cues: this.parseLiveCaptions(data),
      isLive: true
    };
  }

  private async checkIsLive(): Promise<boolean> {
    // 检查是否是直播
    const isLiveBadge = document.querySelector('.ytp-live-badge');
    return !!isLiveBadge;
  }

  // 🔥 新增：YouTube Shorts适配
  async setupShortsSubtitle(): Promise<void> {
    const isShorts = window.location.href.includes('/shorts/');
    if (!isShorts) return;

    // Shorts的特殊字幕选择器
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.matches?.('#shorts-player')) {
            this.setupShortsObserver(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private setupShortsObserver(shortsPlayer: Element): void {
    // 监控Shorts视频切换
    const observer = new MutationObserver(async (mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
          // 视频切换，重新获取字幕
          await this.fetchSubtitles();
        }
      }
    });

    observer.observe(shortsPlayer, {
      attributes: true,
      attributeFilter: ['src'],
      subtree: true
    });
  }

  // 🔥 新增：YouTube 会员字幕适配
  async fetchPremiumSubtitles(): Promise<SubtitleFetchResult> {
    const isPremium = await this.checkIsPremiumMember();
    if (!isPremium) {
      return this.fetchSubtitles(); // 普通字幕
    }

    // Premium会员字幕（需要额外参数）
    const premiumParams = await this.getPremiumParams();
    const cues = await fetchYouTubeSubtitles(
      this.videoId,
      this.settings.targetLanguage,
      { additionalParams: premiumParams }
    );

    return { cues };
  }

  private async checkIsPremiumMember(): Promise<boolean> {
    // 检查是否是Premium会员
    const badge = document.querySelector('#avatar-btn .ytp-avatar-button');
    return badge?.getAttribute('aria-label')?.includes('Premium');
  }
}
```

### 6.3 针对Bilibili的特殊适配

```typescript
// apps/extension/src/content/site-adapters/bilibili-adapter.ts
export class BilibiliAdapter implements SiteAdapter {
  readonly platform = 'bilibili' as const;

  private videoId: string | null = null;
  private danmuElements: HTMLElement[] = [];

  async init(): Promise<void> {
    // 提取视频ID
    this.videoId = this.extractVideoId();

    // 隐藏原生字幕（你已有）
    this.hideNativeSubtitles();

    // 处理弹幕干扰
    this.setupDanmuHandling();
  }

  private extractVideoId(): string | null {
    const match = window.location.href.match(/bilibili.com\/video\/(BV[a-zA-Z0-9]+)/);
    return match?.[1] || null;
  }

  private setupDanmuHandling(): void {
    // 监控弹幕容器
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('bili-danmaku')) {
            this.danmuElements.push(node);
          }
        });
      });
    });

    const danmuContainer = document.querySelector('.bilibili-player-video-danmaku');
    if (danmuContainer) {
      observer.observe(danmuContainer, {
        childList: true,
        subtree: true
      });
    }
  }

  // 暂停弹幕（避免遮挡字幕）
  pauseDanmu(): void {
    this.danmuElements.forEach(danmu => {
      danmu.style.display = 'none';
    });
  }

  // 恢复弹幕
  resumeDanmu(): void {
    this.danmuElements.forEach(danmu => {
      danmu.style.display = '';
    });
  }

  // 字幕显示时自动暂停弹幕
  onSubtitleShow(subtitleText: string): void {
    this.pauseDanmu();

    // 3秒后恢复弹幕
    setTimeout(() => {
      this.resumeDanmu();
    }, 3000);
  }
}
```

### 6.4 字幕格式适配

```typescript
// 不同平台使用不同字幕格式
interface SubtitleParser {
  parse(content: string): Cue[];
}

class TTMLParser implements SubtitleParser {
  parse(content: string): Cue[] {
    // Netflix使用TTML格式
  }
}

class VTTParser implements SubtitleParser {
  parse(content: string): Cue[] {
    // YouTube使用WebVTT格式
  }
}

class SRTParser implements SubtitleParser {
  parse(content: string): Cue[] {
    // Bilibili使用SRT格式
  }
}
```

---

**文件完成时间：** 2025-01-05
**分析对象：** Immersive Translate v1.23.9
**分析深度：** 代码级深度分析
