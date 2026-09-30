---
name: falla-archive-change
description: Use when closing and archiving a completed or explicitly accepted Android Falla OpenSpec change.
---

# Falla Archive Change

使用官方 OpenSpec 同步 delta spec 并归档，保留协作审计记录。

## 权威规则

执行前确认已加载：

- `.falla/skill-spec/[Must Read]soul.md`
- `.falla/skill-spec/[任务选读]archive.md`

运行环境已经通过 Hook 注入时不要重复读取；未注入或无法确认时再读取。缺失任一文件即停止。
`references/coordination.md` 是所有归档模式的强制规则；未加载时必须显式读取。
通用原则以 Soul 为准；具体工具和协作规则按阶段文档加载，不重复维护取值或完成契约。

## 编排

1. single、parallel 父和逻辑/物理子 change 均执行：

   ```bash
   falla-openspec coordination resolve "<change>" --json
   ```

   只用返回的 physical 读取官方事实，不猜物理名与父子关系。
2. 执行：

   ```bash
   openspec validate "<physical>" --strict --json --no-interactive
   openspec status --change "<physical>" --json
   openspec instructions archive --change "<physical>" --json
   ```

3. 按阶段规则核对发起责任并汇总未完成告警、人工验收结果、handoff 和 delta spec 影响。
   parallel 父最终归档由当前父协调者发起，子 owner 配合依赖顺序；交接先走 coordination，不手改 owner。
   归档任何目标前都执行，不能仅在 parallel 父归档时检查：

   ```bash
   falla-openspec coordination preflight "<change>" --json
   falla-openspec coordination validate --change "<parent>" --json
   ```

   preflight 成功返回结果的 parent 才是第二条命令的目标；single 为自身，子 change 为实际父。
   两条均须退出码 0 且 `ok: true`；非零、false、缺少或无效结果都停止，不调用官方归档。
   parallel 先按依赖顺序归档子 change，再归档父；每个子归档前及父最终归档前分别重验，不沿用旧结果。
4. 用户已明确要求归档当前 change，且没有未接受告警时执行：

   ```bash
   openspec archive "<physical>" --json --yes
   ```

   用户接受未完成告警时按阶段规则保留真实进度，不伪造 done 或人工 passed。
   等待确认或修改记录后重新运行第 2–3 步，包括 `coordination validate`，不复用等待前的通过结果。
5. 只有用户针对本次官方告警明确确认时才追加 `--no-validate` 或 `--skip-specs`。能力退役只有在用户明确
   确认后才设置 `retire_capabilities: true`。`--no-validate` 不能豁免 Falla 错误；其他官方选项同样不覆盖第 3 步。

## 边界

不得使用 `--force`、`--skip-validate` 或手工移动目录。Falla 错误先按 coordination 修复，不作为用户可接受的普通告警。
归档仍使用官方 CLI；不新增归档内核，不改写归档审计记录。
