# UI 知识条目 Schema V1

V1 只定义项目本地 Markdown 条目的稳定协议，不定义具体向量模型、数据库或跨项目共享方式。

## 通用 Frontmatter

```yaml
---
schema-version: 1
id: stable-kebab-id
kind: component # component | screen-pattern
scope: project
status: draft # draft | verified | deprecated | invalid
platform: android-view # android-view | compose | flutter | ios | other

aliases: []
intents: []
tags: []

codegraph:
  primary-symbol: ""
  related-symbols: []

source-files: []
layout-resources: []
tests: []

last-verified: null # YYYY-MM-DD
verified-by: "" # human | ai-assisted + reviewer
---
```

## 字段约束

- `schema-version`：必须为整数 `1`。
- `id`：当前项目内唯一、稳定的 kebab-case 标识；不使用类名哈希、个人姓名或绝对路径。
- `kind`：必须与目录一致，`components/` 使用 `component`，`screen-patterns/` 使用 `screen-pattern`。
- `scope`：V1 必须是 `project`，禁止填写其他项目或组织级作用域。
- `status`：只允许 `draft`、`verified`、`deprecated`、`invalid`。
- `aliases`：项目成员常用名称、旧名称和自然语言称呼，用于模糊召回。
- `intents`：组件或页面解决的用户/业务场景，不写实现步骤。
- `tags`：平台、视觉、状态和交互标签；不放凭据或个人信息。
- `codegraph.primary-symbol`：当前项目内最能代表实现入口的完整符号名。
- `codegraph.related-symbols`：状态模型、Adapter、ViewModel、Controller 等关联符号。
- `source-files`、`layout-resources`、`tests`：只能使用当前项目相对路径。
- `last-verified`：最近一次结合当前源码和验证证据核对的日期。
- `verified-by`：`verified` 必须有 reviewer；AI 单独生成不能直接成为 verified。

## RAG 分块边界

建议将每个 Markdown 条目作为独立文档，并按以下区块分块：

1. frontmatter 元数据；
2. 适用与不适用场景；
3. 依赖与接入条件；
4. 状态、交互和生命周期；
5. 风险、限制和验证证据。

不得将整个源码文件、CodeGraph 全量输出或其他项目条目拼接成知识块。

## CodeGraph 连接边界

- RAG 先通过 `aliases`、`intents`、`tags` 和正文召回候选。
- CodeGraph 再通过 `primary-symbol`、`related-symbols` 和 `source-files` 验证候选。
- 符号不存在、路径失效或调用关系发生冲突时，结果必须携带 stale 原因并禁止 direct reuse。
- CodeGraph 结果只作为当前源码证据，不能自动修改条目状态。
