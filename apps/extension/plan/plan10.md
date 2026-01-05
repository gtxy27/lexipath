# PLAN-10: 对话历史与存储重构（草稿）

**状态：设计讨论中**

---

## Part 1: 问题清单

1. **对话历史不显示** - 后端已存储，前端不加载（`Sidebar.tsx:29-32`）
2. **Ask AI 无响应**（侧边栏已打开时） - 只在挂载时读取一次（`Sidebar.tsx:167-184`）
3. **单词类型颜色未区分** - 需要根据词性（名词/动词/副词等）显示不同颜色（`enhanced-text.ts:73`）

---

## Part 2: 存储方案

### 1. 数据存储分配

| 数据 | 存储方式 | 原因 |
|-----|---------|------|
| Settings | IndexedDB | 包含 API Key（隐私），不能上传云端 |
| Dictionary | IndexedDB | 上万单词，需要索引 |
| Chat Sessions | IndexedDB | 需要 keyword 索引、自增 message.id |
| Familiarity | IndexedDB | 上千单词，批量查询 |
| Pending Messages | storage.local | 临时数据 |

**为什么全用 IndexedDB（除 Pending Messages）？**
- **统一技术栈**，减少维护成本
- **Settings 包含 API Key**，不能用 storage.sync（会上传到 Google/Mozilla 服务器）
- **统一接口封装**（StorageService），对外调用简单

---

### 2. Chat 表结构（IndexedDB）

**sessions 表**：
- 主键：sessionId（`apple-1`）
- 索引：keyword（`apple`）
- 字段：conversationIndex, createdAt, lastAccessedAt

**messages 表**：
- 主键：id（自增）
- 索引：sessionId
- 字段：role, content, timestamp

**inverted_index 表**（搜索用）：
- 主键：term（分词后的词）
- 字段：messageIds（包含该词的消息 ID 数组）

**分表原因**：
- 查 session 列表不加载全部 messages
- 自增 ID 原生支持
- 支持分页
- 倒排索引支持快速搜索

**查询性能**：O(log n) 索引查询，无全表扫描

---

## Part 3: 后端任务（Background）

### 1. StorageService 封装
- 创建 `packages/storage`
- 提供简单接口：getSettings(), getChatSessionsByKeyword(), addMessage()
- 内部处理 IndexedDB 复杂性
- **新增**：导出接口 exportAll(), importAll()

### 2. 数据迁移
- browser.storage.local → IndexedDB
- Chat sessions 拆分为 sessions + messages 表
- Familiarity keys 合并为 familiarity 表

### 3. 消息处理改造
- 修改 CHAT、EXPLAIN_WORD 使用 StorageService
- 保持接口不变

### 4. Settings 迁移到 IndexedDB
- 从 storage.local 迁移到 IndexedDB
- 统一使用 StorageService

### 5. 云同步接口预留（Phase 2）
- 定义 CloudStorageProvider 接口
- 实现 WebDAVProvider
- 预留 OSSProvider 扩展点

### 6. 搜索功能实现
- 创建 inverted_index 表（倒排索引）
- 插入/更新 message 时同步更新索引
- 提供 searchMessages(keyword) 接口
- 前端调用简单，后端处理分词和索引查询

---

## Part 4: 前后端对齐

### 1. StorageService 接口（后端提供，前端调用）

**Settings**：
- getSettings() → Settings
- saveSettings(settings: Settings) → void

**Chat**：
- getSessionsByKeyword(keyword: string) → ChatSession[]
- getSession(sessionId: string) → ChatSession | null
- createSession(session: ChatSession) → void
- getMessages(sessionId: string) → ChatMessage[]
- addMessage(message: Omit<ChatMessage, 'id'>) → number（返回自增 id）
- **searchMessages(keyword: string) → ChatMessage[]**（倒排索引搜索）

**Familiarity**：
- getFamiliarity(word: string) → number
- updateFamiliarity(word: string, familiarity: number) → void

---

### 2. 数据结构（前后端统一）

**ChatSession**：
- sessionId: string（如 `apple-1`）
- keyword: string（如 `apple`）
- conversationIndex: number
- createdAt: number
- lastAccessedAt: number

**ChatMessage**：
- id: number（自增主键）
- sessionId: string
- role: 'user' | 'assistant'
- content: string
- timestamp: number

---

### 3. 消息协议（前端 ↔ Background）

保持现有消息不变：
- CHAT（payload: { message, conversationId? }）
- EXPLAIN_WORD（payload: { word, context? }）

前端不需要知道 IndexedDB 细节，Background 内部使用 StorageService

---

## Part 5: 前端任务（UI）

### 1. Sidebar 对话历史
- 挂载时加载历史对话
- 恢复 conversationId 和 messages 状态
- 提供"新对话"按钮

### 2. Sidebar 监听 storage
- 用 `browser.storage.onChanged` 监听 pending message
- 处理侧边栏已打开时的 Ask AI 请求

### 3. 单词类型颜色
- 提取公共函数：根据词性（partOfSpeech）返回对应样式类名或颜色
  - 不同词性（noun、verb、adjective、adverb 等）使用不同视觉区分
  - 具体颜色由前端 CSS/UI 决定
