# PLAN-9: 用户体验优化与新功能增强

目标：提升核心交互体验，增强字幕学习效率，优化 AI 对话界面。

---

## Part 1: AI 对话界面 Markdown 渲染与流式输出改造

### 0. 背景与问题

#### 当前问题
- AI 返回的 Markdown 格式（代码块、链接、加粗、列表等）以纯文本显示
- 非流式输出，用户需等待完整响应才能看到内容
- 长回复时体验差，缺乏实时反馈

#### 改造目标
- 支持 Markdown 完整语法渲染（代码高亮、表格、列表等）
- 实现流式输出，逐字符/逐块展示 AI 回复
- 保持安全性，防止 XSS 攻击
- 优化性能，避免频繁重渲染导致的卡顿

---

### 1) 技术选型

#### 1.1 Markdown 渲染库

**选择：markdown-to-jsx (v9.5+)**

理由：
- 内置 TypeScript 类型定义，无需额外 @types 包
- 体积轻量（10KB gzipped），适合浏览器扩展
- 直接输出 React 组件，天然防止 XSS（无需 dangerouslySetInnerHTML）
- 容错解析，支持未闭合语法（适合流式场景）
- 活跃维护，2025 年仍在更新（最新版本 13 天前发布）

#### 1.2 代码高亮（可选）

**选择：react-syntax-highlighter（轻量版）或 Prism.js**

- 按需加载语言包，减少初始体积
- 与 markdown-to-jsx 配合使用

---

### 2) 架构设计

#### 2.1 分层架构

```
┌─────────────────────────────────────┐
│  UI 层 (Sidebar.tsx)                │
│  - 消息列表渲染                     │
│  - 流式状态管理                     │
│  - 双接口支持（流式/非流式）         │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  消息渲染层 (MessageContent)        │
│  - Markdown 解析与渲染              │
│  - 流式光标动画                     │
│  - 节流优化                         │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  底层服务 (Background)              │
│  - 流式 API (SSE/Streaming Fetch)   │
│  - 非流式 API（内部累积流式数据）   │
│  - 消息推送到前端                   │
└─────────────────────────────────────┘
```

#### 2.2 消息状态扩展

扩展 ChatMessage 接口：
- 新增 `isStreaming` 标志：区分流式输出中/已完成
- 保留 `content` 字段：累积流式文本
- 保留 `timestamp` 字段：消息时间戳

#### 2.3 双接口设计

**上层提供两种调用方式：**

1. **流式接口**：`chatStream(message, onChunk)`
   - 逐块推送数据
   - 前端累积文本并实时渲染
   - 显示打字机效果

2. **非流式接口**：`chat(message) → Promise<reply>`
   - 内部调用流式接口，累积完整结果后返回
   - 向后兼容现有代码
   - 适合不需要实时反馈的场景

---

### 3) 流式渲染策略

#### 3.1 核心方案：容错式增量解析 + 节流优化

**设计思路：**
- 流式数据到达时累积到消息的 `content` 字段
- markdown-to-jsx 的容错解析能力处理未闭合语法
- 使用节流减少渲染频率（50-100ms 批量更新一次）
- React 的 Diff 机制自动优化 DOM 更新

**用户体验：**
- 流式输出时：显示纯文本内容 + 闪烁光标 ▊
- 未完成语法：显示原始 Markdown 符号（如 `**正在输`）
- 语法闭合后：自动转换为格式化样式（如粗体）
- 流式完成后：完整解析 Markdown 并渲染

#### 3.2 性能优化策略

**节流渲染：**
- 数据到达频率：可能每 10ms 一次
- 实际渲染频率：使用 requestAnimationFrame 或 50-100ms 定时器
- 效果：减少 80% 以上的渲染次数

**React 优化：**
- 使用 React.memo 包裹消息组件，避免父组件变化触发不必要的重渲染
- 利用 React Diff 机制，只更新变化的 DOM 节点
- 避免整个消息列表闪烁

**缓冲区累积：**
- 多个小数据块累积后一次性 setState
- 避免每个字符触发一次状态更新

---

### 4) 实施步骤

#### 4.1 Phase 1：Markdown 渲染基础

1. 安装依赖：markdown-to-jsx
2. 创建 MessageContent 组件：
   - 接收消息对象和渲染模式
   - 流式模式：显示纯文本 + 光标
   - 完成模式：解析 Markdown
3. 替换 Sidebar.tsx 中的纯文本渲染
4. 测试 Markdown 各种语法（代码块、列表、表格等）

#### 4.2 Phase 2：流式架构改造

1. Background 层：
   - 实现 SSE 或 Streaming Fetch 接口
   - 支持逐块推送数据到前端
   - 实现非流式接口（内部累积流式数据）

2. Sidebar 层：
   - 添加流式状态管理
   - 实现消息累积逻辑
   - 处理流式开始/进行中/完成状态
   - 自动滚动到底部

