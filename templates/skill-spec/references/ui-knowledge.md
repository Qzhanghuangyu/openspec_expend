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
