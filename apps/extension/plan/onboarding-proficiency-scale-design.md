# 首次引导增加水平标准选择（Proficiency Standard in Onboarding）

**状态：设计讨论完成，待实施**
**日期：2026-01-05**

---

## 背景与现状

当前实现：

- `Settings.proficiencyPreference`：用户偏好的水平标准（IELTS/CET-4/CET-6/JLPT/TOPIK）
- `Settings.proficiencyLevel`：内部统一使用 CEFR 水平
- Options 设置页已支持"水平标准/标准值"选择，但 onboarding（首次引导）仅支持直接选择 CEFR/JLPT/TOPIK 水平，缺少标准选择功能

---

## 功能需求

在 onboarding 的第一步（语言和水平选择）中，增加"水平标准"选择功能，让用户可以：

- 选择使用 CEFR（默认）
- 或者选择具体的考试标准（IELTS/CET-4/CET-6/JLPT/TOPIK）

选择逻辑与 Options 页面一致：

- 英语：CEFR / IELTS
- 母语是中文时额外提供：CET-4 / CET-6
- 日语：CEFR / JLPT
- 韩语：CEFR / TOPIK

---

## UI 设计

### 位置

onboarding 第一步，"目标语言"选择下方

### 布局建议

```
[目标语言选择]
  [英语] [日语] [韩语] [法语] [德语] [中文]

[水平标准选择] ← 新增
  [CEFR] [IELTS] [CET-4] [CET-6] ← 根据语言和母语动态显示

[水平选择]
  [A1] [A2] [B1] [B2] [C1] [C2] ← 根据标准显示对应等级
```

### 交互细节

1. 用户选择语言后，动态显示适用的标准选项
2. 用户选择标准后，水平选项自动切换为对应的等级
   - CEFR：A1/A2/B1/B2/C1/C2
   - IELTS：4.0/4.5/5.0/5.5/6.0/6.5/7.0/7.5/8.0/8.5/9.0
   - CET-4/CET-6：通过
   - JLPT：N5/N4/N3/N2/N1
   - TOPIK：1/2/3/4/5/6
3. 切换标准时，自动换算并显示对应的水平选项
4. 完成引导后，保存 `proficiencyPreference` 和换算后的 `proficiencyLevel`（CEFR）

---

## 技术实现

### 1. 复用 Options.tsx 的逻辑

从 `Options.tsx` 提取以下函数到共享模块（`packages/core/src/proficiency/` 或 `apps/extension/src/shared/`）：

```typescript
// 类型定义
type ProficiencyScaleOption = "CEFR" | ProficiencyPreference["standard"];

// 获取可用的标准选项
function getProficiencyScaleOptions(input: {
  targetLanguage: Settings["targetLanguage"];
  nativeLanguage: Settings["nativeLanguage"];
}): Array<{ value: ProficiencyScaleOption; label: string }> {
  // 复用 Options.tsx line 194-214
}

// 判断标准是否适用
function isScaleApplicable(options: {
  scale: ProficiencyScaleOption;
  targetLanguage: Settings["targetLanguage"];
  nativeLanguage: Settings["nativeLanguage"];
}): boolean {
  // 复用 Options.tsx line 216-232
}

// 获取默认的 preference
function defaultPreferenceForScale(
  scale: ProficiencyScaleOption,
): ProficiencyPreference | undefined {
  // 复用 Options.tsx line 234-242
}

// 换算为 CEFR
function deriveCefrFromPreference(
  preference: ProficiencyPreference,
): CEFRLevel {
  return proficiencyPreferenceToCefrLevel(preference);
}
```

### 2. Onboarding.tsx 改造

#### 更新表单状态

```typescript
type OnboardingFormData = {
  targetLanguage: SupportedLanguage;
  proficiencyLevel: ProficiencyLevel; // 改为 CEFRLevel | JLPTLevel | TOPIKLevel | IELTSScore | CETScore
  proficiencyScale?: ProficiencyScaleOption; // 新增：用户选择的标准
  scenesEnabled: {
    /* ... */
  };
};
```

#### 新增标准选择器（line 335-363 之前）

