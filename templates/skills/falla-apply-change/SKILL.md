---
name: falla-apply-change
description: Use when implementing or continuing an existing Android Falla parent or logical parent/child OpenSpec change.
disable-model-invocation: true
---

# Falla Apply Change

只实施 propose 已建立的父 change 或逻辑子 change。
仅在用户本轮手动调用本 Skill 时开始；不得因 Propose 完成或 task ready 自动 Apply。

## 权威规则

执行前确认已加载：

- `.falla/skill-spec/[Must Read]soul.md`
- `.falla/skill-spec/[模块选读]apply.md`

运行环境已经通过 Hook 注入时不要重复读取；未注入或无法确认时再读取。缺失任一文件即停止。
`references/project-rules.md` 是本阶段强制规则；Hook 未注入时必须显式读取。
通用原则以 Soul 为准；具体工具、质量和协作规则只按阶段文档的“按需参考”加载。

## 编排

1. 从父 `comate.md` 读取唯一执行模式；parallel 使用逻辑子 change，single 使用父 change。
2. parallel 先解析目标；只有需要整体拓扑报告时执行定向校验：

   ```bash
   falla-openspec coordination resolve "<parent>/<child>" --json
   falla-openspec coordination validate --change "<parent>" --json
   ```

3. 使用物理名读取官方事实：

   ```bash
   openspec status --change "<physical>" --json
   openspec instructions apply --change "<physical>" --json
   ```

4. 按阶段规则加载当前 task 的 context 与必需参考，复核设计和规则门禁。
5. `blocked` 时停止，`all_done` 时只核对交接，`ready` 时认领：

   ```bash
   falla-openspec coordination claim "<change>" --owner "<id>" --json
   ```

   claim 会在项目锁内重新检查官方状态和依赖；不得绕过该复核。
6. 按阶段规则执行当前任务、验证并落盘检查点。
7. 每个 task 状态落盘后重新读取 instructions/tasks，再选择下一个 ready task。
8. 完成前运行 `falla-openspec coordination validate --change "<parent>" --json`。

## 边界

不得创建或拆分 change，不得切换执行/验证模式，不得自动 archive、commit、push、merge 或 rebase。
