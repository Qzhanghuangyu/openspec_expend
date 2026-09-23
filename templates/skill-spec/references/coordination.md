# 任务拆解、协作与验证

## 何时读取

需要选择 single/parallel、创建或认领子 change、维护依赖和 handoff、处理人工验证或恢复长任务时读取。

## 执行模式

- `single` 是默认模式：一个父 change 跟踪全部任务。
- `parallel` 只在用户明确要求多人/多 Agent 并行、创建子 change 或独立分派时启用。
- 任务多、存在 MVVM 分层或理论上可并行，都不能自动切换为 parallel。
- 子 change 只能在 propose 创建；apply 不创建、拆分或切换模式。

## Parallel 命名与映射

- 逻辑名固定为 `<parent>/<child>`，恰好两段。
- 物理 change 由 `coordination register` 返回，位于 `openspec/changes/`。
- `.falla/coordination.yaml` 只保存逻辑名到物理名映射。
- 子 change 使用 `falla-task-driven`，只包含自己的 tasks/comate，并引用父 design。
- 创建官方 change 失败时，只有物理目录完全不存在才能 unregister 映射。

## 协作状态

- 父 comate 保存 execution-mode；每个 comate 保存 validation-mode、human-review、owner、status、
  depends-on 和 handoff。
- 只保存正向 `depends-on`，反向 blocks 由协调器推导。
- single 和 parallel 都必须通过 coordination claim 认领；不得手工覆盖其他 owner。
- blocked/done 不通过重复 claim 自动重启。
- 本地锁只覆盖同一真实项目目录；跨机器或不同工作树仍需预先划分文件责任和合并策略。

## 任务和检查点

- task 必须能在一次独立实施上下文内完成；跨度过大时返回 propose 继续拆分。
- Apply 一次只推进一个 ready task，完成并验证后立即勾选并更新 handoff。
- handoff 只保存当前任务、关键决策、修改文件、验证结果、下一步和风险，不追加流水账。
- 恢复时依次读取官方 status/instructions、tasks、design、comate、`git status --short` 和相关 diff。
- parallel 执行者只更新自己的子 comate；父 comate 只保存整体决策和跨节点问题。

## 验证模式

- 默认 `hybrid`：Agent 按完成条件验证，不默认新增单测；签名、资源、XML 或构建配置变化做受影响
  模块编译；页面退出静态核对清理与 NPE，需证明释放时做运行时退出检查。
  不机械运行全量 formatter、lint、测试或构建；人工核对确需真机、真实服务端或视觉环境的部分。
- `human`：Agent 只整理包含上述风险触发项的具体验证清单，实际结果由人工提供；`agent`：执行
  工具能够完成的验证。
- `[人工]` task 只能根据人工明确反馈勾选。
- `hybrid` 且 tasks 没有 `[人工]` 项时可设 `human-review: not-required`；有人工项时不得使用
  `not-required`，等待期间保持 `in-progress` 和 `pending`，失败为 `failed`，全部通过后为 `passed`。
  `human` 模式即使没有显式 `[人工]` task，也必须有人工确认及反馈。
- 静态生命周期核对与运行时退出结果分开记录；所需实测不可执行时保留未完成的验证项、原因和恢复
  条件，规划缺少 `[人工]` 项则回 Propose 补齐。不得把未实测写成“无泄漏”。
- 相关代码、资源、配置或验证环境变化后，受影响的人工验证恢复 pending。

## Doctor 边界

`doctor` 用于安装、升级和排障。installation 或当前 change 的 workflow 错误必须修复；knowledge
错误只排除对应候选；CodeGraph 不可用允许有界降级。doctor 不证明索引新鲜、MCP 连接或人工验证。