3. 消息传递：
   - 使用 browser.runtime.onMessage 监听流式数据
   - 或使用 Port 连接实现双向通信

#### 4.3 Phase 3：性能优化

1. 实现节流机制：
   - 使用 requestAnimationFrame 批量更新
   - 或使用 setTimeout 固定间隔更新

2. React 优化：
   - 使用 React.memo 包裹 MessageContent
   - 使用 useCallback 缓存回调函数
   - 避免不必要的状态更新

3. 用户体验增强：
   - 添加打字机光标动画
   - 平滑滚动到底部
   - 流式开始前显示"正在思考..."
   - 错误时降级为纯文本显示

#### 4.4 Phase 4：代码高亮（可选）

1. 集成 react-syntax-highlighter
2. 配置语言包按需加载
3. 自定义代码块样式，适配深色/浅色主题

---

### 5) 安全考虑

#### 5.1 XSS 防护

- markdown-to-jsx 直接输出 React 组件，不经过 HTML 字符串
- 不使用 dangerouslySetInnerHTML，天然防止 XSS
- AI 输出的恶意脚本会被 React 自动转义

#### 5.2 异常处理

- Markdown 解析失败时降级为纯文本显示
- 流式中断时保留已接收内容
- 网络错误时显示友好提示

---

### 6) 兼容性与迁移

#### 6.1 向后兼容

- 保留现有 CHAT 消息接口，默认走非流式路径
- 新增 CHAT_STREAM 消息接口，支持流式输出
- 前端根据配置或用户设置选择使用哪种接口

#### 6.2 数据迁移

- 历史消息格式无需迁移（只是渲染方式变化）
- 新增的 isStreaming 字段对旧消息默认为 false

---

### 7) 预期性能指标

| 指标 | 目标值 |
|------|--------|
| Markdown 解析时间 | <2ms（1000 字符） |
| 渲染帧率 | 50-100ms/次（节流后） |
| 流式过程 CPU 占用 | <5% |
| 内存增长 | <10MB（100 条消息） |
| 首屏渲染时间 | <50ms |

---

### 8) 验收标准

#### 8.1 Markdown 渲染

- ✅ 支持基础语法：加粗、斜体、删除线、链接
- ✅ 支持代码块和行内代码
- ✅ 支持列表（有序、无序、嵌套）
- ✅ 支持表格
- ✅ 支持引用块
- ✅ 代码高亮正确显示
- ✅ 深色/浅色主题适配

#### 8.2 流式输出

- ✅ 实时显示 AI 回复内容
- ✅ 打字机光标动画流畅
- ✅ 无明显卡顿或闪烁
- ✅ 自动滚动到底部
- ✅ 流式完成后正确解析 Markdown

#### 8.3 性能

- ✅ 长消息（>2000 字符）渲染流畅
- ✅ 多条消息快速切换无卡顿
- ✅ 内存占用合理，无明显泄漏

#### 8.4 异常处理

- ✅ Markdown 解析错误时降级为纯文本
- ✅ 流式中断时保留已接收内容
- ✅ 网络错误时显示友好提示

---

### 9) 未来扩展方向

#### 9.1 双缓冲区优化（可选）

如果容错式解析的体验不够理想，可升级为：
- 稳定区：已完成的 Markdown 段落
- 流式区：当前正在输出的纯文本
- 检测段落边界（双换行、代码块闭合）自动转换

#### 9.2 LaTeX 数学公式支持（可选）

- 集成 KaTeX 或 MathJax
- 支持行内公式和块级公式

#### 9.3 图片渲染（可选）

- 支持 AI 返回的图片链接
- 图片懒加载和缓存

#### 9.4 消息编辑与重新生成

- 允许用户编辑已发送的消息
- 支持重新生成 AI 回复

---

---

## Part 2: 字幕关键词批量翻译与第一级显示优化

### 0. 背景与问题

#### 当前问题
- 字幕关键词只有在悬停时才显示翻译（第二级）
- 用户需要逐个悬停才能看到翻译，效率低
- 没有直接的视觉反馈，学习体验不够直观

#### 改造目标
- 第一级直接显示关键词的基础翻译（如 `hello`<sub>你好</sub>）
- 批量翻译所有关键词，避免逐个请求
- 支持 Google/Bing/LLM 三种翻译方式
- 保留第二级详细解释（悬停显示完整词卡）

---

### 1) 新行为定义

#### 行为名：`translate_keywords`

**用途**：批量翻译字幕/网页中的关键词列表，用于第一级快速显示

**路由配置**：
- 允许 `RouteKind = 1`（LLM Channel）
- 允许 `RouteKind = 2`（Google Translate）
- 允许 `RouteKind = 3`（Bing Translate）

**添加到 Plan8 的行为路由表**：
```
behaviorRoutes: {
  translate_keywords: { kind: 1, channelId: 1 }  // 或 2/3
}
```

