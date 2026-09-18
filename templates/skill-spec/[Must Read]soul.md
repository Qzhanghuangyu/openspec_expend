# FallaOpenSpec 的灵魂（Soul）

> 本文是 FallaOpenSpec 的全局决策入口。当 Schema、Skill、Hook 或 CLI 行为与本文冲突时，
> 应修正实现，而不是绕过本文约束。

## 0. 读取规则

为避免 agent 每次全量读取规则，`.falla/skill-spec/` 使用前缀标明读取阶段：

| 前缀 | 何时读取 |
| --- | --- |
| `[Must Read]` | 任何 Falla 工作流开始前 |
| `[分析必读]` | PRD 分析与 preflight |
| `[架构必读]` | propose、规划和任务拆解 |
| `[模块选读]` | apply 某个父/子 change |
| `[任务选读]` | archive 等特定环节 |

先读本文判断阶段，再读取对应阶段文档。缺少必读文件时停止，不得声称规则已加载。

## 1. 定位

FallaOpenSpec 是建立在官方 OpenSpec 之上的 Android 客户端任务拆解与 SDD 扩展，
只用于 Android 项目，支持 Android View 与 Jetpack Compose。
OpenSpec 是唯一工作流内核，负责 change、Schema、artifact DAG、status、instructions、
validate、spec 同步和 archive。Falla 不复制这些实现，只补充 Android 决策规则与团队协作。

标准链路为：

`preflight → proposal → specs → design → tasks → comate → apply → archive`

所有业务规格和 change 位于 `openspec/`；`.falla/skill-spec/` 只保存工作流规则。

## 2. 两个核心问题

1. **UI 还原边界**：Figma 到 Android 的人工视觉校准涉及手感、字体、动效、机型
   适配和设计隐性意图，不能假装可由 AI 稳定完成。
2. **团队协作**：单一 change 不足以表达多人、多 agent 的认领、依赖、阻塞和交接。

## 3. 核心信条

### 3.1 AI 搭框架，人类做最终校准

- AI 负责可验证的布局结构、控件层级、可复用组件、主题基础样式、数据绑定和交互实现。
- 验收按明确的自动验证项与人工校准项判断，不以固定完成百分比代替功能交付标准。
- AI 不反复追求无法客观验证的 100% 像素对齐。
- design 和 comate 必须明确记录留给工程师/设计师校准的视觉项。

### 3.2 为团队并行交付而拆解

拆解第一目标是让工作可独立认领、验证和交接，而不是让一个 agent 从头做到尾。

### 3.3 设计稿链接必须走对应的 MCP

此门禁适用于 preflight、propose、apply、archive 以及任意中间阶段：

- PRD 正文中内嵌或引用的设计稿链接不读取、不自动跟随，也不把它当作当前实现目标；PRD
  通常没有携带用户在设计工具中选中的准确 node id，不能据此猜测页面或节点。
- 只有用户在当前对话中另行手动提供、并明确用于当前任务的 Figma 链接，才触发设计读取。
  链接必须包含明确的 node id；缺少 node id 时请求用户重新选择目标节点并复制链接，不读取
  整个文件或自行挑选节点。
- 对符合上述条件的 Figma 链接，必须使用 Figma MCP 读取链接指向的节点；不得使用浏览器、
  Chrome、WebFetch、`curl`、网页截图或 DOM 抓取来查看或替代解析。
- 先读取链接中明确指定的 node；需要理解上下文时，再通过 Figma MCP 补充相邻节点、设计
  context、变量、组件和可用资源。不得仅凭链接文本、PRD 描述或历史截图推断设计内容。
- 浏览器不是 Figma MCP 的降级方案。Figma MCP 未安装、未认证、无权限、链接失效或返回内容
  不完整时，停止依赖该设计稿的分析、规划或实施，明确报告阻断原因和所需操作；不绕过门禁。
- 其他设计平台链接同样优先使用该平台的专用 MCP 或语义化连接器；只有用户明确提供的是普通
  网页参考而非设计源文件时，才可按普通网页处理。
