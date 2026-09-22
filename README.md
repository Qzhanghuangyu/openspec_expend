# FallaOpenSpec

FallaOpenSpec 是仅用于 Android 客户端项目的官方 OpenSpec 工作流扩展层，支持 Android View 与
Jetpack Compose。官方 `openspec` CLI 是唯一的 change、artifact、
Schema 解析、校验和归档内核；本项目只保留 Falla 特有的规则、父子任务协调、Skill/Hook 安装、
运行时检查与可选工具接入。

## 边界

- 核心命令始终使用官方 `openspec`，本项目不提供 `new change`、`status`、`instructions`、
  `validate` 或 `archive` 的替代实现。
- 不导入 `@fission-ai/openspec/dist` 等内部模块，不复制官方 artifact graph 或 Schema 解析器。
- 工作流只读写标准 `openspec/`，保持单一、干净的工作流事实源。
- 当前支持 OpenSpec `>=1.12.0 <1.13.0`，契约测试固定使用 `1.12.0`。
- 安装不提供 `--force`，遇到用户修改或受管内容漂移会停止。

## 职责与事实源

| 内容 | 唯一事实源 |
| --- | --- |
| artifact 规划和生命周期 | 官方 OpenSpec status / instructions |
| 实施任务及完成进度 | `tasks.md` checkbox |
| 父 change 执行模式 | 父 `comate.md` 的 `execution-mode` |
| 验证模式、人工验收、owner、阻塞与交接 | 当前 change 的 `comate.md` |
| 子 change 正向依赖 | 子 `comate.md` 的 `depends-on` |
| 逻辑名到物理名 | `.falla/coordination.yaml` |

新 `comate.md` 使用 `format-version: 2`。`tasks.md` 不重复保存执行模式或验证模式；`blocks` 由 `depends-on` 反向推导，不再写入新 comate。
Apply 一次只推进一个 ready task；该 task 完成并通过最小验证后立即勾选 checkbox、更新 handoff，再进入
下一项，禁止把多个 task 的状态累计到最后批量更新。Soul 定义跨阶段规则，阶段文档定义阶段决策，
Skill 只编排命令，Schema instruction 只约束对应 artifact，模板只提供结构。

## 初始化与更新

完整操作说明见 [`docs/installation-and-update.md`](docs/installation-and-update.md)，包含首次初始化、
Figma/CodeGraph/Lark 可选集成、源码修改后的目标项目更新、受管文件冲突处理和会话重启要求。安装后同一
手册也会写入目标项目的 `.falla/installation-and-update.md`，无需返回源码仓库即可查阅。

要求 Node.js 20.19 或更高版本。

```bash
npm install -g @fission-ai/openspec@1.12.0
cd /path/to/falla-openspec
npm install
npm link
```

在目标项目中先初始化官方 OpenSpec，再安装扩展：

```bash
openspec init --tools none /path/to/project
falla-openspec install /path/to/project --tools claude,codex --non-interactive
falla-openspec doctor /path/to/project --json
```

`install` 会安装两套 Falla Schema、规则文档、所选工具的 Skill 与 Hook，并用
`.falla/install-manifest.json` 记录受管文件哈希。重复安装是幂等的；marker 外的用户内容会保留，
受管文件或 marker 内发生漂移时不会被静默覆盖。

修改本仓库的工作流源码不会自动更新已经安装的目标项目。保持原 `tools` 选择并对目标项目重复
执行 `falla-openspec install` 即可更新；更新前应读取目标项目的
`.falla/install-manifest.json`，更新后运行 `doctor` 并重新创建 Agent 会话。详细命令见安装手册；
第 0 节提供了可独立复制的完整使用实例。注意文件名是 `install-manifest.json`，不是
`install-mainfest.json`。

