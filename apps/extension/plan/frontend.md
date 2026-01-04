# LexiPath Extension 前端架构分析

## 1. UI 入口点（Manifest 定义）

扩展有 4 个主要 UI 入口点（定义在 `public/manifest.chrome.json`）：

| 入口点 | 类型 | 位置 | 用途 |
|---|---|---|---|
| **Popup** | 扩展弹窗 | `src/ui/popup/index.html` | 快速启用/禁用切换和设置访问 |
| **Options** | 设置页面 | `src/ui/options/index.html` | 完整的设置配置页面（在标签页中打开）|
| **Onboarding** | 欢迎向导 | `src/ui/onboarding/index.html` | 新用户的初始设置流程 |
| **Sidebar** | 侧边栏/聊天 | `src/ui/sidebar/index.html` | 聊天界面（作为侧边栏注入）|

---

## 2. 详细页面与组件

### A. POPUP 弹窗 (`src/ui/popup/`)

**文件：**
- `popup/index.html` - HTML 根文件
- `popup/main.tsx` - 入口点（渲染 `<Popup />` 组件）
- `popup/Popup.tsx` - 主组件

**功能：**
- 宽度：320px
- 显示扩展状态和开关切换
- 显示当前设置：
  - 目标语言（大写显示）
  - 熟练程度级别
  - 启用/禁用按钮（带颜色编码状态）
- "打开设置"按钮跳转到完整设置页面
- 通过 `GET_SETTINGS` 消息加载设置
- 通过 `SET_SETTINGS` 消息更新设置
- 加载状态带旋转动画

---

### B. OPTIONS 设置页面 (`src/ui/options/`)

**文件：**
- `options/index.html` - HTML 根文件（标题："LexiPath Settings"）
- `options/main.tsx` - 入口点
- `options/Options.tsx` - 主组件（1,321 行）

**主要功能：**

**1. Provider 配置区域**
- 3 个 LLM provider 的标签页/卡片：
  - OpenAI（base URL、model、API key、自定义 headers）
  - Claude（model、API key、base URL、自定义 headers）
  - Gemini（model、API key、base URL、自定义 headers）
- 每个 provider 都有测试连接按钮
- 输入验证和详细错误消息

**2. 路由与 Provider 选择**
- 下拉菜单选择关键词提取 provider（openai/claude/gemini）
- 下拉菜单选择翻译 provider（openai/claude/gemini/google/bing）
- 免费 provider 的测试按钮（Google Translate、Bing Translate）

**3. 并发设置**
- 每个渠道的并发请求限制数字输入框
- 范围：1-500 请求
- 支持：openai、claude、gemini、google、bing

**4. 语言设置**
- 母语选择器（支持多种语言）
- 目标语言选择器（支持多种语言）
- 熟练程度级别选择器（CEFR 级别：A1、A2、B1、B2、C1、C2）

**5. 网站规则**
- 切换：应用于所有网站 OR 白名单模式
- 排除网站列表编辑器
- 允许网站列表编辑器
- 都支持添加/删除功能

**6. 使用的 UI 组件：**
- `InputField` - 带验证和错误显示的文本输入框
- `TextareaField` - JSON 的多行输入（自定义 headers）
- `SelectField` - 下拉选择器
- `ListEditor` - 从列表中添加/删除项目

**7. 状态管理：**
- 挂载时通过 `GET_SETTINGS` 加载设置
- 表单状态跟踪所有字段值和错误
- 保存前验证
- 成功/错误通知
- 带加载状态的保存按钮

---

### C. ONBOARDING 欢迎向导 (`src/ui/onboarding/`)

**文件：**
- `onboarding/index.html` - HTML 根文件（标题："Welcome to LexiPath"）
- `onboarding/main.tsx` - 入口点
- `onboarding/Onboarding.tsx` - 主组件（490 行）

**3 步向导流程：**