---

### 2) 数据流设计

#### 输入 Payload

```typescript
interface TranslateKeywordsPayload {
  keywords: string[];       // 关键词列表：["hello", "world", "morning"]
  context?: string;         // 可选：上下文句子，帮助 LLM 更准确翻译
  sourceLang: string;       // 源语言：en
  targetLang: string;       // 目标语言：zh
}
```

#### 输出格式

```typescript
// 返回数组，与输入关键词顺序一一对应
string[]  // ["你好", "世界", "早上"]
```

---

### 3) 实现方案

#### 3.1 核心思路：构造带换行符的字符串

**关键设计**：
- Google/Bing：将多个词用换行符拼接成一个字符串，一次请求完成
- LLM：使用专门的提示词，要求按行翻译
- 解析输出：按换行符分割，天然对齐

#### 3.2 Google/Bing 分支

**实现思路**：

1. **构造输入字符串**：
   - 将关键词数组用 `\n` 连接：`keywords.join('\n')`
   - 例：`["hello", "world"]` → `"hello\nworld"`

2. **调用现有接口**：
   - 直接使用 `googleTranslateProvider.translate(string, options)`
   - 或 `bingTranslateProvider.translate(string, options)`
   - 无需修改 provider 代码，换行符是普通字符

3. **解析输出**：
   - 按换行符分割：`output.split('\n').map(t => t.trim())`
   - 例：`"你好\n世界"` → `["你好", "世界"]`

**优势**：
- ✅ 只调用一次 API，避免频繁请求被风控
- ✅ 复用现有的 `translate()` 接口
- ✅ 输出行数与输入行数天然对齐

#### 3.3 LLM 分支

**实现思路**：

1. **构建专门的提示词**：
   - 使用新的 `buildTranslateKeywordsPrompt()`
   - 强调"每行一个词"、"严格按顺序"

2. **调用 LLM**：
   - 使用 `provider.chat()` 接口
   - 解析返回的文本，按换行符分割

3. **容错处理**：
   - 检查输出行数是否与输入匹配
   - 不匹配时降级或返回空数组

---

### 4) Background 实现架构

#### 4.1 使用 switch 而非 if（重要设计原则）

**强调**：为避免后续新增翻译方式时需要修改大量 if 语句，统一使用 switch 结构

**实现架构**：

```
registry.register('TRANSLATE_KEYWORDS', async (payload) => {
  const { keywords, context, sourceLang, targetLang } = payload;
  const settings = await getSettings();
  const route = resolveRoute('translate_keywords', settings);

  // 构造输入字符串（Google/Bing 通用）
  const inputString = keywords.join('\n');

  // 使用 switch 分支处理不同路由类型
  switch (route.kind) {
    case 1: {
      // LLM Channel 分支
      const channel = resolveChannel(route.channelId, settings);
      const provider = getChatProviderByChannel(channel);
      const prompt = buildTranslateKeywordsPrompt({keywords, context, ...});
      const response = await provider.chat([{role: 'user', content: prompt}]);
      return parseKeywordsTranslation(response, keywords.length);
    }

    case 2: {
      // Google Translate 分支
      const output = await googleTranslateProvider.translate(inputString, {
        from: sourceLang,
        to: targetLang
      });
      return output.split('\n').map(t => t.trim());
    }

    case 3: {
      // Bing Translate 分支
      const output = await bingTranslateProvider.translate(inputString, {
        from: sourceLang,
        to: targetLang
      });
      return output.split('\n').map(t => t.trim());
    }

    default: {
      // 未知路由，返回原词
      return keywords;
    }
  }
});
```

**设计优势**：
- ✅ 新增翻译方式（如未来的 DeepL）只需添加新 case
- ✅ 代码结构清晰，易于维护
- ✅ 避免 if-else 链条过长

---

### 5) LLM 提示词设计

#### 5.1 核心要求

**提示词名称**：`buildTranslateKeywordsPrompt()`

**关键内容**：

1. **角色定义**：
   - 你是一个专业的翻译助手
   - 专注于提供简洁准确的单词翻译

2. **任务说明**：
   - 翻译以下单词列表
   - 每行一个单词，每行输出该单词最常见的翻译
   - 严格按照输入顺序输出

3. **上下文提示（可选）**：
   - 如果提供了上下文句子，根据上下文选择最合适的翻译
   - 例：上下文 "Good morning! Hello world."

4. **输出格式约束**：
   - 每行只输出一个翻译结果
   - 只输出最常见的意思（不要多个释义）
   - 不要输出序号、解释或其他内容
   - 不要输出 JSON 或其他格式

5. **示例**：
   ```
   输入：
   hello
   world
   morning

   输出：
   你好
   世界
   早上
   ```

#### 5.2 提示词模板结构

