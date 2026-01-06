# 提示词工厂模式设计讨论

**日期**：2026-01-06
**状态**：设计完成，待实施
**相关**：PLAN-11 提示词模板系统

---

## 背景

PLAN-11 已完成提示词模板系统（`PromptTemplateInput` + `renderPromptTemplate`），并迁移了所有 `build*Prompt` 函数。但存在以下问题：

### 当前问题

1. **硬编码问题**：各 `build*Prompt` 函数中的 `role/scene/style/task` 都是硬编码的
   ```typescript
   // 当前实现 - buildSubtitleEnhancePrompt
   role: '你是字幕增强助手。',  // 硬编码
   scene: '当前环境：视频字幕增强场景。',  // 硬编码
   style: '风格：适合字幕显示，表达自然清晰，不添加原文没有的信息。',  // 硬编码
   task: '任务：...',  // 硬编码
   ```

2. **无法适配不同场景**：YouTube 动漫、Coursera 学术、新闻阅读等场景无法使用不同的 prompt 风格

3. **缺少组合能力**：场景和风格应该是独立的、可组合的组件，而不是绑定在一起

4. **userInfo 重复传递**：每次调用都需要手动构建 userInfo，职责不清晰

---

## 设计目标

### 核心原则

1. **组件化**：scene、style 等应该是独立的、可复用的组件
2. **可组合**：任意场景 + 任意风格组合，不预先绑定
3. **配置驱动**：提示词片段通过配置（字典）管理，而不是硬编码
4. **职责分离**：
   - BEHAVIORS 配置：定义每个行为的完整配置
   - SCENES/STYLES 字典：可复用、可组合的片段
   - `PromptBuilder`：查找和组装
   - `build*Prompt`：纯函数，接受值
   - 调用者：只传业务参数

5. **简单实用**：不过度抽象，保持可读性和可维护性

---

## 最终确定的架构

### 1. BEHAVIORS 配置（行为定义）

**用途**：定义每个行为的完整配置（role、task、outputFormat、outputNotes）

```typescript
// packages/core/src/prompting/behaviors.ts

export const BEHAVIORS = {
  subtitle_enhance: {
    role: '你是字幕增强助手。',
    taskTemplate: (level: CEFRLevel, mode: 'single' | 'bilingual') =>
      mode === 'single'
        ? `任务：将<用户输入>中的字幕改写到符合 CEFR ${level} 水平...`
        : `任务：将<用户输入>中的字幕处理为双语展示...`,
    outputFormat: (mode: 'single' | 'bilingual') =>
      mode === 'single'
        ? '{ "line1_final": "" }'
        : '{ "line1_final": "", "line2_final": "" }',
    outputNotesTemplate: (level: CEFRLevel) => [
      `词汇与语法难度适配 CEFR ${level}`,
      '保持核心含义不变',
      '只输出一个 JSON 对象'
    ].join('\n')
  },

  explain_word: {
    role: '你是词汇学习助手。',
    taskTemplate: (level: CEFRLevel) =>
      `任务：为一个 CEFR ${level} 水平的语言学习者解释单词...`,
    outputFormat: () =>
      '{ "translation": "", "phonetic": "", "difficulty": "", ... }',
    outputNotesTemplate: (level: CEFRLevel) => '...'
  },

  english_correction: {
    role: '你是英文写作纠错助手。',
    taskTemplate: () => '任务：检查<用户输入>是否存在语法/拼写/用词错误...',
    outputFormat: () => '{ "hasError": boolean, "corrected": string | null, "message": string }',
    outputNotesTemplate: () => '...'
  },

  // ... 其他 behaviors
} as const;

export type BehaviorKey = keyof typeof BEHAVIORS;
```

**设计特点**：
- role 与 behavior 绑定（一对一）
- task 与 behavior 绑定，但支持动态参数（level, mode 等）
- outputFormat 根据业务参数动态生成
- outputNotes 可根据参数定制

---

### 2. SCENES 字典（默认场景，支持 fallback）

**用途**：提供默认的类型级场景，作为 fallback

```typescript
// packages/core/src/prompting/scenes.ts

export const PROMPT_SCENES = {
  'video_subtitle': '视频字幕',
  'news_reading': '新闻阅读',
  'article_reading': '文章阅读',
  'social_media': '社交媒体',
  'text_input': '文本输入',
  'generic': '通用场景'
} as const;

export type SceneKey = keyof typeof PROMPT_SCENES;
```