交互终端下可省略 `--non-interactive` 选择工具。Figma MCP、CodeGraph 和 Lark CLI 只有显式选择或传入
`--with-figma`、`--with-codegraph`、`--with-lark` 时才会首次安装；`--with-lark` 只通过 npm 安装 CLI，不运行 Lark 的交互授权向导，
也不会自动申请飞书权限。需要飞书能力时再按业务域或具体 scope 做最小授权。安装器默认确保目标项目的 `.gitignore`
包含 `.codegraph/`；启用 CodeGraph 后，每个目标项目维护独立的本地索引，任务开始前由 Hook 执行增量同步。
AI 定位符号、调用链和影响面时优先查询图谱，再读取少量命中文件。

安装器还会在每个目标项目创建 `.falla/ui-knowledge/` 的通用协议、配置示例和条目模板，但不会
扫描业务代码或生成项目专属 UI 组件知识库。不同项目的 Markdown、RAG 本地索引和 CodeGraph 图谱
完全隔离；组件与页面模式由各项目成员，或经用户明确授权的 AI 单独维护。RAG 负责模糊召回，
CodeGraph 负责源码关系验证。详细约定见
[`docs/ui-component-knowledge-base.md`](docs/ui-component-knowledge-base.md)。
简洁 RAG 操作见安装到项目后的 `.falla/ui-knowledge/RAG-QUICKSTART.md`。

Falla 不读取或自动跟随 PRD 正文中的设计稿链接。只有用户在当前对话中另行手动提供含明确
node id、并指定用于当前任务的 Figma 链接时，工作流才通过 Figma MCP 读取对应节点；缺少
node id 时会要求重新选择节点并复制链接。浏览器、网页截图或抓取不能作为降级方案。若 MCP
未安装、未认证或没有设计稿权限，依赖该设计的工作会明确停止。
Figma `get_design_context` 固定传 `excludeScreenshot=true`；不调用截图工具，也不向当前模型发送截图。

## Android 项目校验与认领

```bash
# 全项目只读检查：安装、工作流、知识、集成分别报告
falla-openspec doctor --json
# 校验当前项目知识；不生成或修改条目
falla-openspec ui-knowledge validate --json
# 只读生成引用文件的 SHA-256，供 reviewer 核对后写入 source-hashes
falla-openspec ui-knowledge fingerprint .falla/ui-knowledge/components/retry-list.md --json
# 使用 config.yaml 中的 Provider 构建、增量同步和查询本地派生索引
falla-openspec ui-knowledge index build --json
falla-openspec ui-knowledge index sync --json
falla-openspec ui-knowledge index query --text "排行榜身份勋章" --json
falla-openspec ui-knowledge index status --json
# rebuild 原子替换现有索引；clear 只删除 .index/
falla-openspec ui-knowledge index rebuild --json
falla-openspec ui-knowledge index clear --json
# 阶段开始或源码变化后，准备已启用的图谱；失败可有界降级
falla-openspec codegraph prepare --json
# single 父 change 或 parallel 逻辑子 change 均使用排他认领
falla-openspec coordination claim medal --owner developer-a --json
```

`doctor` 的 `groups` 包含 `installation`、`workflow`、`knowledge`、`integrations`。
任一已检查分组失败时 doctor 返回非零；安装器的 `ok` 只表示安装完整性，同时附带完整 doctor
报告。图谱不可用可以有界降级，非法知识条目被排除；它们不等于工作流文件安装失败。

知识校验只证明 Markdown 结构和引用文件指纹符合协议，`direct-reuse-candidate` 仍需由当前
CodeGraph、依赖、资源及生命周期核对决定是否复用。旧 verified 条目缺少 `source-hashes` 时
会报告待补证据，不自动降级或改写。外部 Figma/Lark 认证、CodeGraph MCP 连接与索引新鲜度不由 doctor 证明。

## 标准工作流

父 change 及其 artifacts 由官方 CLI 管理：

```bash
openspec new change "medal" --schema falla-spec-driven --json
openspec status --change "medal" --json
openspec instructions proposal --change "medal" --json
```