```
角色：你是专业的翻译助手

任务：翻译以下{sourceLang}单词到{targetLang}，每行一个单词

[可选] 上下文：{context}

单词列表：
{keyword1}
{keyword2}
...

要求：
- 每行只输出一个翻译
- 只输出最常见的意思
- 考虑上下文选择合适翻译
- 严格按顺序输出
- 不要序号、解释或其他内容

输出示例：
翻译1
翻译2
...
```

---

### 6) 字幕渲染层改造

#### 6.1 调用时机

**字幕增强流程**：
1. 获取字幕文本 → ENHANCE_SUBTITLE（LLM 增强）
2. 提取关键词 → SELECT_KEYWORDS（LLM 选词）
3. **[新增]** 批量翻译关键词 → TRANSLATE_KEYWORDS
4. 渲染字幕 → 第一级显示关键词 + 翻译

#### 6.2 渲染格式

**方案 A：下标形式**（推荐）
```html
hello<sub>你好</sub>  world<sub>世界</sub>
```

**方案 B：括号形式**
```
hello(你好)  world(世界)
```

**选择建议**：下标形式视觉干扰更小

---

### 7) 缓存策略

#### 7.1 缓存 Key 设计

```typescript
const cacheKey = makeCacheKey('TRANSLATE_KEYWORDS', {
  keywords: keywords.sort().join('|'),  // 排序后拼接，避免顺序影响
  context: context || '',
  sourceLang,
  targetLang,
  provider: routeIdentity(route, settings)
});
```

#### 7.2 缓存时长

- 成功翻译：5 分钟（与其他行为一致）
- 失败降级：1 分钟

---

### 8) 容错处理

#### 8.1 行数不匹配

```
if (translations.length !== keywords.length) {
  // 降级策略：
  // 1. 记录警告日志
  // 2. 返回空数组（或部分匹配的结果）
  // 3. 前端降级为不显示翻译
}
```

#### 8.2 翻译失败

```
catch (error) {
  // 降级策略：
  // 1. 返回原词数组（keywords 本身）
  // 2. 前端只显示关键词高亮，不显示翻译
}
```

---

### 9) 并发处理

#### 场景：同时处理多句字幕

```
// 假设有 3 句字幕同时需要翻译
const batch1 = ["hello", "world"];      // 第 1 句的关键词
const batch2 = ["good", "morning"];     // 第 2 句的关键词
const batch3 = ["nice", "day"];         // 第 3 句的关键词

// 并发 3 个请求（每句一个请求）
const results = await Promise.all([
  translateKeywords({keywords: batch1, ...}),
  translateKeywords({keywords: batch2, ...}),
  translateKeywords({keywords: batch3, ...})
]);

// results[0]: ["你好", "世界"]
// results[1]: ["好", "早上"]
// results[2]: ["美好", "一天"]
```

**优势**：
- 每句字幕的关键词作为一个批次
- 多句字幕并发处理，提升效率
- 避免单词级别的频繁请求

---

### 10) 与现有 translateTerms 的关系

#### 对比分析

| 特性 | `translateTerms`（内部函数） | `TRANSLATE_KEYWORDS`（新行为） |
|------|---------------------------|------------------------------|
| **暴露给前端** | ❌ 否 | ✅ 是 |
| **使用场景** | ENHANCE_WEB、ENHANCE_SUBTITLE 内部调用 | 字幕第一级显示、未来扩展 |
| **输入格式** | 单词列表或整句 | 专注于单词列表 |
| **输出格式** | 字符串数组 | 字符串数组 |
| **是否独立缓存** | ❌ 否 | ✅ 是 |

#### 代码复用策略

**选项 A：共享底层实现**（推荐）
- TRANSLATE_KEYWORDS 和 translateTerms 都调用同一个核心函数
- 核心函数封装 switch 逻辑
- 避免代码重复

**选项 B：独立实现**
- TRANSLATE_KEYWORDS 完全独立实现
- translateTerms 保持不变
- 适合未来两者需求分化的情况

---

### 11) 实施步骤

#### Phase 1：核心功能实现

1. **新增行为路由配置**：
   - 在 Plan8 基础上扩展 `translate_keywords` 路由
   - Options UI 中添加配置项

2. **实现 Background 接口**：
   - 注册 `TRANSLATE_KEYWORDS` 消息处理器
   - 使用 switch 结构处理三种路由
   - 实现缓存和容错逻辑

3. **编写 LLM 提示词**：
   - 创建 `buildTranslateKeywordsPrompt()`
   - 测试不同 LLM 的输出稳定性

#### Phase 2：字幕渲染层集成

1. **修改字幕增强流程**：
   - 在 SELECT_KEYWORDS 后调用 TRANSLATE_KEYWORDS
   - 将翻译结果传递给渲染层

2. **更新 SubtitleOverlay**：
   - 支持渲染关键词 + 翻译（下标形式）
   - 保留悬停显示详细词卡的功能

