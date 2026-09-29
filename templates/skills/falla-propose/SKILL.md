---
name: falla-propose
description: Use when an existing Android Falla preflight change needs proposal artifacts, architecture planning, or explicitly requested parallel child-change decomposition.
---

# Falla Propose

把已完成 preflight 的父 change 转成可实施的官方 OpenSpec 规划。

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
3. 授权 Figma 时先读父 change 的 `design-source.md`；旧 change 仅有 preflight/design 技术引用时，
   从原记录迁入该文件，不要求用户重贴链接或因此重读 Figma。已核对事实足够时不重复读取 Figma；
   缺少设计所需字段才补读已授权的精确节点，再按阶段规则生成 proposal、specs、design、tasks 和 comate。
   新节点只追加到 `design-source.md`；`design.md` 只保存可实施的设计结论，不复制精确引用和资源哈希。
   纯重构、工具或文档变更使用官方 `skip_specs: true` 语义。
   UI Knowledge 选定复用或用户明确指定且条件满足的组件，须写入 design 的 required 实现约束，
   并落实到相关 task/子 change 的完成条件；不把仅召回的候选强制复用。
4. `comate.md` 是执行模式和验证模式的唯一记录：默认 `execution-mode: single`、
   `validation-mode: hybrid`。无 `[人工]` task 时 human-review 为 `not-required`，否则为 `pending`；
   `tasks.md` 不重复保存这些字段。
5. 只有用户明确要求并行分派时才创建子 change：

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