`falla-propose` 默认使用 `single` 模式：ViewModel、View、控件和联调只拆成父 change
`tasks.md` 内的任务组，不自动创建额外目录。只有用户明确要求多人/多 Agent 并行、创建子 change
或独立分派时，才使用 `parallel` 模式。

OpenSpec 的物理 change 名不支持 `/`。parallel 模式创建子 change 时先注册逻辑引用，再把返回的
`physical` 交给官方 CLI：

```bash
falla-openspec coordination register "medal/achievement-detail" --json
openspec new change "medal-child-achievement-detail" --schema falla-task-driven --json
falla-openspec coordination resolve "medal/achievement-detail" --json
falla-openspec coordination validate --change "medal" --json
```

如果官方 `new change` 失败且没有创建物理目录，可安全清理本次孤儿映射：

```bash
falla-openspec coordination unregister "medal/achievement-detail" --json
```

物理 change 已存在时 unregister 会拒绝，不会删除任何 change 文件。

映射只保存在 `.falla/coordination.yaml`。负责人、状态、正向依赖和交接以各 change 的
`comate.md` 为唯一事实来源；反向 blocks 由正向依赖推导。`coordination validate` 检查缺失节点、环、
前置状态、tasks 完成度、结构化 handoff 和 OpenSpec artifact 状态。

## OpenSpec 1.12 兼容

- doctor 使用 `openspec status --all --json` 批量读取状态，避免逐 change 启动进程。
- 以 `isPlanningComplete` 为规划完成态；`skip_specs: true` 产生的 `skipped` artifact 视为已满足，
  不要求创建空 delta spec。
- change 名遵循新版 kebab-id，可由数字开头；tasks 中的嵌套 checkbox 与 `*` checkbox 同样计入门禁。
- apply/archive Skill 会分别读取 `context` 与 `operationGuidance`，后者只作为操作建议，不能覆盖
  官方状态、路径、安全门禁或用户明确选择。
- `.openspec.yaml` 支持官方 `skip_specs` 和 `retire_capabilities`；能力退役会删除主规格，仍需用户
  针对本次归档明确确认。

## OpenSpec 升级流程

不要直接升级生产项目中的 OpenSpec。每次升级按以下顺序处理：

1. 在本项目中把 `devDependencies` 的 OpenSpec 固定版本改为待验证版本，暂不扩大
   `peerDependencies` 支持范围。
2. 阅读官方变更说明，重点核对 CLI 参数和 `list/status/instructions/validate/schema` 的 JSON 契约。
3. 运行 `npm run check` 和 `npm test`；契约、两套 Schema、安装与完整工作流必须全部通过。
4. 在临时项目执行 install、doctor、父子协调和归档契约测试，确认受管内容幂等且无漂移。
5. 仅在兼容性已验证后扩大 `SUPPORTED_OPENSPEC_RANGE` 和 `peerDependencies`，再发布对应的
   FallaOpenSpec 版本。若官方存在破坏性变化，保持旧支持分支并单独实现适配层。

因为扩展只调用官方可执行文件和公开 JSON 输出，升级通常只需要调整窄契约、Schema 模板或命令
参数，不需要重新合并一份魔改 OpenSpec 源码。

## 验证与风险

```bash
npm run check
npm test
```

主要风险：官方小版本改变 JSON 字段或 Schema 语义；人工修改受管文件；Hook 所需规则文件缺失。
版本门禁、公开契约测试、项目锁、受管哈希和原子写入用于把这些情况转成显式失败。写入前会
复核计划时的文件哈希，但多文件更新不是事务，外部编辑器在最终核对与替换之间仍存在极短竞争窗口。
认领锁只覆盖同一台机器上的同一真实项目目录，不替代跨机器协调、工作树隔离或代码合并。报告不输出
环境变量、凭据或规格正文。