3. **样式调整**：
   - 翻译下标的字体大小、颜色
   - 适配深色/浅色主题

#### Phase 3：测试与优化

1. **功能测试**：
   - 测试三种翻译方式（Google/Bing/LLM）
   - 测试批量翻译的准确性
   - 测试并发场景

2. **性能测试**：
   - 测试缓存命中率
   - 测试翻译延迟
   - 测试并发请求的吞吐量

3. **边界测试**：
   - 测试空关键词列表
   - 测试超长关键词列表
   - 测试翻译失败的降级逻辑

---

### 12) 验收标准

#### 12.1 功能完整性

- ✅ 支持 Google Translate 批量翻译
- ✅ 支持 Bing Translate 批量翻译
- ✅ 支持 LLM 批量翻译（带上下文）
- ✅ 第一级正确显示关键词翻译
- ✅ 第二级（悬停）仍显示详细词卡

#### 12.2 性能指标

| 指标 | 目标值 |
|------|--------|
| 批量翻译延迟（10 个词） | <500ms（Google/Bing），<1s（LLM） |
| 缓存命中率 | >80%（相同字幕场景） |
| 翻译准确率 | >95%（基础词汇） |

#### 12.3 用户体验

- ✅ 第一级翻译加载流畅，无明显延迟
- ✅ 翻译显示清晰，不干扰字幕阅读
- ✅ 翻译失败时优雅降级，只显示高亮

#### 12.4 异常处理

- ✅ 翻译 API 失败时降级为不显示翻译
- ✅ 输出行数不匹配时正确处理
- ✅ 网络错误时不阻塞字幕显示

---

### 13) 未来扩展方向

#### 13.1 网页增强集成

将 TRANSLATE_KEYWORDS 应用到网页关键词翻译：
- 网页文本的关键词也支持第一级显示翻译
- 统一字幕和网页的交互体验

#### 13.2 智能上下文提示

- 自动提取关键词周围的句子作为上下文
- 提高多义词的翻译准确度

#### 13.3 翻译质量反馈

- 允许用户标记翻译错误
- 收集反馈数据优化提示词

#### 13.4 预翻译与预加载

- 字幕预取时同步预翻译关键词
- 进一步减少用户等待时间

---

---

## Part 3: 路由配置清理与字幕功能重构

### 0. 问题诊断

#### 0.1 路由配置冗余问题

**问题发现**：
- ✅ `enhance_web` 路由在代码中**从未被使用**
- ✅ `ENHANCE_WEB` 行为只是 `select_keywords` + `translate` 的简单组合
- ❌ 但在 3 个地方定义了多余的 `enhance_web` 路由配置

**影响**：
- 增加用户配置负担（无用的配置项）
- 代码维护混乱（用户以为配置了会生效）
- 与实际行为不符（误导性命名）

---

#### 0.2 字幕增强功能设计缺陷

**当前设计（错误）**：
```
用户场景：看英文视频学英语
视频说：The unprecedented technological advancement...
原字幕：The unprecedented technological advancement...
       ↓ LLM 改写简化
显示字幕：Technology is improving fast...

❌ 问题：听到的和看到的完全不一样！
```

**正确设计应该是**：
```
用户场景：看中文视频学英语
视频说：科技进步改变了世界
原字幕：科技进步改变了世界
       ↓ LLM 翻译成适合水平的英文
显示字幕：Technology changed the world

✅ 对得上：听中文，看英文字幕学习
```

---

#### 0.3 核心问题总结

| 问题类型 | 具体问题 | 影响 |
|---------|---------|------|
| **路由冗余** | `enhance_web` 路由存在但从未使用 | 配置混乱、误导用户 |
| **功能错位** | `enhance_subtitle` 用在了错误的场景 | 用户体验差、听不懂视频 |
| **命名不当** | "字幕增强" 不能准确描述功能 | 用户不知道这是什么 |

---

### 1) 路由配置清理方案

#### 1.1 删除多余的 `enhance_web` 路由

**需要修改的文件**：

1. **类型定义**：`packages/core/src/types/index.ts`
   ```typescript
   // 删除这一行：
   enhance_web: { kind: 1, channelId: 1, extra: {} },
   ```

2. **存储迁移**：`apps/extension/src/shared/storage.ts`
   ```typescript
   // 删除这一行：
   enhance_web: { kind: 1, channelId: enhanceChannelId, extra: {} },
   ```

3. **UI 配置**：`apps/extension/src/ui/options/Options.tsx`
   ```typescript
   // 从 BehaviorKey 删除：
   - | "enhance_web"

   // 从 BEHAVIOR_KEYS 删除：
   - "enhance_web",

   // 从 BEHAVIOR_KIND_ALLOWLIST 删除：
   - enhance_web: [1],
   ```

4. **国际化文本**：
   - `public/_locales/zh_CN/messages.json` - 删除 `optionsBehavior_enhance_web` 和 `optionsBehaviorDesc_enhance_web`
   - `public/_locales/en/messages.json` - 删除对应的英文配置

