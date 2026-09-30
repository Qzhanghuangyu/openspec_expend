# [任务选读] Archive（归档）

## 目标

确认实施与验收完成，使用官方 OpenSpec 同步 delta spec 并归档。不得在本阶段重新实施需求。

## 输入

- 官方 strict validate、status 和 instructions archive。
- 当前 change 的 tasks/comate，以及对应父 change 的协作图和实施基线。
- 用户对未完成告警、跳过同步或能力退役的明确选择。

## 必须执行

1. 所有模式归档前必须读取 `references/coordination.md` 的完成、基线与回退门禁。
   single、parallel 父和逻辑/物理子 change 均先执行 `coordination resolve "<change>" --json`，
   只用返回的 physical 读取官方事实；不得按物理名是否包含 `-child-` 猜测父子关系。
2. 执行：

   ```bash
   openspec validate "<physical>" --strict --json --no-interactive
   openspec status --change "<physical>" --json
   openspec instructions archive --change "<physical>" --json
   ```

3. 核对非 done/skipped artifact、未完成 tasks、comate、handoff、人工验证和 delta spec 影响。
   按下节区分可由用户明确接受的未完成告警与必须修复的 Falla 错误；官方 strict validate 不替代协作校验。
4. 对每个将归档的目标执行以下门禁，无论 single、parallel 父和逻辑/物理子 change：

   ```bash
   falla-openspec coordination preflight "<change>" --json
   falla-openspec coordination validate --change "<parent>" --json
   ```

   第一条检查成功后，parent 只取返回结果的 `parent`；single 的 parent 为自身，子 change 归一到实际父。
   两条命令均须退出码 0 且 `ok: true`。非零、`ok: false`、缺少/无效结果都立即停止，不执行官方归档。
   不以子 tasks 已勾选、官方 all_done 或 strict validate 成功跳过父 DAG；物理子名不能绕过父门禁。
   parallel 按依赖顺序先归档子 change，再归档父 change；每个子归档前及父最终归档前分别执行门禁。
5. 用户明确要求归档当前目标，且没有未接受告警时才执行：

   ```bash
   openspec archive "<physical>" --json --yes
   ```

   等待用户确认或修改任何记录后，重新执行当前目标的官方检查和 `coordination validate`（并重验 preflight），
   不复用等待前或另一个目标的通过结果。归档操作仍由官方 CLI 完成，不手工移动目录。

## 告警与错误边界

- 未完成告警可由用户针对当前目标及具体缺口明确接受；记录已完成范围、未完成/未验收项、风险和恢复条件，
  保留真实 checkbox、comate 状态及人工反馈。不得为了归档伪造 done 或人工 passed，也不把接受未完成当作完成证据。
- `coordination validate` 的错误不是未完成告警：任务依赖/结构错误、父子状态冲突、未决需求、基线失效、
  done 缺任务/handoff/人工证据等须先按 coordination 规则由原 owner 修复或回退，再重新校验。
  没有可核实的当前证据，不补勾、不追认 passed、不刷新指纹追认旧结论。
- 官方 `--no-validate` 只跳过官方校验，不能豁免 Falla 门禁；`--yes`、`--skip-specs` 和能力退役配置同样不能。
  用户接受官方校验告警时必须明确针对本次告警，不能据此跳过上述两条 Falla 检查。
- 已归档的未完成记录保持审计事实，不作为有效 done 依赖；有恢复需求时新建 change，不原地重开。

## 何时暂停

- 官方命令失败且缺少适用的用户明确选择。
- Falla 门禁失败，或无法确认结果及对应父引用。
- 未完成任务、未通过人工验证或未交接阻塞项尚无处理决定。
- 官方 validate 失败但用户尚未明确接受 `--no-validate`；这不改变 Falla 错误必须修复的要求。
- 跳过 spec 同步或退役能力尚无用户决定。

不得使用 `--force` 或不存在的 `--skip-validate`，不得手工移动 change 目录。

## 完成标准

- 当前目标的 Falla 门禁已通过，官方归档成功。
- 已报告归档位置、spec 同步结果和仍存在的告警；接受未完成的归档不报告实施/验收已完成。
- coordination 映射、基线和归档目录内的 comate 审计记录得到保留。

## 按需参考

- 所有模式强制：`references/coordination.md` 的完成、基线及回退门禁。
- 归档阶段重新依赖设计节点时：`references/design-tools.md`。
