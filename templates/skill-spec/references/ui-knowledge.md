# UI Knowledge

## 何时读取

查找当前项目已有组件、页面模式或落实复用实现时读取；设计节点与工程素材见 `design-tools.md`。

## 项目隔离与事实源

- 每次查询绑定当前项目根，禁止读取、召回、合并或复制其他项目的知识。
- Markdown 是唯一知识事实源；`.falla/ui-knowledge/.index/` 和 `.codegraph/` 是可重建本地缓存，不得提交。
- 保密底线遵循 Soul；知识条目只留必要证据，不记录绝对路径、整页源码或 CodeGraph 全量输出。

## 候选校验

先执行 `falla-openspec ui-knowledge validate --json`，再通过 RAG/Markdown 检索候选；用 CodeGraph 核对
当前源码、调用链、影响面和测试，以及需求行为、平台/依赖、主题/API、资源可见性与生命周期边界。
同时检查 `last-verified`、`source-hashes` 和 reviewer；`direct-reuse-candidate` 标签不能代替上述核对。

| 候选情况 | 处理 |
| --- | --- |
| 结构或指纹校验失败、硬条件不满足 | `rejected`，记录阻断条件 |
| 证据过期（`stale-evidence`） | `rejected`，修复指纹并重新验证前不得引用 |
| 通过校验的 draft | 仅 `reference-only` |
| verified 且经当前源码核对可直接接入 | `direct-reuse`，进入复用决策 |
| 只能参考思路、不能直接接入 | `reference-only`，说明限制；不得覆盖前述拒绝条件 |

## 复用决策

- 唯一合格的 `direct-reuse` 候选必须复用；无合格候选时记录结论与缺口，不强行复用。
- 用户明确指定的组件满足硬条件时必须使用；不满足则记录冲突并暂停相关规划。
- 多个合格候选由 Agent 记录理由并选择，不默认请求人工裁决。仅取舍影响交互或维护时，可按需求匹配、
  集成与生命周期风险、可访问性/适配、维护成本四项评 0/1/2（不符/部分/符合）。分数辅助讨论，硬条件优先；
  不设总分门槛，默认不对每个控件打分，也不因评分修改知识库。

## 绑定 design 与 tasks

选定复用后，在父 design 的“已确认实现基线”记录 `required`、当前需求、具体类/API、接入与生命周期条件、
对应 task/子 change；tasks 将实际接入与验证写为完成条件。候选校验结果不自动成为实现约束：仅召回或
`reference-only` 不产生 required，`rejected` 不得作为实现依据；其他参考按用途标记 `preferred` 或 `reference-only`。
Apply 核对实际接入；条件变化或无法接入时返回 Propose 修订，不得静默替换实现。

## 知识库维护

普通功能任务不补库；仅用户明确授权或 tasks 明确要求时写入 draft，验证并经 reviewer 确认后才能标记 verified。
