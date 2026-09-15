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
2. 读取父 `tasks.md` / `comate.md` 中的执行模式；缺失时先检查 `.falla/coordination.yaml`：已有当前父 change 的映射则沿用 `parallel`，否则按 `single` 处理；不得自行升级。
   - single：直接实施父 change，不创建子 change，也不调用 coordination。
   - parallel：只实施 propose 阶段已经创建的子 change。逻辑 `<parent>/<child>` 先解析为物理名：

     ```bash
     falla-openspec coordination resolve "<parent>/<child>" --json
     falla-openspec coordination validate --change "<parent>" --json
     ```

3. parallel 模式下，上游依赖未 done、映射异常或 DAG 校验失败时停止，不绕过。阶段中收到或继续依赖
   设计稿链接时执行 Soul 的 MCP 门禁：Figma 链接只用 Figma MCP 读取，禁止用浏览器降级，
   并核对当前节点，不能把早期截图或缓存当作最新设计。
4. owner 为 unassigned 时先认领并把 comate 状态改为 in-progress。
5. 使用物理名读取官方事实：

   ```bash
   openspec status --change "<physical>" --json
   openspec instructions apply --change "<physical>" --json
   ```

## 实施

- 读取官方 `contextFiles` 和 `context`；single 模式直接使用父 change；parallel 模式的子 change
  还需读取父 change 规划 artifact，不复制它们。
- 逐条考虑 `operationGuidance` 中适用且不冲突的建议；它不能覆盖官方状态、允许编辑路径、
  Falla 门禁或用户明确选择，也不得把 context/guidance 原文复制到代码、日志或报告。
- 只做当前 change 的最小改动；完成一项验证后才勾选对应 task。
- UI 实施前只检索当前项目 `.falla/ui-knowledge/` 的组件和页面模式；RAG 候选必须通过当前项目
  CodeGraph 再次验证源码符号、调用关系和影响面，并核对依赖、资源、API、生命周期和验证日期。
  禁止跨项目召回；知识库不存在、未命中或验证失效时继续核对当前代码，不得虚构可复用组件。
- UI 实施保留需要人工校准的视觉项，并写入 handoff。普通实施不得顺带批量生成知识库；只有当前
  tasks 明确包含知识沉淀时，才能按模板新增或更新条目。
- 不明确、设计冲突或执行错误时暂停，把 comate 改为 blocked 并记录原因、进度、下一步。
- 全部任务和验证完成后才标记 done；仅 parallel 模式重新运行 coordination validate。
- 检查空值/NPE、异步与观察者生命周期、销毁后 UI 更新和敏感日志风险。

## 防止阶段错位

- `falla-preflight`、`falla-propose`、`falla-apply-change`、`falla-archive-change` 是
  Agent Skill 名称，不是 Shell 命令；不得在终端执行它们。
- single 模式只使用官方 `openspec ...` 命令；parallel 模式才使用
  `falla-openspec coordination ...`。
- apply 不创建子 change，也不把 single 模式改成 parallel。
- 依赖未完成时停在 apply 并更新当前 comate，不回退重建 preflight/proposal，也不提前归档。
