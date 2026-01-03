# PLAN-4: 字幕优化

## Status（Implementation Notes）

- ✅ 需求一（字号自适应）：已完成（`SubtitleOverlay` 使用 ResizeObserver + CSS 变量）
- ✅ 需求二（去掉背景框）：已完成（改为多层 `text-shadow` 描边）
- ✅ 需求三（B 站多 P cid 错乱）：已完成（`parseVideoInfo` 解析 `?p=`，`getCid` 按页选择）
- ✅ 需求四（exactOptionalPropertyTypes 类型错误）：已完成（条件展开 + 类型修复 + test mock 返回类型）
- ✅ 需求五（监听平台字幕按钮开关）：已完成（监听按钮状态，关闭则 `overlay.clear()`）
- ✅ 需求六（sourceLang 传递错误）：已完成（通过 `SubtitleFetchResult.lang` / `cue.lang` 传递实际字幕语言）

**涉及文件**:
- `apps/extension/src/content/subtitle-overlay.ts`
- `apps/extension/src/content/subtitle-controller.ts`
- `packages/subtitles/src/bilibili/index.ts`
- `apps/extension/src/content/subtitle-providers/create-subtitle-provider.ts`
- `apps/extension/src/content/subtitle-providers/youtube-subtitle-provider.ts`
- `apps/extension/src/content/subtitle-providers/bilibili-subtitle-provider.ts`
- `apps/extension/src/content/subtitle-controller.test.ts`

---

## 需求一：字幕大小自适应

### 问题
当前字幕使用固定像素值（主字幕 20px，原文 16px），无论窗口大小都不变。

### 解决方案
字体大小 = 视频高度 × 4%，设置上下限（14px - 60px）

### 实现思路
1. 用 `ResizeObserver` 监听视频容器尺寸变化
2. 用 CSS 变量存储字体大小，JS 动态更新
3. 在 mount 时初始化，尺寸变化时重新计算
4. 加防抖避免频繁更新

### 预期效果
| 视频高度 | 主字幕 | 原文字幕 |
|---------|-------|---------|
| 360px | 14px | 11px |
| 720px | 29px | 23px |
| 1080px | 43px | 34px |

### 备注
- 单词卡片保持固定大小，不随视频缩放

---

## 需求二：去掉字幕背景框

### 问题
当前字幕有 80% 不透明度的黑色背景框（`rgba(0,0,0,0.8)`），遮挡视频画面。

### 解决方案
去掉背景，改用文字描边（多层 text-shadow）保证可读性。

### 实现思路
1. 删除 `.lexipath-subtitle` 的 `background` 和 `padding`
2. 用多层 `text-shadow` 实现描边效果，确保在任何背景色上都清晰
3. 参考 YouTube 默认字幕的样式

---

## 需求三：修复 B站多P视频字幕错乱

### 问题
B站多P视频（分P视频）字幕与画面对不上。

**根本原因**：`packages/subtitles/src/bilibili/index.ts` 第 100 行：
```typescript
const cidCandidate = parsed.data?.pages?.[0]?.cid ?? parsed.data?.cid;
```
总是取第一个分P（`pages[0]`）的 cid，而不是当前正在播放的分P。

### 解决方案
从 URL 中解析当前分P号（`?p=N`），取对应分P的 cid。

### 实现思路
1. 修改 `parseVideoInfo` 函数，解析 URL 中的 `p` 参数
2. 修改 `getCid` 函数，接收可选的 `pageNumber` 参数
3. 根据 `pageNumber` 取 `pages[pageNumber - 1]?.cid`（注意 p 是从 1 开始的）
4. 在 `BilibiliSubtitleProvider.init` 中传递正确的分P号

---

## 需求四：修复 TypeScript 类型错误

### 问题
项目启用了 `exactOptionalPropertyTypes: true`，导致可选属性传递时类型不兼容。

### 错误列表

1. **`create-subtitle-provider.ts:12`**
   - 传递 `options.onSubtitlesMayBeAvailable` 时类型为 `(() => void) | undefined`
   - 但目标期望 `{ onSubtitlesMayBeAvailable?: () => void }`

2. **`youtube-subtitle-provider.ts:29`**
   - 赋值 `this.onSubtitlesMayBeAvailable = options.onSubtitlesMayBeAvailable`
   - 属性类型不允许 undefined

3. **`subtitle-controller.test.ts:440`**
   - mock 函数返回类型 `Promise<unknown>` 与期望的 `Promise<Response<unknown>>` 不匹配

### 实现思路
1. `create-subtitle-provider.ts`：用条件展开避免传递 undefined
2. `youtube-subtitle-provider.ts`：属性类型添加 `| undefined`
3. `subtitle-controller.test.ts`：修复 mock 函数的返回类型

---

## 需求五：监听平台字幕按钮，同步开关状态

### 问题
当前插件字幕是"强制"显示的：
- 只要能获取到字幕数据，就会显示插件字幕
- 用户在平台上关闭字幕（点击 CC 按钮），插件字幕依然显示
- 用户无法通过平台的字幕开关控制插件字幕

### 解决方案
监听平台的字幕按钮状态，用户关闭则插件也关闭。

### 实现思路
1. YouTube：监听 `.ytp-subtitles-button` 的 `aria-pressed` 属性变化
2. B站：监听字幕开关按钮的状态变化
3. 当用户关闭平台字幕时，调用 `overlay.clear()` 隐藏插件字幕
4. 当用户开启平台字幕时，恢复插件字幕显示

---

## 需求六：修复 sourceLang 传递错误

### 问题
`subtitle-controller.ts:304` 把**用户想学的语言**（targetLanguage）作为**字幕原始语言**（sourceLang）传给了 AI。

```typescript
sourceLang: this.settings.targetLanguage,  // ❌ 错误
```

### 实际影响
1. 用户设置：目标语言 = 英文（想学英文）
2. B站视频字幕：ai-zh（中文）
3. 代码传递：`sourceLang: 'en'`
4. AI 收到的提示：`请把下面的 英语 字幕改写...`
5. AI 看到中文字幕，以为要翻译成英语 → 全部翻译成英文

### 解决方案
`sourceLang` 应该是字幕的**实际语言**（从 cue.lang 或字幕轨道的 languageCode 获取）。

### 实现思路
1. `SubtitleFetchResult` 增加 `lang` 字段，返回字幕的实际语言
2. `SubtitleController` 保存字幕的实际语言
3. 调用 `ENHANCE_SUBTITLE` 时传递正确的 `sourceLang`

---

## 参考资料

- [Subtitle Font Size: Choosing the Right One](https://www.md-subs.com/blog/saa-subtitle-font-size)
- [YouTube Caption Settings](https://support.google.com/youtube/answer/100078)

---

## Git 提交要求

遵循 `docs/DEVELOPMENT.md` 第 14 节的规范：

1. 每完成一个需求，单独提交一次
2. 提交信息格式：`<type>(<scope>): <subject>`
   - 例如：`fix(subtitles): 修复 B站多P视频字幕错乱`
3. 确保 `bun run typecheck` 通过后再提交
4. 不要一次性提交所有修改