**设计特点**：
- **默认提供类型级场景**（video_subtitle, news_reading 等）
- **允许具体平台**：如果传入 'bilibili' / 'youtube' 等字典里没有的值，直接使用
- **Fallback 机制**：`PROMPT_SCENES[key] || key`，字典查不到就用原值
- 使用 `as const` 确保类型安全
- 导出类型别名，提供 IDE 自动补全

**示例**：
```typescript
// 使用默认场景
scene: 'video_subtitle'  // → 从字典查找：'视频字幕'

// 使用具体平台
scene: 'bilibili'  // → 字典里没有，直接用：'bilibili'

// 省略（使用默认）
scene: undefined  // → 使用 'generic'
```

---

### 3. STYLES 字典（用户选择完整风格）

**用途**：完整的风格定义，用户在 UI 中选择一个

```typescript
// packages/core/src/prompting/styles.ts

export const PROMPT_STYLES = {
  'default': '风格：适合字幕显示，表达自然清晰，不添加原文没有的信息。',

  'anime': '风格：适合字幕显示，表达自然清晰；保留角色称谓与敬称体系（例：琳奈ちゃん → 琳奈酱）；语气词允许保留（吧/呢/呀/啊/哦），但不要无意义堆叠；不添加原文没有的信息。',

  'academic': '风格：适合字幕显示，表达自然清晰；专业术语必须准确；逻辑严谨、风格正式；不添加原文没有的信息。',

  'casual': '风格：口语化、自然流畅，不添加原文没有的信息。',

  'minimal': '风格：保持原意与主要语气，尽量少改，不添加原文没有的信息。'
} as const;

export type StyleKey = keyof typeof PROMPT_STYLES;
```

**设计特点**：
- **完整风格定义**：每个 style 是完整的风格描述（包含"风格："前缀）
- **用户选择**：用户在 Settings UI 中选择一个风格
- **保持现有提示词风格**：与当前 `buildSubtitleEnhancePrompt` 等函数的风格定义保持一致
- **单选而非组合**：用户选择 'anime' / 'academic' / 'casual' 其中一个，不是组合多个片段

**工作流程**：
1. 用户在 Settings UI 选择风格：'anime' / 'academic' / 'casual'
2. 保存到 `Settings.promptStyle`（新字段）
3. PromptBuilder 从 Settings 读取用户选择的风格
4. 查找 `PROMPT_STYLES[userStyle]` 获取完整风格文本
5. 直接用于 `PromptTemplateInput.style`

---

### 4. PromptBuilder 类（异步方案）

**职责**：
- 注入 getSettings getter（动态获取最新配置）
- 从组件库查找 scene/style
- 自动构建 userInfo
- 调用底层 `build*Prompt` 函数

```typescript
// packages/providers/src/prompts/prompt-builder.ts

export class PromptBuilder {
  constructor(
    private getSettings: () => Promise<Settings>  // ← 异步
  ) {}

  private async getUserInfo(): Promise<PromptUserInfo> {
    const settings = await this.getSettings();  // ← 唯一的 await
    return {
      motherTongue: settings.nativeLanguage,
      targetLearningLanguage: settings.targetLanguage,
      cefrLevel: settings.userLevel,
      levelReferenceLine: settings.proficiencyPreference
        ? buildProficiencyReferenceLine(...)
        : undefined
    };
  }

  async buildSubtitlePrompt(options: {
    subtitle: string;
    mode: 'single' | 'bilingual';
    scene?: SceneKey | string;    // ← 可选，单个值
    style?: StyleKey | string;     // ← 可选，单个值（不是数组）
  }): Promise<string> {  // ← 异步方法
    const settings = await this.getSettings();
    const userInfo = await this.getUserInfo();
    const behavior = BEHAVIORS.subtitle_enhance;

    // 解析 scene
    const sceneValue = options.scene
      ? (PROMPT_SCENES[options.scene as SceneKey] || options.scene)
      : PROMPT_SCENES.generic;

    // 解析 style（从用户选择或参数）
    const userStyle = options.style || settings.promptStyle || 'default';
    const styleValue = PROMPT_STYLES[userStyle as StyleKey] || userStyle;

    return buildSubtitleEnhancePrompt(
      { subtitle: options.subtitle, mode: options.mode, sceneValue, styleValue },
      userInfo,
      behavior
    );
  }

  // ... 其他方法
}
```

**设计要点**：
- 全异步方案（所有 build 方法都是 async）
- 不需要 init/refresh（利用 getSettings 的缓存机制）
- 职责单一（只负责查找和组装）
- 结构经济（无状态管理）
- **style 优先级**：参数 > Settings.promptStyle > 'default'

---

### 5. build*Prompt 函数（纯函数层）

**改动点**：接受解析后的值 + userInfo + behavior