**步骤 1：语言与级别选择**
- 目标语言选项卡网格（可点击选择）
- 熟练程度选项根据语言变化：
  - 日语（ja）：JLPT 级别（N5、N4、N3、N2、N1）
  - 韩语（ko）：TOPIK 级别（1-6）
  - 其他语言：CEFR 级别（A1-C2）
- 在不同熟练度系统之间切换时动态重置

**步骤 2：学习场景**
- 4 个切换卡片用于启用学习上下文：
  - 网页（母语）
  - 网页（目标语言）
  - 视频（母语）
  - 视频（目标语言）
- 每个都有复选框样式切换

**步骤 3：摘要与确认**
- 显示所选语言
- 显示所选熟练程度级别
- 关于稍后在完整设置中更改设置的注释

**UI 组件：**
- `ProgressIndicator` - 带步骤计数器的 3 步进度条
- `OptionCard` - 带单选按钮的可点击选择卡片
- `SceneCard` - 带复选框的切换卡片
- 上一步/下一步按钮用于导航
- 完成按钮（保存设置并关闭窗口）

---

### D. SIDEBAR 侧边栏聊天 (`src/ui/sidebar/`)

**文件：**
- `sidebar/index.html` - HTML 根文件（标题："LexiPath Chat"）
- `sidebar/main.tsx` - 入口点
- `sidebar/Sidebar.tsx` - 主组件（188 行）

**聊天界面：**
- 全屏聊天 UI（高度：`h-screen` flex 列布局）

**标题栏：**
- 标题："Chat"
- 清除对话按钮（带确认对话框）

**消息区域：**
- 可滚动的消息历史
- 用户消息：右对齐、蓝色背景、白色文字
- 助手消息：左对齐、白色背景带边框
- 每条消息带时间戳
- 带 3 个跳动点的加载动画
- 无消息时的空状态消息

**输入区域：**
- 带占位符的文本输入框
- 发送按钮（输入为空或加载时禁用）
- Enter 键发送，Shift+Enter 换行（可能支持）
- 加载期间禁用状态

**状态管理：**
- 带角色（user/assistant）和时间戳的消息数组
- 多轮对话的对话 ID 跟踪
- 底部错误显示
- 发送 `CHAT` 消息类型
- 通过 conversationId 维护对话上下文

---

## 3. 可复用 UI 组件 (`src/ui/components/`)

### WordCard (`src/ui/components/WordCard.tsx`)

**用途：** 在卡片格式中显示单词信息

**数据结构：**
```typescript
interface WordCardData {
  word: string;
  phonetic?: string;
  definition: string;
  difficulty?: string;
  isFavorited?: boolean;
  isLearned?: boolean;
}
```

**功能：**
- 单词 + 音标显示
- 难度徽章（颜色编码）：
  - 绿色：简单（A1-A2）
  - 黄色：中等（B1-B2）
  - 红色：困难（C1-C2）
- 定义文本
- **操作按钮：**
  - 发音（TTS）- 使用 @lexipath/dictionary 的 `speak()` 函数
  - 收藏切换（星形图标，激活时为黄色）
  - 标记为已学习切换（对勾，激活时为绿色）
- 关闭按钮（仅点击模式）
- 收藏/已学习更改的回调
- 每个单词的 TTS 语言支持

**样式：**
- 白色卡片带阴影
- 最小宽度：280px，最大：400px
- 蓝色强调色（#3b82f6）
- 响应式操作按钮带悬停状态

---

### WordCardPopover (`src/ui/components/WordCardPopover.tsx`)

**用途：** 悬停或点击时显示单词详情的浮动提示

**功能：**

**定位：**
- 自动计算位置以避免视口边缘
- 默认放置在锚点下方，无空间时放在上方
- 尽可能水平居中
- 尊重边距以避免边缘裁剪

**加载与获取：**
- 获取单词数据时显示加载旋转器
- 发送 `EXPLAIN_WORD` 消息获取定义、音标、难度
- 如果定义不可用则优雅降级

**模式：**
- `click`：点击外部关闭，保持打开
- `hover`：300ms 后自动关闭，鼠标进入可延长

