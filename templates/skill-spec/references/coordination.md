# 任务拆解、协作与验证

## 何时读取

需要选择 single/parallel、创建或认领子 change、维护依赖和 handoff、处理人工验证或恢复长任务时读取。

## 执行模式

- `single` 是默认模式：一个父 change 跟踪全部任务。
- `parallel` 仅在用户明确要求多人/多 Agent 并行、子 change 或独立分派时启用；任务多、MVVM
  分层或理论可并行均不足以启用。
- 子 change 只能在 propose 创建；apply 不创建、拆分或切换模式。

## Parallel 命名与映射

- 逻辑名固定为 `<parent>/<child>`，恰好两段。
- 物理 change 由 `coordination register` 返回，位于 `openspec/changes/`。
- `.falla/coordination.yaml` 只保存逻辑名到物理名映射。
- 子 change 使用 `falla-task-driven`，保存自己的 tasks/comate，引用父 design。
- 创建官方 change 失败时，只有物理目录完全不存在才能 unregister 映射。

## 协作状态

- 父 comate 保存 execution-mode；每个 comate 保存 validation-mode、human-review、owner、status、
  depends-on 和 handoff。
- 只保存正向 `depends-on`，反向 blocks 由协调器推导。
- single 和 parallel 都必须通过 coordination claim 认领；不得手工覆盖其他 owner。
- blocked/done 不通过重复 claim 自动重启。
- 本地锁只覆盖同一真实项目目录；跨机器或不同工作树仍需预先划分文件责任和合并策略。

## 任务和检查点

- task 须能在一次实施上下文完成；过大则返回 propose 拆分。Apply 一次只推进一个 ready task，
  验证后立即勾选并更新 handoff。
- 集成验证失败时保持集成任务未完成；仅当失败证据推翻实施任务的完成条件，才将该任务恢复未完成。
- 已勾选任务被新的构建或运行证据推翻时，更新 handoff 的失败证据和恢复条件，复验后重勾，
  不保留失效结论。
- 若受影响 change 已是 `done`，先确认未归档并暂停下游执行。parallel 中先通知各 owner，按逆依赖
  顺序把已启动的下游子 change 设为 `blocked`，记录失效证据与待复验项；父 owner 将父 `done` 同步恢复
  `in-progress`。仅各自 owner 修改自己的子 comate，不覆盖他人 owner。然后由原 owner 将受影响
  change 设为 `in-progress`、恢复失效 task 的 checkbox 和 handoff；受影响的人工验证退回 `pending`。
  `done` 有未完成 task、父 `done` 有未完成子 change、或运行中的子 change 依赖未完成上游时，
  协调校验均不通过，不得只撤销 checkbox。已归档 change 不原地重开，返回 Propose 规划新 change。
- 修复上游后按依赖顺序由各 owner 手动解除 `blocked` 并复验受影响任务；`blocked`/`done` 不可通过
  重复 claim 自动重启。恢复前后运行 `coordination validate`，确认依赖、checkbox 与 comate 一致。
- handoff 只保存当前任务、决策、修改文件、验证结果、下一步和风险，不写流水账。
- 恢复时依次读取官方 status/instructions、tasks、design、comate、`git status --short` 和相关 diff。
- parallel 执行者只更新自己的子 comate；父 comate 只保存整体决策和跨节点问题。

## 验证模式

- 默认 `hybrid`：Agent 验证当前 task 的完成条件，不默认新增单测；规划的集成节点按
  `android-quality.md` 构建，代码收尾任务集中核对实际生命周期与资源释放。全量 formatter、lint、
  测试和构建不作为每项任务的固定动作；真机、真实服务端或视觉环境由人工核对。
- `human`：Agent 只整理包含上述风险触发项的具体验证清单，实际结果由人工提供；`agent`：执行
  工具能够完成的验证。
- `[人工]` task 只能根据人工明确反馈勾选。
- Figma UI 的视觉验收只接受人工对实际页面的文字反馈：页面/状态、设备配置、区域、预期与实际、
  通过或待改；缺少明确结论时保持 pending，不索取图片，也不把运行时文本核对当作视觉通过。
- `hybrid` 且 tasks 没有 `[人工]` 项时可设 `human-review: not-required`；有人工项时不得使用
  `not-required`，等待期间保持 `in-progress` 和 `pending`，失败为 `failed`，全部通过后为 `passed`。
  `human` 模式即使没有显式 `[人工]` task，也必须有人工确认及反馈。
- 最终收尾只记录实际资源及结论；无须释放时注明“不适用”，不增加无依据的回收。
  必要项无法检查时记录原因和恢复条件，回 Propose 补 `[人工]` 项；未获反馈不得称“无泄漏”。
- 相关代码、资源、配置或验证环境变化后，受影响的人工验证恢复 pending。

## Doctor 边界

`doctor` 用于安装、升级和排障。installation 或当前 change 的 workflow 错误须修复；knowledge
错误只排除对应候选；CodeGraph 不可用允许有界降级。doctor 不证明索引新鲜、MCP 连接或人工验证。