```typescript
// packages/providers/src/prompts/subtitle-enhance-prompt.ts

export function buildSubtitleEnhancePrompt(
  options: {
    subtitle: string;
    mode: 'single' | 'bilingual';
    sceneValue: string;        // ← 改：接受值
    styleValue: string;        // ← 改：接受单个值（不是数组）
    contextInfo?: PromptContextInfo;
  },
  userInfo: PromptUserInfo,    // ← 新增
  behavior: typeof BEHAVIORS.subtitle_enhance  // ← 新增
): string {
  // 构建 scene
  const scene = `当前环境：${options.sceneValue}场景。`;

  // 构建 style（直接使用完整风格定义）
  const style = options.styleValue;

  // 从 behavior 获取
  const role = behavior.role;
  const task = behavior.taskTemplate(userInfo.cefrLevel, options.mode);
  const outputFormat = behavior.outputFormat(options.mode);
  const outputNotes = behavior.outputNotesTemplate(userInfo.cefrLevel);

  // 组装 PromptTemplateInput
  const templateInput: PromptTemplateInput = {
    role, scene, style, task,
    userInfo,
    contextInfo: options.contextInfo,
    userInput: options.subtitle,
    outputFormat,
    outputNotes
  };

  return renderPromptTemplate(templateInput);
}
```

**注意**：style 已经是完整的定义（包含"风格："前缀），直接使用即可。

---

### 6. 使用示例

```typescript
// apps/extension/src/background/index.ts

const promptBuilder = new PromptBuilder(() => getSettings());

// 动漫字幕（使用 anime 风格）
const prompt1 = await promptBuilder.buildSubtitlePrompt({
  subtitle: 'そんなことないよ、琳奈ちゃん！',
  mode: 'bilingual',
  scene: 'video_subtitle',
  style: 'anime'  // ← 单个风格
});

// 学术字幕（使用 academic 风格）
const prompt2 = await promptBuilder.buildSubtitlePrompt({
  subtitle: 'The gradient descent algorithm...',
  mode: 'bilingual',
  scene: 'video_subtitle',
  style: 'academic'  // ← 单个风格
});

// 使用具体平台场景
const prompt3 = await promptBuilder.buildSubtitlePrompt({
  subtitle: '...',
  mode: 'bilingual',
  scene: 'bilibili',  // ← 字典里没有，直接用
  style: 'anime'
});

// 使用用户在 Settings 中选择的风格
const prompt4 = await promptBuilder.buildSubtitlePrompt({
  subtitle: '...',
  mode: 'bilingual',
  scene: 'video_subtitle'
  // style 省略 → 从 Settings.promptStyle 读取
});

// 词卡解释
const prompt5 = await promptBuilder.buildExplainWordPrompt({
  word: 'convergence',
  style: 'casual'  // ← 可选指定风格
});
```

---

## 结构体映射总结

### PromptTemplateInput 字段来源

```typescript
{
  role: string;          // ← BEHAVIORS[key].role
  scene: string;         // ← 拼接：'当前环境：' + SCENES[key] + '场景。'
  style: string;         // ← STYLES[key]（完整风格定义，包含"风格："前缀）
  task: string;          // ← BEHAVIORS[key].taskTemplate(params)

  userInfo: PromptUserInfo;       // ← 自动从 Settings 构建
  contextInfo?: PromptContextInfo;// ← 业务传入
  userInput: string;              // ← 业务传入
  outputFormat: string;           // ← BEHAVIORS[key].outputFormat(params)
  outputNotes: string;            // ← BEHAVIORS[key].outputNotesTemplate(params)
}
```

### 三个配置字典

| 字典 | 用途 | 特点 |
|------|------|------|
| **BEHAVIORS** | 行为完整定义 | role + task + outputFormat + outputNotes，与 behavior 一对一绑定 |
| **SCENES** | 场景描述 | 提供默认类型级场景（video_subtitle, news_reading），支持 fallback 到自定义平台 |
| **STYLES** | 完整风格定义 | 用户在 UI 选择一个风格（anime, academic, casual），保存到 Settings |

---

## 关键设计决策

### 决策 1：全异步方案

**原因**：
- ✅ `getSettings()` 返回 `Promise<Settings>`，必须 await
- ✅ 利用现有缓存机制（第一次异步，之后返回缓存）
- ✅ 职责单一（不需要 PromptBuilder 管理缓存）
- ✅ 结构经济（不需要 init/refresh）

**代价**：
- 调用时需要 `await`（可接受）

---

### 决策 2：BEHAVIORS 配置统一管理

