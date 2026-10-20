---
name: cherry-studio-feedback
description: Use when Cherry Studio 用户希望报告、提交或整理 BUG、UI/UX 问题或功能建议，但未明确要求创建 GitHub Issue。
---

# Cherry Studio Feedback

将当前 Support 对话整理成简洁、用户可编辑的问题描述，直接在回复中交给用户审阅。Support 只准备草稿；是否附带诊断数据、发往何处都由用户决定。

## 准备草稿

1. 复用对话中已知的实际结果、期望结果、复现步骤和影响，整理为一段简洁的问题描述。仅追问会实质改变描述的缺失信息。
2. 仅在用户批准且问题确实需要诊断信息时调用 `mcp__assistant__diagnose`。用户拒绝、工具失败或不需要诊断时，仍使用现有内容继续准备草稿。
3. 在回复中给出草稿，供用户复制和编辑。
4. 需要附带诊断数据时，让用户从 Cherry Studio 的帮助菜单打开“报告问题”，在“导出诊断包”中自行选择内容并保存到本地。

## 禁止事项

- 不得调用 `lark-cli`。
- 不得生成工作区反馈 ZIP。
- 不得直接打开飞书或其他外部表单。
- 不得代替用户导出、上传或提交任何内容。
- 不得声称已导出、已上传或已提交。

## GitHub Issue

用户明确要求创建 GitHub Issue 时，立即转交 `issue-reporter`，不再执行本流程。
