# FallaOpenSpec 安装与更新

- **工作流源码目录**：本仓库，用 `$FALLA_HOME` 表示。
- **目标项目目录**：实际业务项目，用 `$TARGET_PROJECT` 表示。
- `install` 同时负责首次安装和后续更新，没有单独的 `update` 命令。

## 0. 完整使用实例

```bash
#export FALLA_HOME="/path/to/falla-openspec"
export FALLA_HOME="/path/to/falla-openspec"
export TARGET_PROJECT="/path/to/project"

# 首次使用：目标项目没有 openspec/ 时才执行
openspec init --tools none "$TARGET_PROJECT"

# 首次安装；按需删除不需要的 --with-* 参数
node "$FALLA_HOME/bin/falla-openspec.js" install "$TARGET_PROJECT" \
    --tools claude,codex \
    --with-figma \
    --with-codegraph \
    --non-interactive

# 验证
node "$FALLA_HOME/bin/falla-openspec.js" doctor "$TARGET_PROJECT" --json

# 后续更新：先确认原 tools，再重复执行 install
# 文件名是 install-manifest.json
cat "$TARGET_PROJECT/.falla/install-manifest.json"
node "$FALLA_HOME/bin/falla-openspec.js" install "$TARGET_PROJECT" \
  --tools claude,codex \
  --non-interactive
node "$FALLA_HOME/bin/falla-openspec.js" doctor "$TARGET_PROJECT" --json
```

更新成功后关闭并重新创建 Claude Code/Codex 会话。

## 1. 准备

要求：

- Node.js `>=20.19.0`；
- OpenSpec `>=1.12.0 <1.13.0`，建议固定 `1.12.0`；
- `--with-codegraph` 需要本机已有 CodeGraph CLI；
- 源码目录、目标项目和 `openspec/` 必须是真实目录，不能是符号链接。

```bash
npm install -g @fission-ai/openspec@1.12.0
cd "$FALLA_HOME"
npm install
```

可选：执行 `npm link` 后，可把
`node "$FALLA_HOME/bin/falla-openspec.js"` 简写为 `falla-openspec`。

## 2. 安装选项

| 参数 | 作用 |
| --- | --- |
| `--tools claude,codex` | 安装两种 Agent 的 Skill/Hook；只用一个时传单个名称 |
| `--with-figma` | Codex 注册 Figma MCP，Claude Code 安装官方 Figma 插件 |
| `--with-codegraph` | 为所选 Agent 安装 CodeGraph MCP，并初始化当前项目索引 |
| `--with-lark` | 通过 npm 只安装 Lark CLI，不运行授权向导 |
| `--non-interactive` | 关闭 Falla 自身的交互选择 |

也可以直接运行交互安装：

```bash
falla-openspec install "$TARGET_PROJECT"
```

外部集成失败只产生脱敏 warning，不会回滚已经写入的工作流文件。Lark 权限按需单独授权。
安装器会创建或更新目标项目的 `.gitignore`，默认追加 `.codegraph/`，并保留已有忽略规则。

## 3. 重复执行 install 完成更新

修改工作流源码后，目标项目不会自动变化。更新前运行：

```bash
cd "$FALLA_HOME"
npm run check
npm test
cat "$TARGET_PROJECT/.falla/install-manifest.json"
```

更新时必须传入相同的 `--tools`。少传一个工具表示停用该工具，安装器会移除对应的受管 Skill、
Hook 和 marker。

普通更新不要重复传 `--with-figma`、`--with-codegraph` 或 `--with-lark`。省略这些参数不会卸载
已有外部工具；CodeGraph 启用状态会保留，任务 Hook 继续执行增量同步。

### Propose 执行模式

- 默认 `single`：只维护一个父 change，ViewModel、View、控件、组装和联调作为 `tasks.md` 中的任务组。
- 仅当用户明确要求多人/多 Agent 并行、创建子 change 或独立分派时使用 `parallel`；AI 可以提出
  建议，但未得到明确确认时仍保持 `single`。
- 任务较多、存在 MVVM 分层或理论上可并行，不足以自动切换为 `parallel`。
- 重跑旧 change 时，如果 `.falla/coordination.yaml` 已存在该父 change 的映射，则继续按
  `parallel` 处理，避免既有父子 change 生命周期失配。
