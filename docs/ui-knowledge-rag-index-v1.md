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
