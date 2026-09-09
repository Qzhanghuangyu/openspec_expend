---
name: falla-archive-change
description: Use when closing and archiving a completed or explicitly accepted Falla OpenSpec change.
---

# Falla Archive Change

用官方 OpenSpec 同步 delta spec 并归档，保留协作审计记录。

## 归档前

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[任务选读]archive.md`；缺失时停止。
2. 逻辑子 change 先用 coordination resolve 获取物理名。
3. 运行：

   ```bash
   openspec validate "<physical>" --strict --json --no-interactive
   openspec status --change "<physical>" --json
   openspec instructions archive --change "<physical>" --json
   falla-openspec coordination validate --change "<parent>" --json
   ```

4. 应用 archive instructions 返回的 `context`，并只采纳适用且不冲突的 `operationGuidance`；
   guidance 不能覆盖官方状态、安全门禁或用户选择，也不得原样写入报告。
5. 汇总非 done/skipped artifact、未完成 tasks、非 done comate、未交接子 change，以及官方 status
   返回的 delta spec 路径与同步影响。

## 有告警时

告警必须展示，但沿用 Falla 现有规则：它们不是自动的绝对阻断。向用户提供三个明确选择：

1. 先修复再归档；
2. 明确接受告警后继续；
3. 明确跳过 spec 同步后继续。

不要自行勾选任务、解除 blocked、编造 abandoned/cancelled 流程或猜测用户选择。
若 delta 会移除某能力的最后一项 requirement，只有用户明确确认退役后才可设置
`.openspec.yaml` 的 `retire_capabilities: true`；该操作会删除主规格，不得根据空结果自动推断。
只有用户针对本次操作明确确认时，才可使用：

- validate 失败继续：`--no-validate`；
- 不同步 delta spec：`--skip-specs`；
- 已完成人工确认：`--yes`。

`--skip-validate` 和 `--force` 不是允许的参数，不得编造或替换。用户接受 validate 告警
但没有要求跳过 spec 同步时，完整命令必须是：

```bash
openspec archive "<physical>" --json --yes --no-validate
```

只有用户另行明确选择“不更新主规格”，才变为：

```bash
openspec archive "<physical>" --json --yes --no-validate --skip-specs
```

## 执行

无告警或已经修复并通过 validate 时使用
`openspec archive "<physical>" --json --yes`。

根据本次明确选择追加例外参数。子 change 与父 change 分别归档，父 change 在全部子 change
完成或明确交接后处理。不得手工 `mv`，不得执行 Skill 名称作为命令。

官方命令失败时停止；成功后保留 coordination 映射与归档内 `comate.md`，并报告归档位置、
spec 同步结果和仍存在的告警。
