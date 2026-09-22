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
通用工具、安全、设计和状态规则统一以 Soul 为准。

## 编排

1. 从父 `comate.md` 读取执行模式；parallel 逻辑子 change 通过 coordination resolve 获取物理名。
2. 执行：

   ```bash
   openspec validate "<physical>" --strict --json --no-interactive
   openspec status --change "<physical>" --json
   openspec instructions archive --change "<physical>" --json
   ```

3. 按阶段规则汇总未完成项、人工验证、handoff 和 delta spec 影响。parallel 父 change 归档前执行：

   ```bash
   falla-openspec coordination validate --change "<parent>" --json
   ```

4. 用户已明确要求归档当前 change，且没有未接受告警时执行：

   ```bash
   openspec archive "<physical>" --json --yes
   ```

5. 只有用户针对本次告警明确确认时才追加 `--no-validate` 或 `--skip-specs`。能力退役只有在用户明确
   确认后才设置 `retire_capabilities: true`。

## 边界

不得使用 `--force`、`--skip-validate` 或手工移动目录。parallel 先归档子 change，再归档父 change。