- MCP 返回的临时资源 URL、认证信息、cookie、token 和完整设计正文不得写入日志、artifact 或
  handoff。artifact 只记录支撑决策所需的设计节点、结论和仍待确认项。
- 设计在阶段间可能更新。后续阶段若继续依赖该链接，必须通过 MCP 核对当前节点，避免沿用过期
  截图或缓存造成实现与设计生命周期不一致。

## 3.4 CodeGraph 优先的代码定位

项目在安装时显式启用 CodeGraph 后，任务开始前由 Hook 初始化或增量同步项目级索引。AI 必须遵守：

- Codex 在每个 Falla 阶段开始时执行 `falla-openspec codegraph prepare --json`；Claude 每次进入
  Falla Skill 时由 Hook 准备。阶段内源码变化、切换分支或上次准备失败后，重新执行该命令。
- 未启用时 prepare 是空操作；启用但失败时按下面的有界降级处理，不缓存整会话的可用结论。

- 定位类、函数、调用链、影响面和受影响测试时，优先使用 CodeGraph 的 `explore`、`node`、
  `callers`、`callees`、`impact` 或 `affected`，再只读取命中的必要文件。
- Android XML、Manifest、Gradle、资源名、配置及精确文本查询可以直接使用有界 `rg`；
  CodeGraph 没有结果、不可用或索引失败时，也允许降级为有界 `rg`/`find`。
- 不得把完整 CodeGraph 数据库、全量图谱结果或无关源码注入上下文；查询输出必须围绕当前任务，
  并控制节点数、调用深度和文本预算。
- CodeGraph 只是导航和影响分析证据，不能替代对最终命中文件、构建配置及生命周期代码的核对。
- 禁止索引或输出凭据、签名文件、`local.properties`、环境变量、`google-services.json` 和构建产物。

## 3.5 项目独立维护的 UI 组件知识库

FallaOpenSpec 面向多个相互独立的项目，只提供 `.falla/ui-knowledge/` 的基础架构、Schema、配置示例、
空白模板和使用规则，不保存或生成任何具体项目的组件与页面知识。

- 每次检索必须绑定当前项目根。项目的 Markdown、RAG 派生索引和 `.codegraph/` 都只能服务当前
  项目；禁止自动读取、召回、合并或复制其他项目的具体条目。
- Markdown 是唯一知识事实源；`.falla/ui-knowledge/.index/` 与 `.codegraph/` 都是本地可重建缓存，
  不得提交，也不得向 CodeGraph 数据库写入 UI 知识或自定义向量。
- RAG/有界 Markdown 搜索负责 aliases、intents、tags 和场景的模糊召回；CodeGraph 只负责验证
  当前项目源码符号、调用链、影响面和测试。图谱找到源码不等于组件已经可复用。
- `config.yaml`、`components/` 与 `screen-patterns/` 由实际项目的工程师、设计师，或经用户明确
  授权的 AI 创建和维护；工作流安装、更新、SessionStart 和普通任务不得自动生成。
- 复用前必须核对 `schema-version`、`scope: project`、状态、相对源码证据、模块依赖、资源可见性、
  主题/API、生命周期、`last-verified`、`source-hashes` 和 reviewer。
- 先执行 `falla-openspec ui-knowledge validate --json`，从通过检查的条目中召回候选。结构或指纹
  失败的条目不得直接复用；其他有效条目仍可使用，不因无关坏条目阻断功能任务。
- `direct-reuse-candidate` 仅代表结构与文件指纹通过，仍须验证当前源码关系和实际接入条件。
  普通查询只报告 stale，不修改知识 status；过期条目由获授权的维护任务重新验证。
- AI 不得因为完成普通页面任务就顺带补库。只有用户明确授权维护知识库，或当前 change/tasks
  明确包含知识沉淀，才允许写入 `draft`；完成当前项目验证并经 reviewer 确认后才能标记 `verified`。
- 不记录绝对用户路径、凭据、完整设计正文、临时资源 URL、整页源码或 CodeGraph 全量输出。
- Figma MCP 和当前代码是事实源；知识库是经过验证的项目内复用说明，不能替代当前节点和实现核对。

## 4. 拆解方法

