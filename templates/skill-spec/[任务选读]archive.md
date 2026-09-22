# [任务选读] Archive（归档）阶段约束

Archive 只负责最终检查、delta spec 决策和官方归档，不重新实施或重新分析需求。通用安全、设计和
状态规则统一继承 `[Must Read]soul.md`。

## 1. 前置检查

1. 从父 `comate.md` 读取执行模式；parallel 通过 coordination resolve 获取物理名。
2. 执行官方 strict validate、status 和 instructions archive。
3. 汇总非 done/skipped artifact、未完成 tasks、comate 状态、结构化 handoff 和人工验证状态。
4. parallel 父 change 归档前运行 coordination validate，确认所有子 change 已完成。
5. 归档只消费现有验证证据，不调用 apply 代替人工测试，也不重新进行源码探索。

## 2. Delta spec 与确认

- 从官方 status 获取 delta spec 路径，汇总对主规格的新增、修改、移除和重命名。
- 用户明确要求归档当前 change，且没有未接受告警时，可使用 `--yes` 执行本次归档。
- validate 失败继续必须额外得到本次明确确认，并使用 `--no-validate`。
- 不同步 delta spec 必须额外得到本次明确确认，并使用 `--skip-specs`。
- 移除某能力最后一个 requirement 只有在用户明确确认退役后才设置 `retire_capabilities: true`。
- 不存在 `--skip-validate` 或 `--force`，不得编造参数。

## 3. 执行

```bash
openspec archive "<physical>" --json --yes
```

仅按本次明确确认追加 `--no-validate` 或 `--skip-specs`。single 只归档父 change；parallel 先归档子
change，再归档父 change。禁止手工移动目录。

官方命令失败时停止。成功后保留 coordination 映射与归档目录中的 comate，并报告归档位置、spec
同步结果和仍存在的告警。