**原因**：
- ✅ role 与 behavior 绑定（一对一关系）
- ✅ task 也与 behavior 绑定（每个行为的任务是固定的）
- ✅ outputFormat/outputNotes 也是 behavior 专属
- ✅ 统一管理，代码不混乱

**替代方案**：
- ❌ 硬编码在各 `build*Prompt` 里：散落各处，不统一

---

### 决策 3：SCENES 为类型级而非平台级

**原因**：
- ✅ 更通用（video_subtitle 可用于 YouTube、Bilibili、TikTok...）
- ✅ 可复用（不需要为每个平台定义场景）
- ✅ 符合用户需求（类型级分类更合理）

**不采用**：
- ❌ 平台级（youtube, bilibili...）：太具体，不可复用

---

### 决策 4：outputFormat 不强校验 JSON

**现状分析**：
- 大部分行为使用 JSON 解析（`parseExplainWordResponse`, `parseSubtitleEnhanceResponse`）
- 部分行为使用换行符分隔（`parseTranslateKeywordsResponse`）

**结论**：
- ✅ outputFormat 不限制格式
- ✅ 根据 behavior 选择解析策略
- ✅ 保持灵活性

---

### 决策 5：role 暂不放字典

**原因**：
- ✅ role 与 behavior 一对一绑定
- ✅ 数量有限，不会频繁变化
- ✅ 放在 BEHAVIORS 配置里更清晰

**未来**：
- 如有需要可提取到单独字典

---

## 实施计划

### Step 1：定义配置和字典 ✅ 待实施

**文件**：
- `packages/core/src/prompting/behaviors.ts` - BEHAVIORS 配置
- `packages/core/src/prompting/scenes.ts` - PROMPT_SCENES 字典
- `packages/core/src/prompting/styles.ts` - PROMPT_STYLES 字典

**内容**：
- 定义所有 behavior 的完整配置
- 定义类型级场景
- 定义可组合风格片段
- 导出类型别名

---

### Step 2：实现 PromptBuilder ✅ 待实施

**文件**：`packages/providers/src/prompts/prompt-builder.ts`

**内容**：
- 实现 `PromptBuilder` 类
- 实现 `getUserInfo()` 私有方法
- 实现各 `build*Prompt()` 公共方法（异步）

---

### Step 3：调整现有 build*Prompt 函数 ✅ 待实施

**影响文件**：
- `packages/providers/src/prompts/subtitle-enhance-prompt.ts`
- `packages/providers/src/prompts/explain-word-prompt.ts`
- `packages/providers/src/prompts/english-correction-prompt.ts`
- `packages/providers/src/prompts/keyword-select-prompt.ts`
- `packages/providers/src/prompts/web-enhance-prompt.ts`
- `packages/providers/src/prompts/translate-keywords-prompt.ts`

**改动点**：
- 参数改为 `sceneValue: string`, `styleValue: string`（单个值，不是数组）
- 新增 `userInfo: PromptUserInfo` 参数
- 新增 `behavior: typeof BEHAVIORS[xxx]` 参数
- 从 behavior 获取 role/task/outputFormat/outputNotes
- style 已经是完整定义，直接使用（不需要拼接）

---

### Step 4：集成到 background ✅ 待实施

**文件**：`apps/extension/src/background/index.ts`

**内容**：
- 创建 `PromptBuilder` 实例
- 替换现有的 `build*Prompt` 直接调用
- 所有调用改为 `await`

---

### Step 5：Settings 新增字段 ✅ 待实施

**文件**：
- `packages/core/src/types/index.ts` - Settings 类型定义
- `apps/extension/src/ui/options/Options.tsx` - UI 选项

**新增字段**：
```typescript
export interface Settings {
  // ... 现有字段

  promptStyle?: StyleKey;  // 新增：用户选择的风格（'anime' / 'academic' / 'casual' / 'default'）
}
```

**UI 选项**：
- 在 Settings UI 添加"提示词风格"下拉选项
- 选项：默认 / 动漫 / 学术 / 轻松 / 简洁
- 保存到 `Settings.promptStyle`

---

### Step 6：测试验证 ✅ 待实施

- 单元测试（各 `build*Prompt` 函数）
- 集成测试（PromptBuilder）
- 手工验证（不同场景和风格组合）

---

## 待讨论问题

### 1. 是否需要持久化字典？

**问题**：BEHAVIORS/SCENES/STYLES 是否需要存储到 IndexedDB？

**可能原因**：
- 未来支持用户自定义？
- 支持动态更新（不发版本就能更新字典）？
- 多语言支持？

**当前决策**：暂不持久化，直接写在代码里（简单、类型安全）

