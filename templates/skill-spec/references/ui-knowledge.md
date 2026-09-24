# UI Knowledge

## 何时读取

需要查找当前项目已有组件、页面模式或复用方案时读取。

## 事实源与隔离

- 每次查询必须绑定当前项目根，禁止读取、召回、合并或复制其他项目的知识。
- Markdown 是唯一知识事实源；`.falla/ui-knowledge/.index/` 和 `.codegraph/` 都是可重建本地缓存，
  不得提交。
- RAG/Markdown 搜索负责模糊召回；CodeGraph 负责验证当前源码符号、调用链、影响面和测试。
  找到源码不等于组件可以直接复用。

## 使用规则

1. 先执行 `falla-openspec ui-knowledge validate --json`。
2. 只使用通过结构和指纹检查的候选，并核对依赖、资源可见性、主题/API、生命周期、
   `last-verified`、`source-hashes` 和 reviewer。
3. `direct-reuse-candidate` 仍需验证当前源码关系和接入条件。
4. design 引用时标记 `required`、`preferred` 或 `reference-only`；只有当前源码验证后的具体对象才能
   成为 required。
5. 普通功能任务不得顺带补库。只有用户明确授权或 tasks 明确要求时才能写入 draft；验证并经 reviewer
   确认后才能标记 verified。
6. 不记录绝对路径、凭据、完整设计正文、临时资源 URL、整页源码或 CodeGraph 全量输出。
7. 对当前页面实际需要的组件或页面模式检索候选，先作硬条件筛选：需求行为、平台与依赖、
   可用 API、生命周期和资源边界。未满足则 `rejected`；通过校验的 draft 仅 `reference-only`；
   证据过期（`stale-evidence`）按校验结果 `rejected`，修复指纹并重新验证前不得引用。
   分数不能使其成为已验证控件。对可行候选核对当前源码，记下 `direct-reuse` / `reference-only` /
   `rejected`、关键证据及理由；无匹配候选时只记检索结论，不为完成任务强行复用。
8. 默认不对每个控件打分：一个明确可用的候选直接采用并记一句理由；只有两个以上可行方案、
   且取舍影响交互或维护时，才按需求匹配、集成与生命周期风险、可访问性/适配、维护成本四项
   分别评为 0/1/2（不符/部分/符合），记录主要差异和结论。分数辅助讨论，硬条件优先，
   不设自动选择的总分门槛，也不因评分而创建或修改知识库条目。
