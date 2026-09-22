---
name: falla-apply-change
description: Use when implementing or continuing an existing Android Falla parent or logical parent/child OpenSpec change.
---

# Falla Apply Change

只实施 propose 已建立的父 change 或逻辑子 change。

## 权威规则

执行前确认已加载：

- `.falla/skill-spec/[Must Read]soul.md`
- `.falla/skill-spec/[模块选读]apply.md`

运行环境已经通过 Hook 注入时不要重复读取；未注入或无法确认时再读取。缺失任一文件即停止。
通用工具、安全、生命周期、范围锁、项目规则和实现质量要求统一以 Soul 为准。

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

4. `blocked` 时停止，`all_done` 时只核对交接，`ready` 时认领：

   ```bash
   falla-openspec coordination claim "<change>" --owner "<id>" --json
   ```

   claim 会在项目锁内重新检查官方状态和依赖；不得绕过该复核。
5. 按阶段规则执行“单任务原子循环”：一次只处理一个 ready task；完成条件与最小验证满足后立即
   勾选该 checkbox 并更新 `comate.md` handoff，禁止累计多个 task 后批量勾选。验证模式只从当前
   `comate.md` 读取。
6. task 未完成或验证失败时不得勾选；先把进度、失败证据和恢复条件写入 handoff，再暂停或继续修复。
7. 每个 task 状态落盘后重新读取 instructions/tasks，再选择下一个 ready task。
8. 完成前运行阶段规则要求的定向门禁；parallel 再运行 coordination validate。

## 边界

不得创建或拆分 change，不得切换执行/验证模式，不得自动 archive、commit、push、merge 或 rebase。
