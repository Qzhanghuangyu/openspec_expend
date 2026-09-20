# UI Knowledge RAG Index Contract V1

本文件定义 FallaOpenSpec UI 知识 RAG 的命令、派生文件格式和验收边界。Markdown 条目仍是唯一事实源；索引可以删除和重建。

## 命令契约

```text
falla-openspec ui-knowledge index build [--project <path>] [--json]
falla-openspec ui-knowledge index sync [--project <path>] [--json]
falla-openspec ui-knowledge index rebuild [--project <path>] [--json]
falla-openspec ui-knowledge index status [--project <path>] [--json]
falla-openspec ui-knowledge index clear [--project <path>] [--json]
falla-openspec ui-knowledge index query --text <query> [--top-k <1..50>] [--project <path>] [--json]
```

当前阶段只固定契约。有效命令返回 `implemented: false` 和非零退出码，不创建 `.index/`。

## 配置契约

索引器只读取固定项目文件 `.falla/ui-knowledge/config.yaml`。缺失时返回安全的 `unconfigured` 默认值，不创建文件。

```yaml
version: 1
scope: project
knowledge:
  sourceOfTruth: markdown
  componentPaths:
    - .falla/ui-knowledge/components
  screenPatternPaths:
    - .falla/ui-knowledge/screen-patterns
semantic:
  provider: unconfigured # 当前还允许测试专用 fake
  model: unconfigured
  dimensions: null
  indexPath: .falla/ui-knowledge/.index
  topK: 8
retrieval:
  projectOnly: true
  requireVerifiedForDirectReuse: true
  allowDraftAsReference: true
  rejectInvalid: true
```

当前阶段只实现 `unconfigured` 和确定性的 `fake` Provider。配置不允许自定义模块路径、Shell 命令、项目外索引目录或内嵌凭据。

## 索引目录

```text
.falla/ui-knowledge/.index/
├── manifest.json
├── chunks.jsonl
└── vectors.json
```

`.index/` 是项目本地派生缓存，不提交 Git，不作为知识条目或证据文件读取。

## Manifest V1

```json
{
  "formatVersion": 1,
  "knowledgeSchemaVersion": 1,
  "chunkStrategyVersion": 1,
  "embedding": {
    "provider": "unconfigured",
    "model": "unconfigured",
    "dimensions": null
  },
  "documents": {}
}
```

后续实现必须记录每个文档的稳定 `id`、相对路径、内容哈希、状态和 chunk ID。Embedding 模型、维度或分块版本变化时必须全量重建。

## 文档装载与章节分块

索引文档必须先经过现有 `validateKnowledge`。装载器只读取 `reference-only` 或 `direct-reuse-candidate` 条目，并在第二次读取时重新执行 Frontmatter、安全内容和 metadata 校验，避免校验后文件被替换。

每个文档至少生成一个 metadata chunk，并按 Markdown 二级标题生成正文 chunk。代码围栏内的 `##` 不视为章节。标题 ID 使用规范化 ASCII slug；无法生成 slug 的标题使用标题 SHA-256 前 12 位，避免依赖章节顺序。

单 chunk 上限为 48 KiB，单文档最多 64 个 chunk。超大章节按 Markdown 空行块拆分；单个代码块或表格自身超过限制时拒绝索引，不进行破坏结构的硬切分。

## 分块标识

建议稳定格式：

```text
<kind>:<document-id>#<normalized-section>
```

更新文档时先删除该 document ID 的全部旧 chunk，再写入新版本，禁止追加造成新旧内容并存。

## 安全边界

- 复用 `knowledgeProjectRoot`、`listKnowledgeEntries`、`readBoundedFile`、`parseKnowledge` 和 `validateKnowledge`。
- 只索引当前项目 `components/` 与 `screen-patterns/` 顶层 Markdown。
- 拒绝符号链接、越界路径、敏感正文和超预算文件。
- 不索引源码正文、`.git/`、`.codegraph/`、`.index/`、`build/`、`node_modules/` 或凭据文件。
- 远程 Provider 的凭据只允许来自环境变量，不写入 config、manifest、vector 或日志。
- build/rebuild 使用临时目录完成后原子替换，失败不得破坏上一代可用索引。

## 状态语义

- `draft`：可以召回，结果只能是 `reference-only`。
- `verified`：只有结构、指纹和后续 CodeGraph 检查都通过后，才能作为直接复用候选。
- `deprecated`：默认不推荐，只用于迁移和历史定位。
- `invalid`：从活动召回排除。
- RAG 分数只负责排序，不授予复用资格。

## 实施验收标准

### Full build

- 首次构建只处理通过知识校验的条目。
- 每个合法文档只出现一次，chunk ID 不重复。
- 构建失败不留下半成品正式索引。

### Incremental sync

- 新增文档只生成新增文档向量。
- 修改文档只替换该文档全部 chunks。
- 删除文档同步删除 manifest、chunks 和 vectors。
- 无变化重复 sync 时 Embedding 调用次数为 0。
- status 等元数据变化能够触发文档更新。

### Query

- `top-k` 范围为 1..50，默认 8。
- 返回 document ID、kind、status、分数、匹配章节和复用模式。
- 查询结果仍需执行知识校验和 CodeGraph 当前源码验证。

### Rebuild triggers

以下变化必须全量重建：Embedding Provider/模型/维度、索引格式版本、知识 Schema 版本、分块策略版本。

## 当前阶段完成边界

本阶段不实现 Markdown 分块、Embedding、向量持久化、增量同步或查询算法。所有索引动作均明确返回“尚未实现”，并保证不写入目标项目。
