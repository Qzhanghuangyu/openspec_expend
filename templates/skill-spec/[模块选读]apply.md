# [模块选读] Apply（实施）

## 目标

一次实施、验证并落盘一个 ready task；本阶段不重新分析需求、不重新拆分 change。

## 输入

- 官方 `status` 和 `instructions apply`，当前 change 的 `tasks.md`、`comate.md`。
- 父 change 的 design、项目规则审计和用户已确认决定。

## 必须执行

1. 必读 `references/coordination.md`，按“执行模式”“协作状态”确定实施目标并认领。
   官方 `blocked` 停止，`all_done` 只复核，`ready` 才认领；完成证据失效时按该文档的回退流程处理。
2. 必读 `references/project-rules.md`，执行 Apply 项目规则门禁。遗漏、条件变化或偏离时不修改代码，
   返回 Propose。
3. 读取 `operationGuidance`；只采纳不与官方状态、范围锁、Soul 和用户决定冲突的建议，
   不把 guidance 原文复制到代码、日志或 handoff。
4. 重读 tasks/comate，选择一个依赖已满足的最小未完成 task，将编号、完成条件和编辑范围写入 handoff。
5. 按当前任务加载权威细则（已加载且未变化的不重复读取）：
   - 修改 Android 代码、资源或配置时，必须读取 `references/android-quality.md`，执行当前 task
     的实现、注释审计和适用验证；集成及收尾检查按规划节点执行。
   - 依赖设计事实、Figma 或工程资源时，必须读取 `references/design-tools.md`，按其跨阶段复用、
     授权、取证文件和资源验收规则执行。
   - 涉及组件选型或 required 复用实现时，必须读取 `references/ui-knowledge.md`，核对父 design
     的选定对象与接入条件；条件失效返回 Propose。
   - 定位或理解源码时，必须读取 `references/code-search.md`。
6. 按 coordination 的“任务和检查点”执行当前 task 并落盘；按“验证模式”处理人工验收。
   必要验证缺口尚未规划时返回 Propose，不自行替换完成条件。
7. 每个 task 状态落盘后重新读取 instructions/tasks，再选择下一个 ready task。
8. 后续证据推翻已完成任务时，按 coordination 的回退顺序恢复状态与 checkbox，复验后继续。

## 何时暂停

- task、设计或 required 基线不明确：返回 Propose。
- 验证失败、外部阻塞、等待人工或上下文不足：按 coordination 保存状态和恢复条件。

## 完成标准

- 当前 task 通过 android-quality 的适用门禁和 coordination 的完成门禁后落盘。
- 全部 tasks 完成、handoff 完整且人工验收满足 coordination 规则后，才可设为 done。
- 完成前运行 `coordination validate`；parallel 校验父 change。

## 按需参考

本阶段第 1、2 步为必读；第 5 步按任务触发强制加载。具体命令编排见 `falla-apply-change` Skill。
