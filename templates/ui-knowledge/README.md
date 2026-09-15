# 项目 UI 知识库 V1

本目录是**当前项目独立维护**的 UI 组件与页面模式知识库。FallaOpenSpec 只提供通用协议、配置示例、
条目模板和工作流约束，不拥有、不生成、也不内置任何业务项目的具体知识条目。

## 1. 核心边界

1. 每个项目的知识库、CodeGraph 图谱和未来的 RAG 派生索引完全独立。
2. 任何查询都必须绑定当前项目根目录，默认禁止读取、召回、合并或复制其他项目的条目。
3. Markdown 是知识事实源；向量、全文或其他检索索引都只是可删除、可重建的本地缓存。
4. `.codegraph/` 由 CodeGraph 独立维护；不得向其数据库写入 UI 知识、自定义表或向量。
5. RAG 负责自然语言和模糊召回；CodeGraph 负责源码符号、调用关系、影响面和测试证据验证。
6. CodeGraph 找到源码不等于组件可复用；只有经过当前项目验证的条目才能标记为 `verified`。
7. 安装、更新、SessionStart 和普通功能任务不得扫描全仓、自动生成条目或自动建立项目知识事实。
8. 只有用户明确授权维护知识库，或当前 change/tasks 明确包含知识沉淀时，才允许写入项目条目。

## 2. 目录与所有权

```text
.falla/ui-knowledge/
├── README.md                     # 工作流管理：规则说明
├── schema-v1.md                  # 工作流管理：条目协议
├── config.example.yaml           # 工作流管理：项目配置示例
├── templates/                    # 工作流管理：空白模板
│   ├── component.md
│   └── screen-pattern.md
├── config.yaml                   # 项目管理：需要检索能力时自行创建
├── components/                   # 项目管理：一组件一文件
├── screen-patterns/              # 项目管理：一页面模式一文件
└── .index/                       # 本地派生缓存：不得提交
```

工作流受管文件只有 README、Schema、配置示例和空白模板。`config.yaml`、`components/`、
`screen-patterns/` 以及其中的具体内容由实际项目负责，FallaOpenSpec 更新时不得覆盖。

首次维护时再创建项目目录和文件，不预生成空条目。需要配置时由项目复制：

```bash
cp .falla/ui-knowledge/config.example.yaml .falla/ui-knowledge/config.yaml
```

## 3. 项目隔离

- `project-root` 是所有知识检索和 CodeGraph 查询的强制边界。
- 条目只允许使用当前项目相对路径和当前项目符号，不记录绝对用户路径。
- 项目 A 的 `components/*.md` 不得被项目 B 自动读取，即使两个项目存在同名组件。
- V1 不提供组织级共享库或跨项目联邦检索；未来若增加共享模式，必须与项目实现条目分层存储，
  且共享模式重新绑定当前项目源码后才能成为 `verified` 项目事实。
- 不允许使用一个公共向量索引混合多个项目；每个项目的 `.index/` 独立生成和失效。

## 4. CodeGraph 与 RAG 的协作协议

推荐检索链路：

```text
当前项目自然语言查询
  → 项目本地 RAG/有界 Markdown 检索召回候选
  → 使用条目 codegraph.primary-symbol / related-symbols 查询当前项目 CodeGraph
  → 核对源码、调用方、依赖、影响面和测试
  → 核对 XML、资源、Gradle、Manifest 与实际验证
  → 输出 direct-reuse / reference-only / rejected
```

边界：

- RAG 不索引整个源码，只索引当前项目维护的知识 Markdown。
- CodeGraph 不承担适用场景、视觉意图、不适用条件和人工经验的语义存储。
- CodeGraph 验证失败时，`verified` 条目必须降级为 `draft`、`deprecated` 或 `invalid` 候选，
  不能继续作为直接复用建议。
- XML、Drawable、主题、Manifest、Gradle 和资源可见性仍需读取当前项目文件或执行有界文本搜索。
- 不把 CodeGraph 全量输出、完整源码或数据库内容写入知识条目或 RAG 索引。

## 5. 状态与复用规则

| status | 含义 | 使用方式 |
| --- | --- | --- |
| `draft` | 尚未完成项目验证 | 只能作为参考候选 |
| `verified` | 已验证源码、依赖、生命周期和适用条件 | 可进入直接复用候选 |
| `deprecated` | 仍可能存在，但不建议新功能继续使用 | 仅用于迁移和历史定位 |
| `invalid` | 路径、符号或结论已失效 | 必须从推荐结果排除 |

直接复用至少满足：

- `status: verified`；
- `codegraph.primary-symbol` 在当前项目仍存在；
- 模块依赖、主题、资源和 public API 仍匹配；
- 生命周期和清理要求已核对；
- `last-verified` 未被当前代码变化证明过期。

## 6. 维护流程

1. 明确本次是知识库维护任务，而不是普通功能开发的隐式副作用。
2. 从当前项目代码、资源、测试和设计节点收集证据。
3. 使用模板创建 `draft` 条目，不复制整页源码或 CodeGraph 全量结果。
4. 用 CodeGraph 验证源码符号、调用方、影响面和相关测试。
5. 用实际构建、测试、截图或人工验收补足图谱无法证明的事实。
6. reviewer 确认后改为 `verified`，并记录 `last-verified` 与 `verified-by`。
7. 代码或设计变化后重新验证；不满足条件时降级，不静默删除历史结论。

## 7. 安全约束

禁止在配置、条目、索引、日志或 handoff 中记录：

- token、cookie、API Key、签名、认证信息或环境变量；
- `local.properties`、`google-services.json` 或其他敏感配置正文；
- 绝对用户目录；
- 完整设计正文、临时资源 URL；
- 大段无关源码、完整页面复制或 CodeGraph 数据库内容。

组件条目必须记录 Context、Activity、Fragment View、Binding、Observer、Callback、Listener、
Handler、Coroutine、Flow、Disposable 等对象的持有与释放边界，避免复用时引入泄漏或生命周期错位。
