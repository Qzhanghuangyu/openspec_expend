# 任务拆解、协作与验证

## 何时读取

需要选择 single/parallel、创建或认领子 change、维护依赖和 handoff、处理人工验证、重规划基线复核、所有模式归档或恢复长任务时读取。

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
- 认领在项目锁内检查父 preflight 准入；Blocker 状态与确认依据契约见 `[分析必读]preflight.md`
  的“阻塞项准入记录”，依赖该检查时必须加载该权威章节。子任务共用父记录，物理名不能绕过。
  未核验的旧记录和缺依据的决定都阻断首次认领及同 owner 重试，失败不写 owner/status。
  定向 validate 与 doctor 的下游规划/实施检查也使用此门禁；Preflight 分析期可正常保存待确认问题。
  可达依赖的父记录同样受检，包括归档依赖；旧归档缺少证据时不原地改写，应通过新 change 重新核实所需契约。
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

## 实施基线与完成证据失效

- `comate.md` 是唯一基线台账，不另建重复事实源。保留 format-version: 2，新增单行 JSON 字段
  `- 实施基线 (baseline): unrecorded`、`- 基线复核 (baseline-review): none`；快照只能由
  `coordination baseline` 生成，不手工编造 hash。字段缺失兼容读取，但旧实施/完成证据报告未核验。
- 快照 version: 1，仅保存 fingerprint、固定来源名称的摘要和稳定 task 编号摘要，不复制正文。
  来源含父 preflight/已确认决定、proposal、specs、design、prd-source/design-source、schema 配置、协作契约及可达上游交付基线；
  子 change 使用父公共来源/父任务和本地任务，不用子自己的 preflight/design 覆盖父。
  可达上游按规范引用与已记录 fingerprint 关联，上游重新完成不自动恢复消费者旧完成证据；外部子依赖也核对其父前置，
  不虚构父必须先 done。代码、资源和外部环境变化的证据回退仍按下文处理，指纹不证明代码、人工反馈或远端内容未变。
- 忽略 checkbox、owner/status/human-review/handoff 更新；BOM、CRLF、非代码区普通空行和无语义行尾空白
  不算实质变更。代码块、缩进代码、Markdown 硬换行、YAML 字面量保留空白；不确定的排版差异只触发复核，
  不自动撤销全部进度。文件 256 KiB、specs 最多 64 个 Markdown 文件/128 个目录/2 MiB，不截断后继续。
- 只读检查：`falla-openspec coordination baseline "<change>" --json`；返回当前/已记录指纹、固定来源名、
  稳定 task 编号，不返回复核依据正文。`baseline-review-required` 为已记录版本变化，`baseline-unverified`
  为旧有证据缺快照；结构/安全读取失败分别为 `baseline-invalid` / `baseline-unreadable`。错误均不能当通过。
- 纯 todo、无勾选及无 passed 人工证据时可在 Propose 用
  `falla-openspec coordination baseline "<change>" --record --owner "<id>" --json` 初始化。
  首次 claim 也会在锁内随认领一起记录初始快照；不迁移已有进度，不改变其他 owner，失败不写部分状态。
  死亡 PID 残留锁回收另有独占恢复保护；保护残留时停止，人工确认无操作使用后再处理，不自动递归清理。

### 显式复核与重规划

1. 需求未明确、PRD 已确认决定改变/冲突或来源缺失：回 Preflight 核实及获得明确决定；已确认需求内的
   design/spec/task 技术修订回 Propose。仅“继续”或更新指纹不等于新需求被批准。归档内容不原地重开，使用新 change。
2. 修改基线前后列受影响 task、后继依赖、集成/生命周期/人工验收项及不受影响证据；按下文回退协议先暂停下游，
   各 owner 只回退自己记录，父状态同步恢复。仅受影响 checkbox 撤销，相关人工验证恢复 pending，保留不受影响进度。
3. 在自己的 comate 顶部写单行 `baseline-review` JSON，字段固定为 `from`（旧指纹，旧记录无快照为 null）、
   `to`（只读检查的当前指纹）、`affected`（需回退的稳定任务编号）、`preserved`（有依据保留的其余任务编号）、
   `evidence`（精简可追溯复核依据）。例如两项任务中仅第二项改变：

   ```json
   {"from":"<旧 fingerprint；无旧快照为 null>","to":"<当前 fingerprint>","affected":["1.2"],"preserved":["1.1"],"evidence":"1.2 完成条件改变需重做；1.1 输入/交付未变，已核对既有验证仍适用"}
   ```

   填真实指纹，不保留占位符；affected/preserved 无重复且不重叠，覆盖当前所有任务及已删除旧任务。
   affected 当前任务必须未勾选，包含人工项或 human 验证模式时 human-review 必须 pending；done 有 affected 先恢复非 done。
   内容/完成条件已改变的 task 不得列 preserved；旧无编号任务先由 Propose 显式核实编号、依赖、现有进度，
   不自动重编或全量撤销。evidence 不保存完整对话、敏感正文、个人信息、凭据或临时 URL。
4. 回退落盘后由当前 owner 运行上述 `--record --owner`，程序在协调锁内核对版本、影响清单、回退状态、
   父 DAG 非基线错误、文件 hash 与当前输入，再仅更新本 comate 的 baseline；不自动改 checkbox、owner/status、
   人工状态或兄弟记录。其他 owner 的旧版本仍单独阻断，不能更新父指纹来替子通过。
5. 复核后重新运行 `coordination validate`；有基线错误不得继续实施、宣称 all_done 有效或交付完成。
   --record 只证明结构与已登记影响清单一致，不能证明范围判断正确、验证真实或人工已经通过；完成仍须当前证据。

## 任务和检查点

- task 须能在一次实施上下文完成；过大则返回 Propose 拆分，强耦合任务须返回 Propose 合并为
  一个可独立验证的 task。用户手动进入 Apply 后，每轮（初次调用或用户在同一会话明确回复“继续”）
  只推进一个 ready task；验证后立即勾选并更新 handoff，未完成或验证失败不得提前勾选或批量补勾。
  当前 task 状态落盘并核对后结束本轮，向用户汇报下一候选并等待明确确认，不自动执行下一项。
  用户在同一 Apply 会话回复“继续”后无需重新调用 Apply；下一轮先复核当前状态与依赖，当前 task
  未完成时只恢复本 task，不借澄清答复切换任务；已完成时才选择下一个 ready task。
- 集成验证失败时保持集成任务未完成；仅当失败证据推翻实施任务的完成条件，才将该任务恢复未完成。
- 已勾选任务被 PRD/已确认决定、spec/design/task 完成条件的实质修订或新的构建/运行证据推翻时，更新 handoff 的失败证据和恢复条件，复验后重勾，
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
- 相关需求/设计/完成条件、代码、资源、配置或验证环境变化后，受影响的人工验证恢复 pending；不保留旧版本的 passed 结论。

## 归档阶段复用门禁

所有模式的归档均由 `[任务选读]archive.md` 强制调用父 DAG 协调校验，single、parallel 父及子 change
都不能省略。归档的目标归一化、官方命令、等待后重新校验和告警/错误区分由该阶段规则负责，
不另建归档状态机；本节的任务、基线、父子及人工完成契约不因官方归档选项而放宽。

## Doctor 边界

`doctor` 用于安装、升级和排障。installation 或当前 change 的 workflow 错误须修复；knowledge
错误只排除对应候选；CodeGraph 不可用允许有界降级。doctor 不证明索引新鲜、MCP 连接或人工验证。
