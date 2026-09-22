# [任务选读] Archive（归档）

## 目标

确认实施和验收已经结束，使用官方 OpenSpec 同步 delta spec 并归档。不得在本阶段重新实施需求。

## 输入

- 官方 strict validate、status 和 instructions archive。
- 当前 change 的 tasks/comate。
- parallel 模式下的子 change 状态。
- 用户对告警、跳过同步或能力退役的明确选择。

## 必须执行

1. 从父 comate 读取执行模式；parallel 逻辑子 change 先 resolve。
2. 执行：

   ```bash
   openspec validate "<physical>" --strict --json --no-interactive
   openspec status --change "<physical>" --json
   openspec instructions archive --change "<physical>" --json
   ```

3. 汇总非 done/skipped artifact、未完成 tasks、comate 状态、handoff、人工验证和 delta spec 影响。
4. parallel 父 change 归档前运行 coordination validate，并先归档子 change。
5. 用户明确要求归档且没有未接受告警时执行：

   ```bash
   openspec archive "<physical>" --json --yes
   ```

## 何时暂停

- 官方命令失败。
- 有未完成任务、未通过人工验证或未交接阻塞项，而用户尚未决定如何处理。
- validate 失败但用户尚未明确接受 `--no-validate`。
- 用户尚未明确选择跳过 spec 同步或退役能力。

不得使用 `--force` 或不存在的 `--skip-validate`，不得手工移动 change 目录。

## 完成标准

- 官方归档成功。
- 已报告归档位置、spec 同步结果和仍存在的告警。
- coordination 映射和归档目录内的 comate 审计记录得到保留。

## 按需参考

- 并行状态和完成门禁：`references/coordination.md`
- 归档阶段重新依赖设计节点时：`references/design-tools.md`
