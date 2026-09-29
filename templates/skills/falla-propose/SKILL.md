---
name: falla-propose
description: Use when an existing Android Falla preflight change needs proposal artifacts, architecture planning, or explicitly requested parallel child-change decomposition.
disable-model-invocation: true
---

# Falla Propose

把已完成 preflight 的父 change 转成可实施的官方 OpenSpec 规划。
仅在用户本轮手动调用本 Skill 时开始；preflight done/Blocker 澄清不自动触发。

## 权威规则

执行前确认已加载：

- `.falla/skill-spec/[Must Read]soul.md`
- `.falla/skill-spec/[架构必读]propose.md`

运行环境已经通过 Hook 注入时不要重复读取；未注入或无法确认时再读取。缺失任一文件即停止。
`references/project-rules.md` 是本阶段强制规则；Hook 未注入时必须显式读取。
通用原则以 Soul 为准；具体工具、质量和协作规则只按阶段文档的“按需参考”加载。

## 编排

1. 执行 `openspec status --change "<parent>" --json`；`preflight` 未完成时停止。
2. 按官方状态依次执行：

   ```bash
   openspec instructions <proposal|specs|design|tasks|comate> --change "<parent>" --json
   ```

   只使用返回的模板、依赖和 `resolvedOutputPath`。
3. 按阶段规则生成各 artifact，执行对应权威参考的规划门禁。
4. 从当前 comate 读取执行模式，按阶段规则初始化协作记录。
5. 阶段规则确定采用 parallel 后，执行子 change 编排：

   ```bash
   falla-openspec coordination register "<parent>/<child>" --json
   openspec new change "<physical>" --schema falla-task-driven --json
   openspec instructions tasks --change "<physical>" --json
   openspec instructions comate --change "<physical>" --json
   falla-openspec coordination validate --change "<parent>" --json
   ```

   逻辑名恰好两段且允许数字开头；物理名只使用 register 返回值。
6. 再次执行官方 status；父规划及已创建子 change 的 planning artifacts 必须完成。

## 边界

本阶段只规划，不修改业务代码。apply 不得创建子 change，也不得切换执行模式。
完成后交付 design/tasks 供用户审阅或修改并停止，不得自动调用 Apply。