---

#### 1.2 正确的路由配置表

**清理后的 behaviorRoutes**：

```typescript
behaviorRoutes: {
  // 原子能力路由（不可再拆分的 LLM/翻译能力）
  select_keywords: { kind: 1, channelId: 1 },      // LLM 从文本选关键词
  translate: { kind: 2 },                          // 翻译文本（Google/Bing/LLM）
  dictionary: { kind: 1, channelId: 1 },           // 词典查询
  chat: { kind: 1, channelId: 1 },                 // 对话聊天

  // Part 2 新增
  translate_keywords: { kind: 2 },                 // 批量翻译关键词

  // 待重构（见 1.3）
  adapt_subtitle: { kind: 1, channelId: 1 },       // 字幕学习翻译（原 enhance_subtitle）
}
```

---

**❓ 常见疑问：英文视频学英语场景需要独立路由吗？**

**场景：英文视频 + 英文字幕（学英语）**
```
操作：显示原字幕 + 关键词高亮
用到的路由：select_keywords
```

**答案：❌ 不需要独立路由**

**原因**：
- ✅ 这个场景只是 `select_keywords` 路由的直接使用
- ✅ 不涉及任何新的 LLM 能力（不翻译、不改写）
- ✅ 就像 `ENHANCE_WEB` 一样，只是原子操作的简单组合

**对比理解**：

| 场景 | 用到的路由 | 是否需要独立路由 | 原因 |
|-----|----------|----------------|------|
| **英文视频学英语** | `select_keywords` | ❌ 不需要 | 只是选关键词，没有新能力 |
| **中文视频学英语** | `adapt_subtitle` | ✅ 需要 | LLM 翻译+适配，独特能力 |
| **网页英文学习** | `select_keywords` + `translate` | ❌ 不需要 | 两个原子操作的组合 |

---

#### 1.3 `enhance_subtitle` 重命名方案（强烈推荐）

**问题诊断**：
- 当前名称："字幕增强"（`enhance_subtitle`）
- 实际功能：母语字幕 → LLM 翻译成适合水平的学习语言
- 问题：名称太模糊，用户不知道这是干什么的

---

**✅ 最终推荐方案**：

| 项目 | 旧名称 | 新名称 | 理由 |
|-----|-------|--------|------|
| **路由名称**（代码） | `enhance_subtitle` | `adapt_subtitle` | 简洁明确，"adapt"暗含翻译+调整难度 |
| **UI 中文名** | 字幕增强 | **字幕学习翻译** | 准确描述功能：翻译+学习 |
| **UI 英文名** | Enhance subtitles | **Adaptive Subtitle Translation** | 体现"适配"特性 |

**为什么选 `adapt_subtitle`**：
- ✅ 简洁（比 `translate_subtitle_for_learning` 短）
- ✅ 准确（adapt = 翻译 + 调整到适合水平）
- ✅ 与 `translate` 路由区分清楚：
  - `translate`：只翻译，不调整难度
  - `adapt_subtitle`：翻译 + 适配用户水平

**其他备选方案**（供参考）：

| 备选名称 | 优点 | 缺点 | 评分 |
|---------|------|------|------|
| `learning_subtitle` | 语义清晰 | 不够明确（学什么？） | ⭐⭐⭐ |
| `subtitle_translate_adapt` | 完整描述 | 太长 | ⭐⭐ |
| `translate_subtitle_to_target` | 明确方向 | 太长，没体现"适配" | ⭐⭐ |

---

**迁移计划**（如果改名）：

```typescript
// storage.ts 迁移逻辑
function migrateBehaviorRoutes(routes: any) {
  // 兼容旧配置
  if (routes.enhance_subtitle && !routes.adapt_subtitle) {
    routes.adapt_subtitle = routes.enhance_subtitle;
    delete routes.enhance_subtitle;
    console.log('[Migration] Renamed enhance_subtitle → adapt_subtitle');
  }
  return routes;
}
```

**是否必须改名**：
- ✅ **强烈推荐改名**（用户体验提升明显）
- ⏰ 建议在 Part 3 完成时一起改
- 📦 需要同步更新：代码、UI、国际化文本

---

### 2) 字幕功能重构方案

#### 2.1 场景分析与路由需求

**场景 1：英文视频 + 英文字幕（学英语）**
```
视频语言：英文
字幕语言：英文
用户目标：学英语

当前做法（错误）：
- 单语模式：LLM 改写英文字幕 → 简化的英文
  ❌ 听原声和看字幕对不上

正确做法：
- 单语模式：显示原始英文字幕 + 关键词高亮
  ✅ 听得懂，看得懂
- 双语模式：英文字幕 + 中文翻译
  ✅ 辅助理解

使用的路由：
  - select_keywords（选关键词）
  - translate（双语模式时翻译整句）

❓ 需要独立路由吗？
  ❌ 不需要！只是原子路由的直接使用
```

