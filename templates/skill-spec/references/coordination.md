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
- 认领前在项目锁内校验当前父 DAG 及可达依赖，包含被依赖父 change 的子记录；逻辑名和物理名
  归一后检测环，并计入父完成对子完成的隐含依赖。首次认领和同 owner 重试采用同一门禁，
  兄弟节点记录失效也须先修复，失败不修改认领字段。
- blocked/done 不通过重复 claim 自动重启。
- 本地锁只覆盖同一真实项目目录；跨机器或不同工作树仍需预先划分文件责任和合并策略。

## 记录契约

- 新 comate 使用 `format-version: 2`；父记录默认为 `execution-mode: single`，验证默认为 `hybrid`。
- 无人工任务时 hybrid 初始化 `human-review: not-required`，否则为 `pending`；agent 不得含人工任务。
- `[人工]` 可出现在 checkbox 同行或所属任务续行；任务内部缩进的空行、标题和代码块不切断归属。
  独立章节、同级普通列表或空行后的独立段落不属于上一任务；checkbox 总数遵循官方 OpenSpec 语义。
- done 要求全部 tasks 完成，handoff 的“已完成、注释审计、验证证据、安全与敏感信息结论、
  遗留风险与恢复条件”均有实际内容；人工验收 passed 还须填写“人工验证反馈”。字段结构见 comate 模板。
- 父 done 要求所有子 change done；认领前也检查当前记录的验证模式冲突与必需字段。
- `coordination validate`、doctor 和 claim 共用本地任务图校验：拦截重复编号、无效/缺失/自身依赖、
  依赖环，以及前置未完成却已勾选后续任务。新格式另校验章节编号、依赖字段与拓扑顺序；格式及
  旧记录兼容规则见 Propose“任务拆解”。报错先修复对应 tasks，失败认领不写 owner/status。
  每个 task 检查点落盘后也须校验；校验失败先按下文回退失效进度，不得报告任务完成。

## 任务和检查点

- task 须能在一次实施上下文完成；过大则返回 Propose 拆分，强耦合任务须返回 Propose 合并为
  一个可独立验证的 task。用户手动进入 Apply 后，每轮（初次调用或用户在同一会话明确回复“继续”）
  只推进一个 ready task；验证后立即勾选并更新 handoff，未完成或验证失败不得提前勾选或批量补勾。
  当前 task 状态落盘并核对后结束本轮，向用户汇报下一候选并等待明确确认，不自动执行下一项。
  用户在同一 Apply 会话回复“继续”后无需重新调用 Apply；下一轮先复核当前状态与依赖，当前 task
  未完成时只恢复本 task，不借澄清答复切换任务；已完成时才选择下一个 ready task。
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

- 默认 `hybrid`：Agent 验证可执行的完成条件，真实环境或视觉等工具无法完成的项交人工；
  具体构建、测试、生命周期与资源释放门禁以 `android-quality.md` 为准。
- `human`：Agent 只整理包含上述风险触发项的具体验证清单，实际结果由人工提供；`agent`：执行
  工具能够完成的验证。
- `[人工]` task 只能根据人工明确反馈勾选。
- UI 视觉验收的执行与反馈内容以 `android-quality.md` 的“UI 文本核对与视觉边界”为准。
- `hybrid` 且 tasks 没有 `[人工]` 项时可设 `human-review: not-required`；有人工项时不得使用
  `not-required`，等待期间保持 `in-progress` 和 `pending`，失败为 `failed`，全部通过后为 `passed`。
  `human` 模式即使没有显式 `[人工]` task，也必须有人工确认及反馈。
- 相关代码、资源、配置或验证环境变化后，受影响的人工验证恢复 pending。

## Doctor 边界

`doctor` 用于安装、升级和排障。installation 或当前 change 的 workflow 错误须修复；knowledge
错误只排除对应候选；CodeGraph 不可用允许有界降级。doctor 不证明索引新鲜、MCP 连接或人工验证。