- **双重词性**：使用双下划线（如：名词+动词）
- `enhanced-text.ts` 应用动态样式
- 词性数据来源：Dictionary（definitions[].partOfSpeech）

### 4. 对话列表 UI
- 显示按 keyword 分组的对话列表
- 点击切换对话
- 显示最后访问时间

### 5. 导出/导入 UI（Phase 2）
- **本地导出/导入**：
  - "导出"按钮 → 下载 JSON 文件
  - "导入"按钮 → 上传 JSON 文件恢复数据
  - 导入策略：优先合并，冲突时覆盖本地

- **WebDAV 云同步**（手动）：
  - WebDAV 配置界面（服务器、用户名、密码）
  - "上传到云端"按钮（本地 → WebDAV，覆盖）
  - "从云端下载"按钮（WebDAV → 本地，合并+冲突覆盖）
  - 同步状态显示（最后同步时间）

### 6. 搜索功能 UI
- 搜索框（搜索消息内容）
- 搜索结果列表（显示匹配的消息和所属对话）
- 点击跳转到对应对话

---

## Part 6: 已确定决策

### 1. 对话恢复策略
**自动恢复最新对话**
- 打开侧边栏 → 自动显示最近的对话
- 用户可以继续或开新对话

### 2. Ask AI 新对话策略
- **不同 keyword** → 开新对话（`apple` vs `hello`）
- **相同 keyword** → 继续以前的对话（`apple-3`）
- **用户主动要求** → 开新对话（前端提供"新对话"按钮）

### 3. 对话列表 UI
**需要**（前端任务）
- 显示按 keyword 分组的对话列表
- 点击切换对话
- 显示最后访问时间

### 4. 数据保留策略
- **对话历史**：永久保留（IndexedDB）
- **单个 keyword 对话数**：无限
- **风险**：清除浏览器数据会丢失（需导出备份）

### 5. 数据丢失风险应对
- 提供导出/导入功能（见 Part 8）
- 支持 WebDAV 云同步（会员功能）
- 提示用户定期备份

### 5. 迁移清理旧数据
**清理**
- 迁移完成后删除 storage.local 中的旧数据
- 保留迁移标志

### 6. Sidebar 默认状态
**显示最新对话**

### 7. 搜索功能
**采用倒排索引**
- 后端建立 inverted_index 表
- 插入消息时自动更新索引
- 搜索消息内容（O(log n) 查询）

### 8. 导入数据策略
**优先合并，冲突覆盖**
- 导入时合并新数据
- 如果 sessionId 或 messageId 冲突 → 用导入的数据覆盖本地

---

## Part 7: 待定事项（搜索相关）

### 倒排索引实现细节

**分词方案**：
- 中文分词库（如 nodejieba）vs 简单空格分词
- 是否需要去除停用词（的、了、是等）

**索引更新时机**：
- 插入消息时同步更新索引
- 还是异步批量更新

**存储开销**：
- 估算：10,000 条消息 ≈ 10-20MB 索引
- 可接受（IndexedDB 配额通常 > 100MB）

---

## Part 8: 导出与云同步设计

### 1. 导出数据范围
- Settings（配置，包含 API Key）
- Chat Sessions + Messages（对话历史）
- Familiarity（单词熟悉度）
- **不包含** Dictionary（词典数据太大）

### 2. 导出格式
**JSON 格式**（明文）：
```
{
  "version": "1.0",
  "exportedAt": timestamp,
  "settings": {...},
  "sessions": [...],
  "messages": [...],
  "familiarity": {...}
}
```

**加密**：
- WebDAV 是用户自己的云盘，已经是用户掌控
- **默认不加密**（简单、不用管理密码）
- 可选：提供加密选项（用户自己决定）

### 3. 云同步接口设计（预留扩展）

**StorageProvider 接口**（后端实现）：
```
interface CloudStorageProvider {
  upload(data: ExportData): Promise<void>
  download(): Promise<ExportData>
  test(): Promise<boolean>
}
```

**实现类**：
- WebDAVProvider（Phase 1 实现）
- OSSProvider（后续扩展，预留）

### 4. 用户配置（Options UI）

**WebDAV 配置**：
- 服务器地址（如 https://dav.jianguoyun.com/dav/）
- 用户名
- 密码
- 文件路径（默认 /LexiPath/backup.json）

**后续扩展**：
- 会员登录
- 选择同步方式（WebDAV / 官方云同步）

### 5. 实施策略
- **Phase 1（开源版本）**：
  - 本地导出 JSON（下载文件）
  - WebDAV 手动同步（用户点击"上传"/"下载"按钮）
  - 同步策略：优先合并，冲突时覆盖本地

- **Phase 2（会员功能，后续）**：
  - 官方云同步（OSS）
  - 会员登录/验证

---

## Part 9: 待定事项（其他）

- [ ] 分词方案选择（中文分词库 vs 简单分词）
- [ ] 是否去除停用词
- [ ] 索引更新时机（同步 vs 异步）
- [ ] 是否提供可选加密（加密 vs 明文，用户选择）

---

## 代码规范

遵守 `docs/DEVELOPMENT.md`：
- 类型显式
- 不用 any
- 错误结构化
- 性能优先（索引查询、批量操作）
