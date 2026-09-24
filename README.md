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
Skill 只编排命令，Schema instruction 只约束对应 artifact，模板只提供结构。Figma、源码检索、
UI Knowledge、Android 质量和协作细则位于 `.falla/skill-spec/references/`。其中 `project-rules.md` 在
Propose/Apply 强制读取；其他参考仅在当前任务命中时读取。

`hybrid` 且 tasks 没有 `[人工]` 项时，`human-review` 可设为 `not-required`；有人工项时须按人工
反馈达到 `passed`，`human` 模式始终需要人工确认。每项任务必须可验证，但不默认新增单测。
有构建影响时普通 task 先做轻量检查，相关实施完成后对交付变体做一次集成构建；可运行入口构建
实际应用 APK，不用库模块编译代替。静态生命周期核对不能替代页面退出实测，无法实测的必要项
保持未完成并交接给人工。

## 初始化与更新

第一次安装：初始化项目的 OpenSpec，再运行 `falla-openspec install`。
以后更新：查看 `.falla/install-manifest.json`，用原来的 `--tools` 重跑 `install`。
两次都要运行 `doctor`，结束后重开 Agent 会话。命令和排障方法见[安装手册](docs/installation-and-update.md)；它也会复制到目标项目的 `.falla/installation-and-update.md`。

安装手册的首次安装示例带了 Figma、CodeGraph 和 Lark；用不到就删掉对应的 `--with-*` 参数。受管文件有冲突时，安装器会停止，不会用 `--force` 覆盖你的修改。
UI 知识库的具体用法见 [`docs/ui-component-knowledge-base.md`](docs/ui-component-knowledge-base.md) 或目标项目的 `.falla/ui-knowledge/README.md`。

Falla 不会自动打开 PRD 正文中的设计链接。首次授权时，请在对话中提供带 node id、用于当前 change 的 Figma 链接。
Preflight 收到链接会先在 `preflight.md` 留下节点交接；Propose 把它归并到 `design.md`。后续窗口读取记录，
同一节点无需重贴链接。设计变化时重新核对，新节点或范围扩大仍需确认。
设计只能通过 Figma MCP 读取，不用浏览器或截图代替。`get_design_context` 使用 `excludeScreenshot=true`；没有权限就停止依赖该设计的工作。
UI 复现只从已授权节点提取少量关键文本规格；运行时核对可观察的层级、文案与边界，无法通过文本
判断的图标、字体渲染和动效由人工对照设计与 App，反馈文字差异与验收结论，不向模型上传图片。
项目确认使用 AutoSizeConfig 按宽适配，且 1× 设计画布宽等于 `design_width_in_dp` 时，可将设计
尺寸/间距的数值按同数值 dp 实现；这不等于物理像素。设计稿高度和 `design_height_in_dp` 都不
代表运行时内容高度，后者须结合实际窗口与 Insets 核对，不按两种高度的比例压缩整页。

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
