# 项目规则强制门禁

## 何时读取

Propose 和 Apply 必读。此文件不是可选参考。

## 确定性读取

如果 `.falla/project-rules/` 存在：

1. 按文件名排序读取其顶层所有普通 `.md` 文件，包括 `index.md`；不得只读取索引、依赖 RAG 召回、
   跟随符号链接、递归子目录或越过项目根。
2. 文件数超过 32 或累计超过 256 KiB 时停止，要求项目维护者精简；不得截断后继续。
3. 提取每条 Rule ID、级别、适用条件、约束、证据和例外。

## Required 审计

每条 `required` 都必须在 design 的“项目规则审计”中出现，不能因为判断为不适用而省略：

- `适用`：记录命中证据、落地方式，并转成 tasks 的前置条件或完成检查。
- `不适用`：记录具体不命中的适用条件和源码/设计证据；不能只写“不适用”。
- `冲突`：停止下游规划或实施，请求人工裁决；不得自行降级为 preferred。
- `例外`：只有明确批准后才能记录批准依据和替代措施。

preferred 规则适用时记录落地方式或偏离原因；reference-only 只作参考。

## 阶段门禁

- Propose：所有 required 尚未分类前，不得完成 design/tasks/comate。
- Apply：重新读取当前规则和 design 审计；发现遗漏、适用性变化或 required 偏离时，不修改代码，返回
  Propose 更新 design/tasks。
- Handoff：记录适用 required 的 Rule ID 与验证证据，并记录本次发生变化的不适用判断。

项目规则不得覆盖系统安全、用户明确决定或官方 OpenSpec 状态。安装、更新、SessionStart 和普通功能
任务不得创建、覆盖或删除项目规则。