**如需持久化，表结构**：
```typescript
interface PromptComponent {
  id?: number;          // 主键
  key: string;          // 'video_subtitle'
  type: 'scene' | 'style';  // 类型
  value: string;        // '视频字幕'
  builtin: boolean;     // 是否内置
}
```

---

### 2. 场景检测机制

**功能**：根据 URL 自动选择场景

```typescript
function detectScene(url: string): SceneKey {
  if (url.includes('youtube.com') || url.includes('bilibili.com'))
    return 'video_subtitle';
  if (url.includes('news'))
    return 'news_reading';
  return 'generic';
}
```

**决策**：暂不实施，后续按需添加

---

## 补充讨论记录

### 讨论 1：outputFormat 校验（2026-01-06）

**问题**：outputFormat 是否强制 JSON？

**答案**：
- 不强制 JSON
- 不同 behavior 有不同输出格式：
  - JSON 格式：`parseExplainWordResponse`, `parseSubtitleEnhanceResponse`
  - 换行符分隔：`parseTranslateKeywordsResponse`
- 根据 behavior 选择解析策略

---

### 讨论 2：提示词顺序与 role 绑定（2026-01-06）

**问题**：role 与 behavior 绑定会不会导致代码错乱？

**答案**：
- 不会错乱
- 提示词固定顺序：role → scene → style → task
- role 和 task 都与 behavior 绑定，统一放在 BEHAVIORS 配置中
- scene 和 style 从字典查找
- 最终由 `buildSubtitlePrompt` 组装成 `PromptTemplateInput`

---

### 讨论 3：场景定义级别（2026-01-06）

**问题**：场景应该是平台级（youtube, bilibili）还是类型级（video_subtitle, news_reading）？

**答案**：
- 类型级
- 原因：
  - 更通用、可复用
  - video_subtitle 可用于 YouTube、Bilibili、TikTok 等所有视频网站
  - 不需要为每个平台定义独立场景

---

### 讨论 4：持久化必要性（2026-01-06）

**问题**：为什么要持久化字典？

**澄清**：
- 用户明确表示不需要用户自定义功能
- 当前决策：不持久化，直接写在代码里
- 优点：简单、类型安全、性能最好
- 未来如需用户自定义，再考虑持久化方案

---

### 讨论 5：场景定义的 fallback 机制（2026-01-06）

**问题**：场景应该只是类型级（video_subtitle）还是也支持具体平台（bilibili）？

**纠正后的理解**：
- **默认提供类型级场景**：PROMPT_SCENES 字典提供通用的类型级场景作为 fallback
- **允许具体平台**：如果传入 'bilibili' / 'youtube' 等字典里没有的值，直接使用该字符串
- **Fallback 机制**：`PROMPT_SCENES[key] || key`

**示例**：
```typescript
scene: 'video_subtitle'  // → 从字典查找：'视频字幕'
scene: 'bilibili'        // → 字典里没有，直接用：'bilibili'
```

---

### 讨论 6：风格不是组合而是单选（2026-01-06）

**问题**：风格是"可组合的片段数组"还是"用户选择一个完整风格"？

**纠正后的理解**：
- **不是组合**：不是 `styles: ['anime_honorifics', 'allow_particles']`
- **是单选**：`style: 'anime'`，用户选择一个完整的风格
- **完整定义**：每个 style 是完整的风格描述（包含"风格："前缀），保持与现有提示词一致

**工作流程**：
1. 用户在 Settings UI 选择风格（anime / academic / casual）
2. 保存到 `Settings.promptStyle`
3. PromptBuilder 从 Settings 读取并查字典
4. 直接用于 `PromptTemplateInput.style`

**原因**：
- 保持与现有提示词风格一致
- 用户只需选择一个，简化 UI
- 风格定义完整，不需要拼接

---

## 总结

### 核心架构

```
BEHAVIORS (role + task + outputFormat + outputNotes)
    ↓
PromptBuilder (查找 scene/styles + 构建 userInfo)
    ↓
build*Prompt (组装 PromptTemplateInput)
    ↓
renderPromptTemplate (渲染最终 prompt)
```

### 关键特点

✅ **职责单一**：每层职责清晰
✅ **结构经济**：不需要 init/refresh，无状态管理
✅ **配置驱动**：BEHAVIORS/SCENES/STYLES 统一管理
✅ **类型安全**：TypeScript 类型检查 + IDE 自动补全
✅ **Fallback 机制**：SCENES 提供默认值，但允许自定义平台
✅ **用户友好**：风格单选而非组合，简化 UI
✅ **保持一致**：style 定义与现有提示词风格保持一致
✅ **简单实用**：不过度抽象，易于理解和维护

---

**下一步**：开始实施
