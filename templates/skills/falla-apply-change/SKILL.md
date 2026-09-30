---
name: falla-apply-change
description: Use when implementing or continuing an existing Android Falla parent or logical parent/child OpenSpec change.
disable-model-invocation: true
---

# Falla Apply Change

只实施 propose 已建立的父 change 或逻辑子 change。
首次进入本阶段由用户手动调用本 Skill；同一会话回复“继续”可恢复下一轮，无需重新调用 Skill。
不得因 Propose 完成或 task ready 自动 Apply。

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

4. 执行 `falla-openspec coordination baseline "<change>" --json`；基线变化或旧证据未核验先按
   coordination 的影响复核协议处理，不直接刷新指纹。再加载当前 task 的 context 与必需参考，复核设计和规则门禁。
5. `blocked` 时停止，`all_done` 时也核对基线、当前完成证据与交接，`ready` 时认领：

   ```bash
   falla-openspec coordination claim "<change>" --owner "<id>" --json
   ```

   claim 会在项目锁内重新检查官方状态和依赖；不得绕过该复核。
6. 按阶段规则执行当前任务、验证并落盘检查点。
7. 当前 task 检查点落盘后运行 `falla-openspec coordination validate --change "<parent>" --json`。
   若要将 change 设为 done，先核齐任务、handoff 和人工验收证据并落盘最终状态，再校验；
   失败时按 coordination 恢复有效状态，不得报告 task 完成或 change done。
8. 当前 task 状态落盘后，重新读取 instructions/tasks，
   只核对本次状态与下一个候选并报告，然后停止本轮；用户回复“继续”才恢复下一轮，
   同一 Apply 会话无需重新调用 Apply，也不得自动认领或实施下一项。恢复时从第 3–5 步复核
   最新官方状态、依赖与认领门禁，不直接执行上轮报告的候选。

## 边界

不得创建或拆分 change，不得切换执行/验证模式，不得自动 archive、commit、push、merge 或 rebase。