- 执行模式由 propose 决定；apply 不得创建子 change 或切换模式。

更新后执行：

```bash
node "$FALLA_HOME/bin/falla-openspec.js" doctor "$TARGET_PROJECT" --json
# 已执行 npm link 时也可使用：falla-openspec doctor "$TARGET_PROJECT" --json
```

然后重新创建 Claude Code/Codex 会话，避免旧 Skill、Hook 或 Soul 缓存造成生命周期不一致。

## 4. Lark 最小权限

`--with-lark` 使用 `npm install --global @larksuite/cli@latest`，不会运行 `npx ... install` 的交互授权向导。
实际使用某项飞书能力时再授权，禁止无参数执行 `lark-cli auth login`，
因为它等价于申请全部已知业务域。

```bash
# 示例：只需要文档
lark-cli auth login --domain docs --no-wait --json

# 示例：只需要文档和云盘
lark-cli auth login --domain docs --domain drive --no-wait --json

# 权限报错已经给出 missing_scopes 时，优先只申请具体 scope
lark-cli auth login --scope "<missing_scope>" --no-wait --json
```

已有授权会累积。若之前授权过多，`auth logout` 只清除本机登录态；还需要在飞书授权管理页取消该
应用的服务端授权，再按最小 domain/scope 重新登录。

## 5. CodeGraph

首次启用时执行 `codegraph init <project>`；已有索引时执行：

```bash
codegraph sync <project> --quiet
```

- Codex 在 SessionStart 准备索引；Claude Code 在首次运行 Falla Skill 前准备一次。
- CodeGraph 用于符号、调用链和影响面；XML、Gradle、Manifest、资源及精确文本仍使用有界 `rg`。
- 安装器会幂等确保 `.gitignore` 包含 `.codegraph/`；首次初始化和后续增量同步生成的图谱仅保存在开发者本机。
- `.codegraph/` 不提交版本库，不把完整数据库或全量查询结果交给模型。
- 敏感项目先检查 `codegraph telemetry status` 的遥测状态。

## 6. UI 组件知识库

安装器只创建通用协议、配置示例和空白模板：

```text
.falla/ui-knowledge/
├── README.md
├── schema-v1.md
├── config.example.yaml
└── templates/
    ├── component.md
    └── screen-pattern.md
```

每个项目独立维护自己的 `config.yaml`、`components/*.md` 和 `screen-patterns/*.md`；工作流不会
扫描业务源码、生成具体条目、跨项目检索或建立共享知识数据库。Markdown 是知识事实源，未来 RAG
生成的 `.falla/ui-knowledge/.index/` 只是当前项目本地缓存，安装器会将其加入 `.gitignore`。

RAG 负责当前项目知识 Markdown 的模糊召回，CodeGraph 负责验证当前项目源码符号、调用链、影响面
和相关测试。不得修改 `.codegraph/codegraph.db` 存储 UI 知识，也不得把图谱命中自动视为已验证组件。

详细规则见 `.falla/ui-knowledge/README.md` 和 `.falla/ui-knowledge/schema-v1.md`。

## 7. 常见问题

### 受管文件被修改

安装器没有 `--force`。先备份并合并用户改动，再恢复受管部分后重新安装。不要通过删除 `.falla/install-manifest.json`、
删除报错文件或伪造哈希绕过保护。

### Figma 链接没有自动读取

这是预期行为。PRD 正文里的设计链接不会自动打开。用户必须在当前对话中明确提供带 node id、
用于当前任务的 Figma 链接；工作流只通过 Figma MCP 读取，不使用浏览器降级。

### 外部集成是否每次重装

不需要。只有首次启用、配置损坏或需要重新认证时才追加对应的 `--with-*` 参数。

## 8. 风险检查

- 确认目标项目路径和 manifest 中的 `tools`，避免误删另一 Agent 的受管文件。
- 不在日志、artifact、知识库或 handoff 中写入 token、cookie、API Key、签名或临时资源 URL。
- 不要并发执行两个 `install`。
- `doctor` 失败时不要继续使用部分更新的工作流。
- 更新完成后重新创建 Agent 会话。
