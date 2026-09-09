---
name: falla-apply-change
description: Use when implementing or continuing an existing Falla parent or logical parent/child OpenSpec change.
---

# Falla Apply Change

只实施 propose 阶段已经建立的 change，并让官方 OpenSpec 状态与 Falla 协作状态保持一致。

## 开始前

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[模块选读]apply.md`；缺失时停止。
   apply 阶段不读取 preflight、propose 或 archive 阶段文档，也不重新执行这些阶段。
2. 逻辑 `<parent>/<child>` 先解析为物理名：

   ```bash
   falla-openspec coordination resolve "<parent>/<child>" --json
   falla-openspec coordination validate --change "<parent>" --json
   ```

3. 上游依赖未 done、映射异常或 DAG 校验失败时停止，不绕过。阶段中收到或继续依赖
   设计稿链接时执行 Soul 的 MCP 门禁：Figma 链接只用 Figma MCP 读取，禁止用浏览器降级，
   并核对当前节点，不能把早期截图或缓存当作最新设计。
4. owner 为 unassigned 时先认领并把 comate 状态改为 in-progress。
5. 使用物理名读取官方事实：

   ```bash
   openspec status --change "<physical>" --json
   openspec instructions apply --change "<physical>" --json
   ```

## 实施

- 读取官方 `contextFiles` 和 `context`；子 change 还需读取父 change 规划 artifact，不复制它们。
- 逐条考虑 `operationGuidance` 中适用且不冲突的建议；它不能覆盖官方状态、允许编辑路径、
  Falla 门禁或用户明确选择，也不得把 context/guidance 原文复制到代码、日志或报告。
- 只做当前 change 的最小改动；完成一项验证后才勾选对应 task。
- UI 实施保留需要人工校准的视觉项，并写入 handoff。
- 不明确、设计冲突或执行错误时暂停，把 comate 改为 blocked 并记录原因、进度、下一步。
- 全部任务和验证完成后才标记 done，并重新运行 coordination validate。
- 检查空值/NPE、异步与观察者生命周期、销毁后 UI 更新和敏感日志风险。

## 防止阶段错位

- `falla-preflight`、`falla-propose`、`falla-apply-change`、`falla-archive-change` 是
  Agent Skill 名称，不是 Shell 命令；不得在终端执行它们。
- apply 只使用 `falla-openspec coordination ...` 和官方 `openspec ...` 命令。
- 依赖未完成时停在 apply 并更新当前 comate，不回退重建 preflight/proposal，也不提前归档。