```typescript
{currentStep === 1 && (
  <div className="space-y-4">
    {/* 目标语言选择（保持不变） */}
    <div className="space-y-4">
      <Label>{t("onboardingTargetLanguageLabel")}</Label>
      {/* ... */}
    </div>

    {/* 水平标准选择（新增） */}
    <div className="space-y-4">
      <Label>{t("onboardingProficiencyScaleLabel")}</Label>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {getProficiencyScaleOptions({
          targetLanguage: formData.targetLanguage,
          nativeLanguage: 'zh-CN', // onboarding 默认中文母语
        }).map((option) => (
          <Button
            key={option.value}
            variant="outline"
            className={cn(/* ... */}
            )}
            onClick={() => {
              const nextScale = option.value as ProficiencyScaleOption;
              const nextPreference = defaultPreferenceForScale(nextScale);
              setFormData({
                ...formData,
                proficiencyScale: nextScale,
                proficiencyLevel: nextPreference
                  ? (deriveCefrFromPreference(nextPreference) as ProficiencyLevel)
                  : getDefaultProficiency(formData.targetLanguage),
                ...(nextPreference ? { proficiencyPreference: nextPreference } : {}),
              });
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>

    {/* 水平选择（保持不变，但根据标准动态显示） */}
    <div className="space-y-4">
      <Label>{t("onboardingProficiencyLabel")}</Label>
      {/* ... */}
    </div>
  </div>
)}
```

#### 更新保存逻辑

```typescript
async function handleFinish() {
  setSaving(true);
  try {
    const cefrLevel = toCEFRLevel(
      formData.proficiencyLevel,
      formData.targetLanguage,
    );

    const payload: Partial<Settings> = {
      targetLanguage: formData.targetLanguage,
      proficiencyLevel: cefrLevel,
    };

    // 保存用户的偏好标准
    if (formData.proficiencyPreference) {
      payload.proficiencyPreference = formData.proficiencyPreference;
    }

    await sendMessage("SET_SETTINGS", payload);
    globalThis.close?.();
  } catch (error) {
    console.error("[LexiPath] Failed to save onboarding settings:", error);
  } finally {
    setSaving(false);
  }
}
```

### 3. i18n 国际化

新增消息键（`_locales/zh_CN/messages.json` 和 `en/messages.json`）：

```json
{
  "onboardingProficiencyScaleLabel": {
    "message": "水平标准",
    "description": "Label for proficiency scale selection in onboarding"
  }
}
```

### 4. 提示词集成

无需额外修改，提示词逻辑已在 `proficiency-reference.ts` 中实现：

- 用户选择具体标准后，`proficiencyPreference` 会被保存
- 提示词会自动包含 `参考：IELTS 6.5（≈ CEFR B2）` 等信息
- 未选择标准时，不包含该行（符合现有逻辑）

---

## 实施步骤

1. **提取共享逻辑**
   - 创建 `apps/extension/src/shared/proficiency-scale.ts`
   - 从 `Options.tsx` 提取 `getProficiencyScaleOptions`、`isScaleApplicable`、`defaultPreferenceForScale`
   - 更新 `Options.tsx` 引用共享函数

2. **改造 Onboarding.tsx**
   - 更新 `OnboardingFormData` 类型
   - 添加标准选择器 UI
   - 更新保存逻辑
   - 更新水平选择器的动态显示逻辑

3. **添加 i18n**
   - 在 `_locales/zh_CN/messages.json` 和 `en/messages.json` 添加新键

4. **测试**
   - 测试不同语言组合（英语/日语/韩语）
   - 测试标准切换是否正确换算
   - 测试保存后的 `proficiencyPreference` 和 `proficiencyLevel`
   - 运行 vitest 全量测试

---

## 注意事项

### 1. 向后兼容

- 如果用户已完成旧版 onboarding，`proficiencyPreference` 为 `undefined`
- Options 页面的标准选择器默认显示 "CEFR"
- 无需数据迁移

### 2. 用户体验

- 初始状态默认选择 "CEFR"
- 切换语言时，保持当前标准（如果适用）
- 如果当前标准不适用，自动切换回 "CEFR"

### 3. 与 Options 页面一致性

- UI 样式保持一致（使用相同的 Select 组件或 Button 组）
- 换算逻辑完全一致
- 保存逻辑完全一致

---

## 预期效果

用户完成 onboarding 后：

### 如果用户选择了 "IELTS 6.5"

- `proficiencyPreference = { standard: 'IELTS', value: '6.5' }`
- `proficiencyLevel = 'B2'`
- 提示词包含：`参考：IELTS 6.5（≈ CEFR B2）`

### 如果用户选择了 "CEFR"

- `proficiencyPreference = undefined`
- `proficiencyLevel = 'B2'`
- 提示词不包含参考行

---

## 相关文件

- `packages/core/src/types/index.ts` - Settings 类型定义（line 266）
- `packages/core/src/proficiency/mappings.ts` - CEFR 换算逻辑
- `packages/providers/src/prompts/proficiency-reference.ts` - 提示词参考行构建（line 1）
- `apps/extension/src/ui/options/Options.tsx` - 标准选择实现（line 1666）
- `apps/extension/src/ui/onboarding/Onboarding.tsx` - 首次引导实现
- `apps/extension/src/shared/messages.ts` - 消息传递（line 60）
- `_locales/zh_CN/messages.json` - 中文翻译
- `_locales/en/messages.json` - 英文翻译