### 4.1 MVVM 第一刀

页面级 change 首先拆为：

1. ViewModel：状态、事件、数据流、业务逻辑和数据层交互。
2. View：布局、控件、样式和交互框架。

先明确两者契约，再允许并行实现，防止状态和生命周期不一致。

### 4.2 UI 按模块控件继续拆解

顶部栏、列表项、底部栏、空状态、弹窗等应成为边界清晰、可独立开发和认领的任务；
页面组装与联调在这些组件之后收敛。

### 4.3 用 DAG 表达依赖

- 每项任务和子 change 显式声明前置依赖。
- 无未完成依赖者才可开始。
- 独立任务并行，有依赖任务按拓扑顺序推进。
- 典型顺序：ViewModel 数据契约 → 控件并行 → 页面组装 → 联调。

### 4.4 默认单 change，按需启用并行子 change

任务拆解与 change 拆解是两件事。proposal、specs、design、tasks 默认都保存在同一个父 change
中；ViewModel、View、控件、组装和联调通常只是 `tasks.md` 内的任务组，不能仅因分层或任务较多
就自动创建子 change。

执行模式只有两种：

- `single`（默认）：由一个 change 跟踪全部任务，apply 直接实施父 change。
- `parallel`（显式启用）：只有用户明确要求多人/多 agent 并行、创建子 change 或独立分派时，
  propose 才创建子 change。AI 可以建议一次，但未得到明确确认时仍必须使用 single；不得根据
  复杂度、分层或潜在并行性自行升级。

parallel 模式下，子 change 必须在 propose 阶段一次性创建，apply 只实施已有子 change，不能再次
拆分。业务 `specs/` 只描述用户可观察、可测试的行为，不能用 View、ViewModel、控件或接口层等
实现模块冒充能力。

标准 OpenSpec 不支持嵌套 change，因此仅在 parallel 模式下：

- 逻辑引用保持 `<parent>/<child>`。
- 物理 change 位于 `openspec/changes/<parent>-child-<child>/`。
- `.falla/coordination.yaml` 是逻辑名到物理名的唯一映射源。
- Skill 通过 `falla-openspec coordination` 解析映射，change 内部状态始终来自官方 OpenSpec。

### 4.5 comate.md 是协作事实

每个父、子 change 都维护 `comate.md`，记录：

- owner；
- todo / in-progress / blocked / done；
- depends-on / blocks；
- handoff。

依赖边必须双向一致且无环。owner、状态和依赖不复制到协调索引，避免双重事实来源。

single 与 parallel 均用 `falla-openspec coordination claim "<change>" --owner "<id>" --json`
认领；parallel 使用逻辑子 change 名。使用已约定的当前工程师或 Agent 标识，不自行替换他人 owner。
不得直接覆写 owner 绕过认领冲突；blocked/done 不通过重复 claim 自动重启。
本地排他锁只覆盖同一真实项目目录，跨机器或不同工作树仍需事先分派文件责任并明确合并策略。

### 4.6 doctor 的分组边界

`doctor --json` 的非零退出码需要读取 JSON 分组结果。`groups.installation` 失败时停止并修复
安装；`groups.workflow` 的当前 change 错误需要解决后再实施。其他 change 的错误单独报告。
`groups.knowledge` 失败只排除对应候选；`groups.integrations` 的 CodeGraph 失败允许有界降级。
doctor 不证明图谱新鲜、MCP 连接、人工验证或 Figma/Lark 认证；这些仍在使用对应能力时检查。

## 5. 安全与完成边界

- 不把推测写成已确认需求，不用模糊兜底替代产品决策。
- 不在日志或报告中输出 token、密码、API Key、签名或规格正文。
- 实施时检查异步任务、观察者、回调和 UI 状态的生命周期，防止泄漏与销毁后更新。
- 完成功能后检查空值、异常分支和 NPE/崩溃风险，并记录结论。
- 不自动 commit、push、merge 或 rebase。

> FallaOpenSpec = 官方 OpenSpec 的严谨内核 + 对 AI UI 边界的诚实 + 可并行认领和交接的
> Android 协作模型。
