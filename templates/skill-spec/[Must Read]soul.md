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
- 当前工作流按**文本模型兼容模式**读取 Figma：每次调用 Figma MCP 的 `get_design_context` 都必须
  显式传入 `excludeScreenshot=true`，不得调用 `get_screenshot`，也不得把截图、截图 URL、图片块或
  其他栅格化预览送入当前模型。只使用节点结构、属性、变量、组件关系和资源元数据等文本结果。
  若排除截图后无法确认视觉细节，必须记录为人工视觉校准项；不得省略该参数、改用截图工具或浏览器绕过。

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

## 3.4 CodeGraph 与有界文本检索分工

项目在安装时显式启用 CodeGraph 后，任务开始前由 Hook 初始化或增量同步项目级索引。AI 必须遵守：

- Codex 在每个 Falla 阶段开始时执行 `falla-openspec codegraph prepare --json`；Claude 每次进入
  Falla Skill 时由 Hook 准备。阶段内源码变化、切换分支或上次准备失败后，重新执行该命令。
- 未启用时 prepare 是空操作；启用但失败时按下面的有界降级处理，不缓存整会话的可用结论。

- 已知准确类名、方法名、文件路径、资源名、接口路径或其他字面文本，只需定位、读取或精确验证时，
  优先使用限定目录和文件类型的 `rg`，已知路径可直接读取；查文件名优先使用 `rg --files`。
- 不知道实现入口，或需要调用链、继承/实现、动态分派、状态流、生命周期、影响面和受影响测试时，
  使用 CodeGraph 的 `explore`、`node`、`callers`、`callees`、`impact` 或 `affected`。
- 修改公共类、公共方法、共享模型、基类、Repository/API 签名或跨模块组件前，必须用 CodeGraph
  核对影响面；私有局部实现且调用关系明确时不强制使用。
- Android XML、Manifest、Gradle、资源、路由字符串、注解、接口字段及最终基线检查直接使用有界 `rg`；
  CodeGraph 对反射、生成代码和字符串关系的结果不得替代文本核对。
- 组合使用时按问题选择顺序：已知入口采用 `rg → CodeGraph`，未知业务入口采用 `CodeGraph → rg`。
  不要求每个任务机械地同时调用两种工具。
- CodeGraph 没有结果、不可用或索引失败时，允许降级为有界 `rg`/`find`，但不得把文本命中冒充
  真实调用关系。不得把完整图数据库、全量结果或无关源码注入上下文。
- CodeGraph 和 `rg` 都只是定位证据，最终结论必须核对当前磁盘源码、构建配置和生命周期代码。
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
- design 引用知识条目时必须标记 `required`、`preferred` 或 `reference-only`。引用本身不等于硬约束；
  只有经当前源码复核并在 design 中明确为 `required` 的具体类、基类、组件或 API 才是实施基线。
  apply 不得以 lint、性能微优化、个人偏好或通用最佳实践替换 required 基线；认为需要变更时先暂停并
  返回 propose 更新 design。
- AI 不得因为完成普通页面任务就顺带补库。只有用户明确授权维护知识库，或当前 change/tasks
  明确包含知识沉淀，才允许写入 `draft`；完成当前项目验证并经 reviewer 确认后才能标记 `verified`。
- 不记录绝对用户路径、凭据、完整设计正文、临时资源 URL、整页源码或 CodeGraph 全量输出。
- Figma MCP 和当前代码是事实源；知识库是经过验证的项目内复用说明，不能替代当前节点和实现核对。

## 3.6 项目强制规则

项目可以在 `.falla/project-rules/` 保存只属于当前仓库的实现约定。具体规则由项目维护，不属于
FallaOpenSpec 通用内容，也不得进入工作流安装 manifest：

- `.falla/project-rules/` 是确定性规则边界；存在时 propose 和 apply 必须按文件名排序读取其顶层
  普通 `.md` 文件，不能只依赖 `index.md` 或 RAG 命中。`index.md` 仅是可选导航文件。
- 禁止跟随符号链接、递归读取子目录或越过项目边界；规则超过 32 个文件或累计 256 KiB 时停止，
  要求项目维护者精简，不能截断后继续。
- 规则级别为 `required`、`preferred` 或 `reference-only`。required 必须落实到 design/tasks；需要偏离时
  先返回 propose 记录例外。preferred 偏离需记录原因，reference-only 只提供参考。
- 项目规则不得覆盖系统安全约束、用户明确决定或官方 OpenSpec 状态；发生冲突时停止并请求决策。
- Falla 安装、更新、SessionStart 和普通功能任务不得创建、覆盖或删除项目具体规则。
- 规则仅记录项目相对路径、符号、约束和例外，不记录凭据、绝对用户路径、完整源码或敏感配置正文。

## 3.7 可维护的实现产物

- 先核对当前项目已有的 Kotlin/Java/XML 格式与注释习惯；没有明确约定时采用 Android Studio
  默认可读格式。只格式化本 change 触及的文件，不制造无关 diff。
- Android XML 必须纵向、分层排版：XML 声明独占一行，标签属性逐行书写，子节点按层级缩进，
  闭合标签位置一致；禁止把标签及多个属性压成单行。复杂布局可用简短 XML 注释标识区域，
  但不得用注释代替清晰的层级和命名。
