# PLAN-11 TODO（仍未完成项）

说明：本文件只列出 `lexipath/apps/extension/plan/plan11.md` 中仍未落地的事项（已完成项不再重复）。

## YouTube / Bilibili 特殊适配（缺失功能）

- [ ] YouTube Live 直播字幕适配（live=1 + 增量获取/轮询）
- [ ] YouTube Shorts 适配（Shorts UI 链路兼容：字幕按钮/参数拦截/字幕获取）
- [ ] YouTube 会员字幕适配（登录态/权限字幕轨道获取与拦截）
- [ ] Bilibili 弹幕干扰处理（弹幕暂停/恢复，与覆盖层联动）
- [ ] Bilibili 会员字幕适配（登录态/轨道拉取与兼容）

## 流媒体平台扩展支持（Stage 2/3）

- [ ] 阶段 2：Coursera / TED / Udemy / Khan Academy / edX 的 SubtitleProvider（API 获取字幕 + Parser 接入）
- [ ] 阶段 3：DRM 平台（Netflix / Disney+）字幕获取与注入链路实现（已具备 TTML/WebVTT/SRT 解析器，但“获取”未实现）

## 可选能力（按需实施）

- [ ] 多服务降级（OpenAI 失败 → Claude → Gemini → Google Translate）
- [ ] 请求头修改（`declarativeNetRequest`，用于 CORS/防盗链等场景）

