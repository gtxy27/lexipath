# Prompting（提示词模块）

这个目录负责把“业务调用需要的上下文”统一拼成一段可控、可查找、可维护的 Prompt 字符串，并提供少量 **LLM 输出解析**（parse）工具。

> 目标：**构造集中在一个地方、配置集中在一个地方**，不要到处散落 string 拼接逻辑。

---

## 设计约束（必须遵守）

### 1) 模板位置固定

Prompt 的结构是固定的，不允许不同任务随意移动/重排：

1. 顶部无标签（固定四行，顺序固定）：
   - `Role`
   - `Scene`
   - `Style`
   - `Task`
2. 标签区（顺序固定）：
   - `<用户信息>`
   - `<上下文信息>`（可选：当且仅当传入且有内容时才显示）
   - `<用户输入>`
   - `<输出格式>`
   - `<输出说明>`

### 2) 上下文只能在 `<上下文信息>`

- `contextInfo` 永远不应该被“拼进” `<用户输入>`。
- 如果没有 `contextInfo`（或 before/after 都为空），则 `<上下文信息>` 整段不输出。

### 3) behavior 四个字段绑定

`role/task/outputFormat/outputNotes` 作为一个绑定组，由 `agentKey` 选择（见 `PromptBehaviorSnapshot`）。

---

## 入口 API（推荐用法）

### buildPrompt（唯一的 prompt 拼接入口）

- 文件：`packages/core/src/prompting/build-prompt.ts`
- 函数：`buildPrompt(request)`
- 入参类型：`BuildPromptRequest`（见 `packages/core/src/prompting/types.ts`）

最小示例：

```ts
import { buildPrompt } from "@lexipath/core/prompting";

const prompt = buildPrompt({
  agentKey: "translate_keywords",
  sceneKey: "keyword_translate",
  styleKey: "default",
  userInfo: { motherTongue: "zh-CN", targetLearningLanguage: "en", cefrLevel: "B1" },
  contextInfo: { before: ["Some context..."], after: [] }, // 可选
  userInput: "hello\nworld",
});
```

---

## 配置入口（集中管理 behavior）

- 文件：`packages/core/src/prompting/behaviors.ts`
- 常量：`PROMPT_BEHAVIORS`

这里是唯一的“文案配置”集中点：`agentKey(string) -> { role, task, outputFormat, outputNotes }`。

新增/调整某个任务的提示词文案，一律在这里改，避免“到处都是字符串”。

---

## 场景/风格（scene/style）

这两项是“头部四行”的另外两行（除了 role/task），依旧通过 key 映射：

- `packages/core/src/prompting/scenes.ts`
  - `PromptSceneKey`
  - `resolvePromptScene(sceneKey)`
- `packages/core/src/prompting/styles.ts`
  - `resolvePromptStyleKey(input)`
  - `resolvePromptStyleValue(input)`

调用侧（例如扩展 background）负责决定用哪个 `sceneKey/styleKey`，本模块只负责把它们解析成字符串并拼进固定模板位置。

---

## 用户水平参考（proficiency reference）

- 文件：`packages/core/src/prompting/proficiency-reference.ts`
- 用途：构建 `PromptUserInfo.levelReferenceLine`（例如 “（参考 CET-4 pass）”）

这部分是可选的增强信息：如果你不需要，可以不传 `levelReferenceLine`。

---

## 解析器（parsers）

`packages/core/src/prompting/prompts/` 目录下的文件只做一件事：**解析模型输出**。

原因：不同任务输出格式差异很大（纯文本、JSON、数组等），解析规则也不同；把它们和 buildPrompt 分离，可以避免职责混乱。

目前的测试统一在一个文件里：

- `packages/core/src/prompting/prompts/prompts.test.ts`

---

## 新增一个 agentKey 的步骤（推荐流程）

1. 在 `packages/core/src/prompting/behaviors.ts` 的 `PROMPT_BEHAVIORS` 里新增一项（即新增一个 `agentKey`）
2. 调用侧改为使用 `buildPrompt({ agentKey, sceneKey, styleKey, userInfo, contextInfo?, userInput })`
3. 如果这个任务需要解析结构化输出：
   - 在 `packages/core/src/prompting/prompts/*.ts` 中新增/修改对应 `parse*` 函数
4. 在 `packages/core/src/prompting/prompts/prompts.test.ts` 增加用例（构造 + 解析）

