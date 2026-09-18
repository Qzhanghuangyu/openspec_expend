# UI 组件知识库 V1 架构与边界

更新时间：2026-09-15

## 1. 定位

FallaOpenSpec 仅面向多个相互独立的 Android 客户端项目，支持 Android View 与 Jetpack Compose。
工作流仓库提供 UI 知识库的基础架构及只读校验工具：

- 统一目录约定；
- Markdown Schema V1；
- 配置示例；
- CodeGraph 与 RAG 的连接字段；
- 检索、验证、写回、安全和生命周期规则。

工作流仓库不保存任何具体项目的组件、页面、类名、资源、统计结果或向量索引。每个实际项目
独立创建和维护自己的知识 Markdown。

## 2. 每个项目独立的数据面

```text
<project>/
├── .codegraph/                         # 当前项目源码图谱，本地派生
└── .falla/ui-knowledge/
    ├── README.md                       # 工作流受管规则
    ├── schema-v1.md                    # 工作流受管协议
    ├── config.example.yaml             # 工作流受管示例
    ├── templates/                      # 工作流受管空白模板
    ├── config.yaml                     # 项目自有配置，可选
    ├── components/*.md                 # 项目自有知识
    ├── screen-patterns/*.md            # 项目自有知识
    └── .index/                         # 当前项目本地 RAG 派生缓存
```

隔离规则：

1. 所有检索必须显式绑定当前 `projectRoot`。
2. 默认禁止从另一个项目读取、召回、合并或复制具体条目。
3. 不建立混合多个项目的公共向量索引或 CodeGraph 数据库。
4. 条目只能引用当前项目的相对路径、源码符号、资源和测试。
5. V1 不提供跨项目共享知识库；后续若增加组织级模式库，必须与项目实现事实分层，并在当前项目
   重新绑定和验证后才能成为 `verified`。

## 3. 工作流与项目的所有权

### FallaOpenSpec 负责

```text
.falla/ui-knowledge/README.md
.falla/ui-knowledge/schema-v1.md
.falla/ui-knowledge/config.example.yaml
.falla/ui-knowledge/templates/component.md
.falla/ui-knowledge/templates/screen-pattern.md
```

这些文件是受管基础设施，项目不应直接修改；需要调整规则时修改 FallaOpenSpec 后重新安装。

### 实际项目负责

```text
.falla/ui-knowledge/config.yaml
.falla/ui-knowledge/components/*.md
.falla/ui-knowledge/screen-patterns/*.md
```

实际项目决定：

- 记录哪些组件和页面模式；
- aliases、intents 和 tags；
- CodeGraph 源码符号绑定；
- 适用、不适用和复用条件；
- 生命周期、风险和验证证据；
- draft/verified/deprecated/invalid 状态。

安装器不得覆盖这些项目自有文件。

## 4. Markdown 与派生索引

Markdown 是唯一知识事实源，必须提交到项目版本库。未来的向量索引、全文索引、embedding 缓存和
CodeGraph 图谱都属于本地派生数据，可以随时删除并从当前项目重建，不能成为事实源。

```text
提交：README、Schema、配置、components/*.md、screen-patterns/*.md
忽略：.codegraph/、.falla/ui-knowledge/.index/
```

`.index/` 不得包含其他项目的 chunk、向量或路径，也不得上传凭据、完整源码或设计正文。

## 5. CodeGraph 与 RAG 的职责

| 能力 | 责任方 |
| --- | --- |
| 自然语言、别名、意图和场景的模糊召回 | 项目本地 RAG |
| 类、函数、调用链、继承、影响面和相关测试 | 当前项目 CodeGraph |
| XML、Gradle、Manifest、主题和资源 | 当前项目文件 + 有界文本搜索 |
| 当前视觉事实 | 用户明确提供节点后的 Figma MCP |
| 适用条件、复用经验、人工验证和风险 | 当前项目 UI Markdown |

推荐执行顺序：

```text
RAG/有界 Markdown 搜索召回候选
→ CodeGraph 根据 primary-symbol / related-symbols 验证
→ 当前文件、资源、测试和设计节点补充核对
→ 根据 status 与证据决定 direct-reuse / reference-only / rejected
```

禁止：

- 把 UI 知识或自定义向量写入 `.codegraph/codegraph.db`；
- 把 CodeGraph 查询到的源码自动标记为可复用组件；
- 把 CodeGraph 全量输出或完整源码复制进知识条目；
- 因 CodeGraph 没有结果就断言项目没有相关 UI 能力。

## 6. 条目协议

组件和页面模式统一遵循 `.falla/ui-knowledge/schema-v1.md`。关键字段包括：

```text
schema-version / id / kind / scope / status / platform
aliases / intents / tags
codegraph.primary-symbol / codegraph.related-symbols
source-files / layout-resources / tests
last-verified / verified-by / source-hashes
```

`scope` 在 V1 必须是 `project`。`verified` 必须同时具备当前源码证据、依赖/资源检查、生命周期结论
和 reviewer；AI 生成草稿只能是 `draft`。

`ui-knowledge validate --json` 校验结构、Android 平台、项目边界和证据指纹；
`ui-knowledge fingerprint <条目相对路径> --json` 只读生成引用文件指纹。两者都不自动维护条目，
也不将校验结果当作人工验证。校验器的文件预算、历史条目与错误处理见安装后的 schema-v1.md。
旧 verified 条目没有 source-hashes 时需要项目维护者重新验证并补齐。

## 7. 工作流阶段规则

### 安装与更新

只安装基础设施，不创建 `config.yaml`、组件条目、页面条目或 `.index/`。

### Preflight

只在当前项目内召回和验证已有条目；未命中仍需查询当前代码。不得写入或补全知识库。

### Propose

候选条目通过当前 CodeGraph 和项目文件验证后，才能作为复用依据写入 design/tasks。不得自动沉淀。

### Apply

实施前再次验证源码符号、依赖、资源和生命周期，避免规划到实施之间的代码变化导致错误复用。

### Archive / 专门维护任务

只有用户明确授权或 tasks 明确包含知识沉淀时，才能创建/更新项目条目。先写 `draft`，完成测试或
人工验证并经 reviewer 确认后才能改为 `verified`。

## 8. 安全和生命周期

禁止记录 token、cookie、API Key、签名、环境变量、绝对用户路径、完整设计正文、临时资源 URL、
大段源码或 CodeGraph 数据库内容。

涉及 Context、Activity、Fragment View、Binding、Observer、Callback、Listener、Handler、
Coroutine、Flow、Disposable 时，条目必须记录持有者、创建时机、取消/释放时机和页面销毁后的行为。

## 9. V1 不包含的能力

- RAG 引擎或 embedding 模型实现；
- 自动全仓扫描和组件发现；
- 自动生成具体项目 Markdown；
- 跨项目检索、合并和推荐；
- 自动将条目标记为 verified；
- 直接修改 CodeGraph 内部数据库。

这些能力必须在协议稳定后作为后续 change 单独设计和验证。
