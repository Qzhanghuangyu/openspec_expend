# 工作流状态与人工验收门禁修复计划

> 执行方式：当前会话逐项实施，先失败测试、再修复、最后整体审查。

**目标：** 修复本次审查的第 1、2 项：定向校验遗漏父节点，以及人工任务在 agent 模式或多行描述下漏检。

**设计：** 定向协调校验读取父记录并复用 doctor 的父子状态约束；人工任务识别覆盖任务续行，agent 模式出现人工任务即报告模式冲突。保留官方 OpenSpec 的任务计数约定。

**技术：** Node.js ESM、node:test，继续使用现有安全文件读取与 OpenSpec status provider。

**需求依据：** 已确认两项漏检；用户在本会话明确要求“执行吧”。

## 范围与约束

- 不修改跨父依赖语义、安装入口、流程图及业务代码。
- 校验保持只读；不输出 owner、handoff 正文或其他敏感内容。
- 保留旧 comate 格式兼容、归档子节点解析及现有 checkbox 完成数。

## 审查重点

- 不存在或缺少记录的父 change 不得校验通过。
- 父 done、子未完成，以及 single/parallel 映射冲突，两个校验入口判断一致。
- 父记录本身的未完成任务、验收、官方规划状态也必须受检。
- agent 模式有人工任务不得通过；多行标记每个任务只计一次。
- 普通说明、同级列表或下一章节的人工标记不得污染相邻任务。

## 任务 1：父节点与父子状态校验

文件：`src/coordination/dag.js`、`src/coordination/health.js`；测试：`test/coordination/dag.test.js`、`test/coordination/health.test.js`、`test/commands/coordination.test.js`。

- [x] 增加父 done/子 todo、父缺失、父模式冲突、父自身完成证据不成立的回归测试；现有有效图补齐父记录。
- [x] 运行定向测试，确认旧实现因错误通过而失败。
- [x] 抽取 `validateParentRecord(reference, comate, children)` 共享父子约束；定向校验检查父记录及官方状态。
- [x] 验证正常 single、parallel、归档节点仍可校验，CLI 失败退出及敏感内容脱敏保持成立。

## 任务 2：人工验收门禁

文件：`src/coordination/comate.js`；测试：`test/coordination/comate.test.js`、`test/coordination/health.test.js`。

- [x] 增加 agent + 人工任务、续行人工标记、重复标记和相邻段落隔离测试，并确认旧实现失败。
- [x] 修正 `parseTaskProgress(markdown)` 的人工任务识别，保留返回结构与总数/完成数约定。
- [x] 在 `validateComateRecord(record, progress)` 拒绝 agent 模式的人工任务组合。
- [x] 验证 hybrid 多行人工任务缺少验收时失败，明确反馈后通过。

## 最终验证

- [x] `node --test test/coordination/*.test.js test/commands/coordination.test.js test/commands/doctor.test.js`
- [x] `npm run check`、`npm test`、`git diff --check`。
- [x] 审查完整差异，记录兼容性风险；不自动提交或同步到业务项目。

## 验证记录

- 本次初始回归：27 项中 5 项按预期失败，分别覆盖父状态/记录/模式和人工任务识别/agent 模式。
- 未缩进续行从 humanTasks=0 修复为 1；总任务数与完成数保持原有统计方式。
- 定向协调/CLI/doctor 测试：63/63 通过；全套测试：210/210 通过；语法检查与 diff 空白检查通过。
- 兼容性：有子映射却缺少 `parallel` 的旧父记录、缺少父 comate/tasks 的定向校验、agent 模式携带人工任务的记录将显式报错，需补齐或调整模式；规划阶段允许暂缺 comate 的 doctor 检查保持原语义。
- 脱敏与生命周期：报告不返回底层异常正文；active/archived 子节点混合场景仍可校验。
