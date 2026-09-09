# FallaOpenSpec

FallaOpenSpec 是官方 OpenSpec 的工作流扩展层。官方 `openspec` CLI 是唯一的 change、artifact、
Schema 解析、校验和归档内核；本项目只保留 Falla 特有的规则、父子任务协调、Skill/Hook 安装、
运行时检查与可选工具接入。

## 边界

- 核心命令始终使用官方 `openspec`，本项目不提供 `new change`、`status`、`instructions`、
  `validate` 或 `archive` 的替代实现。
- 不导入 `@fission-ai/openspec/dist` 等内部模块，不复制官方 artifact graph 或 Schema 解析器。
- 工作流只读写标准 `openspec/`，保持单一、干净的工作流事实源。
- 当前支持 OpenSpec `>=1.12.0 <1.13.0`，契约测试固定使用 `1.12.0`。
- 安装不提供 `--force`，遇到用户修改或受管内容漂移会停止。

## 本地安装

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

交互终端下可省略 `--non-interactive` 选择工具。Figma MCP 和 Lark CLI 只有显式选择或传入
`--with-figma`、`--with-lark` 时才会安装；非交互模式不会自动安装或登录外部工具。

## 标准工作流

父 change 及其 artifacts 由官方 CLI 管理：

```bash
openspec new change "medal" --schema falla-spec-driven --json
openspec status --change "medal" --json
openspec instructions proposal --change "medal" --json
```

OpenSpec 的物理 change 名不支持 `/`。创建子 change 时先注册逻辑引用，再把返回的
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

映射只保存在 `.falla/coordination.yaml`。负责人、状态、依赖和交接仍以各 change 的
`comate.md` 为唯一事实来源；`coordination validate` 检查依赖对称性、缺失节点、环、前置状态、
tasks 完成度和 OpenSpec artifact 状态。

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
版本门禁、公开契约测试、项目锁、受管哈希和原子写入用于把这些情况转成显式失败。报告不输出
环境变量、凭据或规格正文。
