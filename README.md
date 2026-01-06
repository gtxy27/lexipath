# LexiPath

简体中文 | [English](README.en.md)

沉浸式语言学习浏览器扩展：用 **i+1** 增强网页与视频字幕，把“输入”变成更高密度、更可理解的“学习材料”。

[![GitHub stars](https://img.shields.io/github/stars/gtxy27/lexipath?style=social)](https://github.com/gtxy27/lexipath/stargazers)

## Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=gtxy27/lexipath&type=Date)](https://star-history.com/#gtxy27/lexipath&Date)

## 项目特点

- **Web Enhancement（网页 i+1 增强）**：把网页文本改写为更适合你当前水平的目标语言输入；可随时切回原文
- **视频字幕增强**：支持 **YouTube + Bilibili**，单语/双语模式切换
- **字幕关键字**：从字幕中挑选高价值词/短语，并对未来 ~15 秒的内容进行预取解释（更顺滑）
- **单词学习**：单词卡片、熟悉度追踪、TTS 发音
- **AI 可配置**：支持 OpenAI-compatible 网关；并提供 `Claude` / `Gemini` / `Google Translate` / `Bing Translate` 等适配
- **跨浏览器**：Chrome/Edge + Firefox
- **质量兜底**：Zod 校验 + 回退规则（宁可不渲染，也不展示“垃圾输出”）

## 项目结构

```
lexipath/
  apps/extension/                # 浏览器扩展（React + Vite，MV3）
  packages/
    core/                        # 纯 TS：类型、schema、校验与策略
    providers/                   # OpenAI-compatible providers + 翻译适配
    subtitles/                   # YouTube/Bilibili 字幕适配（统一 Cue 模型）
    dictionary/                  # IndexedDB 字典服务
    storage/                     # 存储/同步（例如 WebDAV）
```

## 开发

### 前置条件

- [Bun](https://bun.sh/)（包管理器 / 运行时）

### 安装依赖

```bash
bun install
```

### 测试 / 类型检查

```bash
bun run test
bun run typecheck
```

### 构建

```bash
# Chrome
bun run build:chrome

# Firefox
bun run build:firefox

# All
bun run build
```

### 打包（zip/xpi）

构建完成后，可将 `apps/extension/dist/*` 打包为可分发文件（`zip`/`xpi` 本质都是 zip 容器）。

```bash
# 在 lexipath/ 目录执行（一条命令：build + package）
bun run release

# 如果你已经 build 过（只打包）
bun run release:skip-build
```

产物输出到 `lexipath/dist/`：
- `lexipath-chrome-<version>.zip`
- `lexipath-firefox-<version>.xpi`
- 以及对应的 `*.sha256`

说明：
- `release` 内部会调用系统 `tar` 生成 zip 容器（Windows 10+ 自带 `tar.exe`；macOS 自带；Linux 建议安装 `bsdtar`/`libarchive-tools`）。
- 可选参数：`bun scripts/release.mjs --skip-build`（不构建只打包）、`bun scripts/release.mjs --no-sha256`（不写校验文件）。

### 开发模式（watch 构建）

```bash
bun run dev
```

## 本地加载扩展

**Chrome/Edge**
1. 打开 `chrome://extensions`
2. 开启 Developer mode
3. 点击 Load unpacked
4. 选择 `apps/extension/dist/chrome`

**Firefox**
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 Load Temporary Add-on
3. 选择 `apps/extension/dist/firefox/manifest.json`

## 配置

### Provider（OpenAI-compatible）

在 Options 页面配置 `baseUrl`、`apiKey`、`model` 等参数即可接入任意 OpenAI-compatible 网关。

### 高级：按模型限制并发

可按 `baseUrl|model` 维度限制每个模型的并发请求数。

```json
{
  "https://api.openai.com/v1|gpt-4o-mini": 20
}
```

## 文档索引

- 扩展源码：`apps/extension/src`
- Provider 适配层：`packages/providers/src`
- 字幕适配层：`packages/subtitles/src`

## License

MIT
