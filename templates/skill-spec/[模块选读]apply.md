# [模块选读] Apply（实施）

## 目标

一次执行回合只实施、验证并落盘一个 ready task；完成后停下汇报，等待用户确认下一项。
同一 Apply 会话由用户回复“继续”进入下一轮；本阶段不重新分析需求、不重新拆分 change。

## 输入

- 用户在规划完成并可审阅/修改后首次手动调用 Apply；同一会话后续明确回复“继续”只恢复下一轮。
  官方 `status` 和 `instructions apply`、当前 change 的 `tasks.md`、`comate.md` 为事实依据；
  Propose 完成或任务 ready 不构成自动实施授权。
- 父 change 的 design、项目规则审计和用户已确认决定。
- parallel 父协调回合只推进父里程碑和整体状态；子代码实施仍须另认领子 change，不因协调身份扩大范围。

## 必须执行

1. 必读 `references/coordination.md`，按“执行模式”“协作状态”确定实施目标并认领。
   先执行 `coordination baseline` 核对当前与已记录版本；官方 `blocked` 停止，`all_done` 也须基线及完成证据复核，
   `ready` 且基线有效才认领；parallel 父使用显式 `claim --coordinator`，子实施须父协调者已就位。
   父的安全暂停按 coordination 执行，不以旧基线失效阻止暂停。基线变化/旧证据未核验按复核回退协议处理，不自动刷新或清空任务。
2. 必读 `references/project-rules.md`，执行 Apply 项目规则门禁。遗漏、条件变化或偏离时不修改代码，
   返回 Propose。
3. 读取 `operationGuidance`；只采纳不与官方状态、范围锁、Soul 和用户决定冲突的建议，
   不把 guidance 原文复制到代码、日志或 handoff。
4. 重读 tasks/comate，选择一个依赖已满足的最小未完成 task，将编号、完成条件和编辑范围写入 handoff。
   Figma UI task 按设计条目 ID、页面/状态读取父 design；缺少绑定或实施必需事实时返回 Propose，不猜测。
5. 按当前任务加载权威细则（已加载且未变化的不重复读取）：
   - 修改 Android 代码、资源或配置时，必须读取 `references/android-quality.md`，执行当前 task
     的实现、注释审计和适用验证；集成及收尾检查按规划节点执行。
   - 依赖设计事实、Figma 或工程资源时，必须读取 `references/design-tools.md`，按其跨阶段复用、
     授权、取证文件和资源验收规则执行。
   - 涉及组件选型或 required 复用实现时，必须读取 `references/ui-knowledge.md`，核对父 design
     的选定对象与接入条件；条件失效返回 Propose。
   - 定位或理解源码时，必须读取 `references/code-search.md`。
6. Figma UI task 完成前按设计条目 ID 逐条回查实现与可核对事实，记录差异、验证证据及人工视觉校准项；
   再按 coordination 的“任务和检查点”落盘，按“验证模式”记录逐项人工结果；只需编号和结果，
   已勾选人工项必须有本项 passed，不能以总 pending/笼统反馈推断通过，也不要求验收材料。
   必要验证缺口尚未规划时返回 Propose，不自行替换完成条件。
7. 后续调用发现证据推翻已完成任务时，按 coordination 的回退顺序恢复状态与 checkbox，
   当前 task 复验完成前不推进别的任务。
8. 当前 task 状态落盘后，重新读取 instructions/tasks，
   只核对本次状态与下一个候选并报告，然后停止本轮；用户回复“继续”才恢复下一轮，
   同一 Apply 会话无需重新调用 Apply，也不得自动认领或实施下一项。

## 何时暂停

- 已确认需求内的 task、设计或 required 基线修订：返回 Propose；需求/PRD 已确认决定变化、冲突或尚未明确：先回 Preflight。
- `baseline-review-required` / `baseline-unverified` 或结构/安全读取错误：先明确影响范围并由各 owner 回退复核，不继续下一任务。
- 验证失败、外部阻塞、等待人工或上下文不足：按 coordination 保存状态和恢复条件。

## 完成标准

- 当前 task 通过 android-quality 的适用门禁和 coordination 的完成门禁后落盘。
- 全部 tasks 完成、handoff 完整且人工验收满足 coordination 规则后，才可设为 done。
  parallel 父由当前协调者以 `coordination transition --status done` 在锁内核验并更新，不手写父状态。
- 完成前运行 `coordination validate`；parallel 校验父 change。

## 按需参考

本阶段第 1、2 步为必读；第 5 步按任务触发强制加载。具体命令编排见 `falla-apply-change` Skill。