**功能：**
- 从设置解析 TTS 语言（ja-JP、en-US 等）
- 内部渲染完整 WordCard 及所有功能
- 固定 z-index：10000（高优先级）
- 不透明度过渡动画
- 获取期间卸载的取消支持

---

## 4. Content Script UI 覆盖层 (`src/content/`)

### A. Subtitle Overlay 字幕覆盖层 (`src/content/subtitle-overlay.ts`)

**用途：** 在视频平台（YouTube、Bilibili）上渲染增强字幕

**功能：**

**Shadow DOM 渲染：** 隔离样式，不会与页面 CSS 冲突

**字幕模式：**
- `enhanced`：仅显示增强字幕
- `bilingual`：同时显示原始和增强字幕
- `bilingual-temp`：临时双语显示

**单词交互：**
- 点击字幕中的单词显示单词卡片
- 悬停单词显示定义提示
- 可固定单词卡片
- 单词高亮

**显示选项：**
- 模式切换按钮（控制增强/双语显示）
- 字体大小与视频播放器同步
- 字幕定位（视频下方或覆盖）
- ResizeObserver 用于动态字体大小调整

**子组件：**
- 字幕行容器（Shadow DOM）
- 模式切换按钮
- 单词卡片容器
- 带数据属性的交互式单词元素

---

### B. Enhanced Text 增强文本 (`src/content/enhanced-text.ts`)

**用途：** 将纯文本转换为带单词高亮的 HTML（用于网页）

**输出：**
- DocumentFragment 带原始文本和增强的 span
- `<span class="lexipath-word">` 元素用于要学习的单词

**功能：**

**单词匹配：**
- 不区分大小写的匹配
- 尊重字母数字文本的单词边界
- 确定性地处理重复出现

**Span 上的数据属性：**
- `data-original`：原始单词
- `data-converted`：翻译/转换后的单词
- `data-difficulty`：CEFR 级别
- `data-render-mode`：'target-to-native' 或 'native-to-target'
- `data-tooltip`：悬停提示文本

**渲染模式：**
- `target-to-native`：显示原始单词，提示显示翻译
- `native-to-target`：显示翻译并在括号中显示原文，提示显示原文

**样式（注入）：**
```css
.lexipath-word {
  background: rgba(59, 130, 246, 0.18) !important;
  border-bottom: 2px dotted #3b82f6 !important;
  border-radius: 3px !important;
  padding: 0 2px !important;
}
```

---

### C. Simple Tooltip 简单提示 (`src/content/index.ts` 244-330 行)

**用途：** 为常规网页上的单词显示悬停提示

**功能：**
- 单一固定提示元素（`#lexipath-tooltip`）
- 带智能定位跟随鼠标指针
- 文本内容来自单词的 `data-tooltip` 属性
- 深色半透明背景（rgba(15, 23, 42, 0.92)）
- 背景模糊效果
- Z-index：2147483647（z-index 的最大整数）
- Pointer-events：none（不干扰交互）

---

## 5. 页面处理流水线 (`src/content/index.ts`)

**文本元素选择：**
- 目标：`p`、`h1-h6`、`li`、`td`、`blockquote`、`article p`、`.content p` 等
- 排除：scripts、iframes、content-editable、隐藏元素
- 最小长度：20 个字符
- 每个请求最大长度：2000 个字符

**处理流程：**
1. **Mutation Observer** - 监视新 DOM 节点
2. **Element Queue** - 视口可见元素优先队列
3. **Concurrency Control** - 最多同时处理 3 个元素
4. **Intersection Observer** - 元素进入视口时懒加载（400px 边距）
5. **Enhancement** - 通过 `ENHANCE_WEB` 消息将文本发送到后台
6. **Fragment Creation** - 将响应转换为带 span 的增强 HTML
7. **DOM Replacement** - 用增强片段替换文本节点

**状态管理：**
- 基于令牌的导航检测
- 用于元素跟踪的 WeakMaps
- 基于签名的去重（防止重复处理相同内容）
- requestIdleCallback 用于后台处理