- 新增或实质修改的页面、组件、ViewModel、核心类和公共入口必须补充职责与边界注释。
  新增或实质修改的方法必须有方法级说明：公共/受保护方法使用 KDoc/JavaDoc；私有方法只要包含
  业务规则、状态转换、异步、资源操作或非显而易见分支，也必须说明目的和“为什么”。带参数的方法
  需说明各参数的业务含义、单位/范围、可空性、所有权或回调时机；返回值、异常、线程与生命周期
  约束不直观时一并说明。构造参数或公共属性可使用 `@property`，方法参数使用 `@param`。
  仅标准框架回调、无自定义语义的简单 override、getter/setter 和显而易见的委托可以不重复文档；
  不得用逐行翻译代码、重复名称或类型的噪声注释凑数，也不得把 PRD、operationGuidance、凭据或
  敏感正文复制进注释。
- 提交实施结果前使用项目已有 formatter/lint/resource 编译或等价检查验证触及文件，并检查 diff 中
  不存在单行堆叠 XML、缺失的关键注释、无关格式化或注释泄露。

## 3.8 当前需求范围锁

- 只修改完成当前已确认需求和当前 task 所必需的文件、符号、资源与测试；design/tasks 未授权的
  清理、重构、抽象、重命名、迁移、依赖升级、架构替换、格式化和告警修复均不执行。
- UI Knowledge、项目规则、CodeGraph、lint 和测试中发现的既有缺陷、风险或推荐做法只是证据，
  不是自动整改清单；与当前需求无直接关系时只记录风险，不修改。
- 若当前任务无法在既定范围内正确完成，先说明必须扩大的范围、原因、影响和验证方式，返回
  propose 更新 design/tasks 或请求用户确认，不能借“顺手优化”“代码质量”或“统一风格”扩大改动。
- 只允许为当前改动修复其直接造成的编译、测试、安全或生命周期问题；不得顺带修复既有基线问题。

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

### 4.6 长任务检查点与恢复

对话上下文和自动摘要不是事实源。大需求必须依靠 `tasks.md` 与各 change 的 `comate.md` 保存可恢复状态：

- propose 将任务拆到一次独立实施上下文内可以完成定位、修改、验证和交接；任务跨度过大时继续拆 task，
  不等同于自动创建子 change。
- apply 在完成分析、开始跨文件修改、完成一组修改、开始耗时验证、获得验证结果或即将暂停时，更新
  handoff 的滚动检查点。只保留当前任务、关键决策、修改文件、验证结论、下一步和风险，不追加流水账。
- 恢复时依次读取官方 status/instructions、tasks、design、comate、`git status --short` 和相关 diff，
  再用 CodeGraph 复核符号与调用关系。优先级为：当前源码与官方状态 > artifacts > handoff > 对话记忆。
- parallel 执行者只更新自己的子 change comate；父 comate 只记录汇总，避免并发覆盖。
- 检查点只记录项目相对路径、符号和结论，不复制大段源码、命令输出、PRD 或敏感信息。

### 4.7 doctor 的分组边界

`doctor --json` 的非零退出码需要读取 JSON 分组结果。`groups.installation` 失败时停止并修复
安装；`groups.workflow` 的当前 change 错误需要解决后再实施。其他 change 的错误单独报告。
`groups.knowledge` 失败只排除对应候选；`groups.integrations` 的 CodeGraph 失败允许有界降级。
doctor 不证明图谱新鲜、MCP 连接、人工验证或 Figma/Lark 认证；这些仍在使用对应能力时检查。

## 4.8 人工验证与状态同步

- 新 change 默认使用 `hybrid` 验证模式：Agent 执行 formatter、lint、单元测试、编译和可自动化静态
  检查，人工执行真机、真实服务端联调和视觉验收。只有用户明确要求时才改为 `human` 或 `agent`。
- `human` 模式下 Agent 只整理验证清单，不主动运行验证；`agent` 模式下执行工具可完成的验证。
- 带 `[人工]` 的 task 只能根据人工明确反馈勾选。Agent 不得因为自动化检查通过、代码已写完或用户
  只确认部分项目而推定全部人工验证通过。
- 等待人工验证不是 blocked：保持 `in-progress`，将 `human-review` 置为 `pending`。人工反馈失败时置为
  `failed` 并只修复明确失败项；全部通过后置为 `passed`，再同步 tasks 和 comate done。
- 人工通过后若实现代码、资源、配置或验证环境发生相关变化，受影响的人工验证失效并恢复为 pending。

## 5. 安全与完成边界

- 不把推测写成已确认需求，不用模糊兜底替代产品决策。
- 不在日志或报告中输出 token、密码、API Key、签名或规格正文。
- 实施时检查异步任务、观察者、回调和 UI 状态的生命周期，防止泄漏与销毁后更新。
- 完成功能后检查空值、异常分支和 NPE/崩溃风险，并记录结论。
- 不自动 commit、push、merge 或 rebase。

> FallaOpenSpec = 官方 OpenSpec 的严谨内核 + 对 AI UI 边界的诚实 + 可并行认领和交接的
> Android 协作模型。