---

**场景 2：中文视频 + 中文字幕（学英语）**
```
视频语言：中文
字幕语言：中文
用户目标：学英语

当前做法：
- 功能缺失，没有这个场景的支持

正确做法：
- 单语模式：LLM 翻译中文字幕 → 适合水平的英文
  ✅ 听中文，看英文，学英语
- 双语模式：英文翻译 + 中文原文
  ✅ 对照学习

使用的路由：
  - adapt_subtitle（翻译+适配难度）
  - select_keywords（选关键词）

❓ 需要独立路由吗？
  ✅ 需要！adapt_subtitle 是独特的 LLM 能力
```

---

**核心区别总结**：

| 项目 | 场景 1（英文学英文） | 场景 2（中文学英文） |
|-----|------------------|------------------|
| **字幕语言** | = 学习语言 | = 母语 |
| **核心操作** | 显示原文 + 选词 | 翻译 + 适配 |
| **用到的路由** | `select_keywords` | `adapt_subtitle` + `select_keywords` |
| **需要独立路由** | ❌ 不需要 | ✅ 需要 |
| **为什么** | 只是原子操作的使用 | 有独特的 LLM 翻译+适配能力 |

---

#### 2.2 核心设计原则

**黄金法则**：
> **字幕改写/翻译的目的是"把不懂的变成懂的"，而不是"把懂的变成简单的"**

**判断逻辑**：
```typescript
function shouldTranslateSubtitle(
  subtitleLang: string,
  targetLearningLang: string,
  nativeLang: string
): boolean {
  // 如果字幕语言 == 学习语言 → 不翻译，直接显示 + 关键词
  if (subtitleLang === targetLearningLang) {
    return false;  // 场景 1：英文视频学英语
  }

  // 如果字幕语言 == 母语 → 翻译成学习语言
  if (subtitleLang === nativeLang) {
    return true;   // 场景 2：中文视频学英语
  }

  // 其他情况（第三语言字幕）→ 翻译成学习语言
  return true;
}
```

---

#### 2.3 实现方案

**修改文件**：`apps/extension/src/content/subtitle-controller.ts`

**关键逻辑修改**：

```typescript
// 旧逻辑（错误）：
private updateSubtitleDisplay(): void {
  const cue = this.cues[this.currentCueIndex];
  const enhanced = this.enhancer?.getEnhanced(cue.id);  // ❌ 总是调用改写

  if (this.mode === 'enhanced') {
    lines = [{ text: enhanced?.line1_final || cue.text, isEnhanced: true }];
  }
}

// 新逻辑（正确）：
private updateSubtitleDisplay(): void {
  const cue = this.cues[this.currentCueIndex];
  const cueLang = this.getCueSourceLanguage(cue, this.subtitleLanguage);

  // 判断是否需要翻译字幕
  const needTranslate = this.shouldTranslateSubtitle(
    cueLang,
    this.settings.targetLanguage,
    this.settings.nativeLanguage
  );

  if (this.mode === 'enhanced') {
    if (needTranslate) {
      // 场景 2：母语字幕 → 翻译成学习语言
      const enhanced = this.enhancer?.getEnhanced(cue.id);
      lines = [{ text: enhanced?.line1_final || cue.text, isEnhanced: true }];
    } else {
      // 场景 1：学习语言字幕 → 直接显示原文 + 关键词
      lines = [{ text: cue.text, isEnhanced: false }];
    }
  }
}
```

---

#### 2.4 SubtitleEnhancer 改造

**当前问题**：
- `enhancer.start()` 总是自动启动并改写所有字幕
- 没有判断是否需要改写

**修改方案**：

```typescript
// 文件：subtitle-controller.ts

async init(url: string): Promise<boolean> {
  // ... 现有初始化代码 ...

  // ❌ 删除这行：
  // this.enhancer.start();  // 不要自动启动

  // ✅ 改为按需启动：
  const cueLang = this.subtitleLanguage || this.settings.targetLanguage;
  const needTranslate = this.shouldTranslateSubtitle(
    cueLang,
    this.settings.targetLanguage,
    this.settings.nativeLanguage
  );

  if (needTranslate) {
    this.enhancer.start();  // 只在需要翻译时启动
    console.log('[SubtitleController] Enhancer started (translate mode)');
  } else {
    console.log('[SubtitleController] Enhancer disabled (direct display mode)');
  }
}
```

---

### 3) 前端 UI 改进

#### 3.1 Options 页面说明优化

**当前说明**（不清楚）：
```
字幕增强
仅支持 Channel（LLM）。
```

**优化后的说明**：
```
字幕翻译（母语 → 学习语言）
将母语字幕翻译成适合你水平的学习语言。
例如：看中文视频时，显示简化的英文字幕。
仅支持 LLM Channel。
```

