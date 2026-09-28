# UI Knowledge

## 何时读取

需要查找当前项目已有组件、页面模式或复用方案时读取。

## 事实源与隔离

- 每次查询必须绑定当前项目根，禁止读取、召回、合并或复制其他项目的知识。
- Markdown 是唯一知识事实源；`.falla/ui-knowledge/.index/` 和 `.codegraph/` 都是可重建本地缓存，
  不得提交。
- RAG/Markdown 搜索召回候选；CodeGraph 验证当前源码、调用链、影响面和测试。
  命中源码不等于可直接复用。

## 使用规则

1. 先执行 `falla-openspec ui-knowledge validate --json`。
2. 只使用通过结构和指纹检查的候选，并核对依赖、资源可见性、主题/API、生命周期、
   `last-verified`、`source-hashes` 和 reviewer。
3. `direct-reuse-candidate` 仍需验证源码关系与接入条件。
4. design 引用时标记 `required`、`preferred` 或 `reference-only`；只有当前源码验证后的具体对象才能
   成为 required。
5. 普通功能任务不补库。只有用户明确授权或 tasks 明确要求时才能写入 draft；验证并经 reviewer
   确认后才能标记 verified。
6. 不记录绝对路径、凭据、完整设计正文、临时资源 URL、整页源码或 CodeGraph 全量输出。
7. 对当前页面所需组件或模式检索候选，先筛需求行为、平台与依赖、
   可用 API、生命周期和资源边界。未满足则 `rejected`；通过校验的 draft 仅 `reference-only`；
   证据过期（`stale-evidence`）按校验结果 `rejected`，修复指纹并重新验证前不得引用。
   分数不能替代验证。对可行候选核对源码，记录 `direct-reuse` / `reference-only` /
   `rejected`、证据及理由；无匹配时记录结论，不强行复用。
8. 召回不等于选定：对当前需求筛选后，唯一满足硬条件、且经当前源码核对可直接接入的
   `direct-reuse` 候选必须决定复用，不得无理由改为自建或忽略；没有合格候选则记录具体未满足的
   条件，不强行复用。用户明确指定使用某组件时，条件满足就必须使用；不满足则记录冲突并暂停
   相关规划，不得静默替换。两个以上合格候选由 Agent 记录理由并选择；仅取舍影响交互或维护时，
   才按需求匹配、集成与生命周期风险、可访问性/适配、维护成本四项分别评为 0/1/2
   （不符/部分/符合）；不默认请求人工裁决。默认不对每个控件打分；分数辅助讨论，硬条件优先，
   不设总分门槛，也不因评分创建或修改知识库条目。
9. 选定复用后，在父 design 的“已确认实现基线”写对应 `required` 约束：当前需求、具体类/API、
   接入和生命周期条件、对应 task/子 change；tasks 将实际接入与验证写为完成条件。仅被召回、
   `reference-only` 或 `rejected` 的候选不自动成为 required。实施时条件变化须返回 Propose
   修订，不得静默改用其他实现。
