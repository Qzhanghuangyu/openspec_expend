# FallaOpenSpec

FallaOpenSpec 是官方 OpenSpec 的工作流扩展层。官方 `openspec` CLI 是唯一的 change、artifact、
Schema 解析、校验和归档内核；本项目只保留 Falla 特有的规则、父子任务协调、Skill/Hook 安装、
旧 MercurySpec 迁移与可选工具接入。

## 边界

- 核心命令始终使用官方 `openspec`，本项目不提供 `new change`、`status`、`instructions`、
  `validate` 或 `archive` 的替代实现。
- 不导入 `@fission-ai/openspec/dist` 等内部模块，不复制官方 artifact graph 或 Schema 解析器。
- 新工作流只写入 `openspec/`；旧 `mercuryspec/` 仅作为迁移时的只读来源。
- 首版支持 OpenSpec `>=1.5.0 <1.6.0`，契约测试固定使用 `1.5.0`。
- 安装和迁移均不提供 `--force`，遇到用户修改或目标冲突会停止。

## 本地安装

要求 Node.js 20.19 或更高版本。

```bash
npm install -g @fission-ai/openspec@1.5.0
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

`install` 会安装四套 Falla Schema、规则文档、所选工具的 Skill 与 Hook，并用
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

映射只保存在 `.falla/coordination.yaml`。负责人、状态、依赖和交接仍以各 change 的
`comate.md` 为唯一事实来源；`coordination validate` 检查依赖对称性、缺失节点、环、前置状态、
tasks 完成度和 OpenSpec artifact 状态。

## 从 MercurySpec 迁移

先完成 FallaOpenSpec 安装，再始终从只读预演开始：

```bash
falla-openspec migrate /path/to/project --json
```

预演会列出 `copy`、`write`、`skip`、`conflict` 和逻辑名映射，但不修改
`mercuryspec/`、`openspec/` 或 `.falla/`。确认没有未处理冲突后执行：

```bash
falla-openspec migrate /path/to/project --apply --json
```

迁移先在候选目录运行四套 Schema 校验及 `openspec validate --all --strict`，写入后再次运行
官方校验和 `doctor`。任一步失败都会自动回滚。成功结果中的 `id` 可用于显式回滚：

```bash
falla-openspec migrate /path/to/project --rollback "<migration-id>" --json
```

若迁移后的文件已被人工修改，回滚会拒绝覆盖。迁移成功也不会删除旧 `mercuryspec/`，是否清理
旧目录应在验收和备份完成后由人工单独决定。

## OpenSpec 升级流程

不要直接升级生产项目中的 OpenSpec。每次升级按以下顺序处理：

1. 在本项目中把 `devDependencies` 的 OpenSpec 固定版本改为待验证版本，暂不扩大
   `peerDependencies` 支持范围。
2. 阅读官方变更说明，重点核对 CLI 参数和 `list/status/instructions/validate/schema` 的 JSON 契约。
3. 运行 `npm run check` 和 `npm test`；契约、四套 Schema、完整工作流、迁移/回滚必须全部通过。
4. 对真实项目只运行迁移 dry-run canary，确认源目录及现有 `openspec/`、`.falla/` 哈希不变。
5. 仅在兼容性已验证后扩大 `SUPPORTED_OPENSPEC_RANGE` 和 `peerDependencies`，再发布对应的
   FallaOpenSpec 版本。若官方存在破坏性变化，保持旧支持分支并单独实现适配层。

因为扩展只调用官方可执行文件和公开 JSON 输出，升级通常只需要调整窄契约、Schema 模板或命令
参数，不需要重新合并一份魔改 OpenSpec 源码。

## 验证与风险

```bash
npm run check
npm test
```

主要风险：官方小版本改变 JSON 字段或 Schema 语义；旧 MercurySpec 文档不符合严格 OpenSpec
格式；人工同时修改迁移目标；Hook 所需规则文件缺失。版本门禁、公开契约测试、项目锁、哈希
预检、原子写入、迁移日志和自动回滚用于把这些情况转成显式失败。报告只包含状态、计数、哈希和
相对路径，不输出环境变量、凭据或规格正文。