**国际化 Key**：
- `optionsBehavior_enhance_subtitle` → 改为 "字幕翻译"
- `optionsBehaviorDesc_enhance_subtitle` → 改为上面的详细说明

---

#### 3.2 视频字幕模式按钮优化

**当前按钮文本**：
- "单语" / "双语"

**优化后的按钮文本**（根据场景动态显示）：

**场景 1：英文视频学英语**
```
按钮文本：
- "英文" / "中英"
说明：原始英文 或 英文+中文翻译
```

**场景 2：中文视频学英语**
```
按钮文本：
- "英文" / "中英"
说明：翻译的英文 或 英文+中文原文
```

---

### 4) 实施步骤

#### Phase 1：路由配置清理（低风险）

1. ✅ 删除 `enhance_web` 路由定义（4 个文件）
2. ✅ 删除对应的国际化文本（2 个文件）
3. ✅ 回归测试：确保网页增强功能仍正常（不受影响）

**预期结果**：
- Options 页面少一个无用的配置项
- 代码更清晰

---

#### Phase 2：字幕功能重构（高风险）

**2.1 添加判断逻辑**：
1. 实现 `shouldTranslateSubtitle()` 方法
2. 修改 `updateSubtitleDisplay()` 逻辑
3. 修改 `init()` 中的 enhancer 启动条件

**2.2 测试场景**：

| 场景 | 视频语言 | 字幕语言 | 学习语言 | 预期行为 |
|-----|---------|---------|---------|---------|
| 1 | 英文 | 英文 | 英文 | 显示原字幕 + 关键词 |
| 2 | 中文 | 中文 | 英文 | 翻译成英文显示 |
| 3 | 日文 | 日文 | 英文 | 翻译成英文显示 |
| 4 | 英文 | 英文 | 日文 | 显示原字幕（不翻译）|

**2.3 日志验证**：
- 场景 1：控制台显示 "Enhancer disabled (direct display mode)"
- 场景 2：控制台显示 "Enhancer started (translate mode)"

---

#### Phase 3：UI 说明优化（低风险）

1. 修改国际化文本（中英文）
2. 更新 Options 页面的帮助提示
3. 更新用户文档

---

### 5) 风险评估与降级方案

#### 5.1 风险点

| 风险 | 影响 | 概率 | 应对方案 |
|-----|------|------|---------|
| 字幕语言检测不准确 | 错误判断是否翻译 | 中 | 添加手动切换开关 |
| 翻译延迟高 | 字幕显示卡顿 | 低 | 预加载 + 缓存 |
| 用户不理解新逻辑 | 困惑 | 中 | 清晰的 UI 说明 |

#### 5.2 降级方案

**如果字幕翻译功能异常**：
1. 检测到连续失败 3 次 → 自动禁用翻译
2. 降级为显示原字幕 + 关键词
3. 显示通知："字幕翻译失败，已切换为原字幕模式"

---

### 6) 验收标准

#### 6.1 路由配置清理

- ✅ `enhance_web` 路由在所有文件中删除
- ✅ Options 页面不再显示 `enhance_web` 配置项
- ✅ 网页增强功能仍正常工作（关键词高亮）

#### 6.2 字幕功能正确性

- ✅ 英文视频 + 英文字幕：显示原字幕 + 关键词
- ✅ 中文视频 + 中文字幕：显示翻译的英文字幕
- ✅ 双语模式：显示学习语言 + 母语对照
- ✅ 控制台日志正确反映 enhancer 状态

#### 6.3 用户体验

- ✅ 英文视频：听到的和看到的一致（不改写原字幕）
- ✅ 中文视频：看到适合水平的英文字幕
- ✅ Options 页面说明清晰，用户理解功能

---

### 7) 后续优化方向

#### 7.1 手动控制开关（可选）

添加设置项：
```
[ ] 启用字幕翻译（母语 → 学习语言）
说明：看母语视频时，自动翻译成学习语言字幕
```

#### 7.2 智能语言检测优化

- 使用视频元数据（YouTube API）获取准确的字幕语言
- 支持用户手动标记字幕语言

#### 7.3 翻译质量分级

```
简单模式：直接翻译
进阶模式：翻译 + 适应水平（当前的 enhance_subtitle）
```

---

---

## 总体验收与发布

### 验收流程

1. **功能测试**：
   - Part 1: Markdown 渲染与流式输出
   - Part 2: 字幕关键词批量翻译

2. **回归测试**：
   - 确保现有功能不受影响
   - 测试各个行为路由的独立性

3. **性能测试**：
   - 测试整体内存占用
   - 测试并发场景下的稳定性

4. **用户体验测试**：
   - 邀请测试用户试用
   - 收集反馈并迭代

### 发布计划

- **Beta 版本**：先发布到内测用户
- **正式版本**：修复已知问题后发布
- **文档更新**：更新用户手册和 Options 说明