---

## 6. 消息通信系统

**UI 中使用的消息类型：**
位于 `src/shared/messages.ts`

| 消息类型 | 方向 | Payload | Response | 使用者 |
|---|---|---|---|---|
| `GET_SETTINGS` | UI → Background | undefined | Settings 对象 | 所有 UI 页面 |
| `SET_SETTINGS` | UI → Background | 部分 Settings | null | Popup、Options、Onboarding |
| `EXPLAIN_WORD` | Content → Background | {word: string} | WordCardData | WordCardPopover |
| `CHAT` | Sidebar → Background | {message, conversationId?} | {reply, conversationId} | Sidebar |
| `ENHANCE_WEB` | Content → Background | {content, sourceLang?, targetLang?} | WebEnhanceOutput | Content script |
| `ENHANCE_SUBTITLE` | Content → Background | Subtitle data | 增强字幕 | SubtitleController |
| `SELECT_KEYWORDS` | Content → Background | {text, scene?, sourceLang?, ...} | string[] | Content script |
| `TEST_PROVIDER_CONNECTION` | Options → Background | Provider config | true | Options 页面 |
| `REQUEST_HOST_PERMISSION` | UI → Background | {origin: string} | boolean | 可选权限请求 |

---

## 7. 样式

**CSS 位置：** `src/ui/styles.css`

**框架：** Tailwind CSS 配合 PostCSS

**功能：**
- 带 Tailwind 指令的基础样式
- 系统字体栈
- 通过 `prefers-color-scheme: dark` 媒体查询支持暗模式
- 在所有主要入口点导入

**配色方案：**
- 主色：#3b82f6（blue-500）
- 次要颜色：各种灰色阴影
- 状态颜色：绿色（成功）、黄色（警告）、红色（错误）

---

## 8. 目录结构摘要

```
lexipath/apps/extension/src/ui/
├── components/
│   ├── WordCard.tsx              # 单词显示卡片
│   ├── WordCardPopover.tsx       # 浮动单词提示
│   └── index.ts                  # 组件导出
├── popup/
│   ├── index.html               # Popup HTML
│   ├── main.tsx                 # 入口点
│   └── Popup.tsx                # 快速设置切换
├── options/
│   ├── index.html               # 设置 HTML
│   ├── main.tsx                 # 入口点
│   └── Options.tsx              # 完整设置表单
├── onboarding/
│   ├── index.html               # 欢迎 HTML
│   ├── main.tsx                 # 入口点
│   └── Onboarding.tsx           # 设置向导
├── sidebar/
│   ├── index.html               # 聊天 HTML
│   ├── main.tsx                 # 入口点
│   └── Sidebar.tsx              # 聊天界面
└── styles.css                    # 全局 Tailwind 样式

lexipath/apps/extension/src/content/
├── index.ts                      # 主 content script（网页）
├── subtitle-overlay.ts           # 视频字幕渲染
├── enhanced-text.ts              # 单词高亮
├── subtitle-controller.ts        # 视频平台检测
├── subtitle-enhancer.ts          # 字幕处理
└── subtitle-providers/           # 平台特定字幕提取
```

---

## 9. 关键集成点

**1. 设置流程：**
- Onboarding → 保存初始设置 → Popup/Options 更新 UI

**2. 单词学习流程：**
- Content script 高亮单词 → 用户悬停/点击
- WordCardPopover 出现 → `EXPLAIN_WORD` 消息
- 用户点击收藏/已学习 → 触发回调

**3. 字幕学习：**
- SubtitleController 检测视频平台
- 发送 `ENHANCE_SUBTITLE` 消息
- SubtitleOverlay 渲染并支持单词交互

**4. 聊天：**
- Sidebar 发送 `CHAT` 消息
- Background 维护对话上下文
- 消息带时间戳累积

---

## 总结

这个全面的架构使 LexiPath 能够在网页、视频（YouTube/Bilibili）上增强学习，并在浏览器扩展中提供对话式 AI 聊天界面。
