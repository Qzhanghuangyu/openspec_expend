# FallaOpenSpec 初始化与更新手册

本文区分两个目录：

- **工作流源码目录**：本仓库，保存 `templates/`、安装器和测试；修改这里只会改变安装源。
- **目标项目目录**：实际 Android/业务项目，安装后包含 `.falla/`、`openspec/`，以及所选
  Agent 工具的 Skill 和 Hook。

修改工作流源码后，目标项目不会自动变化。必须对目标项目重新执行 `install`；该命令同时承担
首次安装和后续更新，不需要单独的 `update` 命令。

## 0. 当前机器最常用的完整命令

当前工作流源码位于 `$HOME/android/workflow/falla-openspec`，目标项目位于
`$HOME/android/androidCopy`。更新该项目时可直接逐条复制以下命令，不需要先设置环境变量，
也不要求已经执行过 `npm link`。

```bash
# 1. 查看上次安装时选择的 Agent 工具；文件名是 install-manifest，不是 install-mainfest
cat "$HOME/android/androidCopy/.falla/install-manifest.json"

# 2. 使用当前工作流源码更新目标项目；该项目当前同时使用 claude 和 codex
node "$HOME/android/workflow/falla-openspec/bin/falla-openspec.js" install "$HOME/android/androidCopy" --tools claude,codex --non-interactive

# 3. 检查更新结果
node "$HOME/android/workflow/falla-openspec/bin/falla-openspec.js" doctor "$HOME/android/androidCopy" --json

# 4. 更新成功后，在目标项目内查看本手册
cat "$HOME/android/androidCopy/.falla/installation-and-update.md"
```

上述更新命令故意没有附加 `--with-figma` 或 `--with-lark`，因为普通规则更新不需要重复安装或
登录已有外部工具。如果 Figma MCP 尚未安装，才使用下面的完整命令：

```bash
node "$HOME/android/workflow/falla-openspec/bin/falla-openspec.js" install "$HOME/android/androidCopy" --tools claude,codex --with-figma --non-interactive
```

## 1. 前置条件

- Node.js `>=20.19.0`。
- 官方 OpenSpec `>=1.12.0 <1.13.0`，当前建议固定为 `1.12.0`。
- 工作流源码和目标项目都使用真实目录，不能用符号链接冒充项目根或 `openspec/`。

```bash
npm install -g @fission-ai/openspec@1.12.0

# 根据实际位置替换下面两个绝对路径；等号两侧不能有空格
export FALLA_HOME="$HOME/android/workflow/falla-openspec"
export TARGET_PROJECT="$HOME/android/androidCopy"

cd "$FALLA_HOME"
npm install
```

可以任选一种方式运行安装器：

```bash
# 方式 A：建立全局命令，之后使用 falla-openspec
cd "$FALLA_HOME"
npm link

# 方式 B：不建立全局链接，始终直接运行当前源码
node "$FALLA_HOME/bin/falla-openspec.js" --help
```

## 2. 首次初始化目标项目

### 2.1 初始化官方 OpenSpec

仅在目标项目尚无 `openspec/` 时执行：

```bash
openspec init --tools none "$TARGET_PROJECT"
```

已有 `openspec/` 的项目不要重复初始化。

### 2.2 交互式安装 Falla

在可交互终端中执行：

```bash
falla-openspec install "$TARGET_PROJECT"
```

安装器会依次询问：

1. 安装 Claude Code、Codex，或同时安装两者的 Skill/Hook；
2. 是否安装 Figma MCP；
3. 是否安装并登录 Lark CLI。

Figma 集成对 Codex 注册远程 Figma MCP，对 Claude Code 安装官方 Figma 插件。飞书能力当前使用
Lark CLI，不是单独的“飞书 MCP”。外部工具安装或认证失败只会返回脱敏 warning，不会回滚已经
成功写入的本地工作流文件。

### 2.3 非交互式安装

自动化或脚本场景必须明确指定 Agent 工具：

```bash
falla-openspec install "$TARGET_PROJECT" \
  --tools claude,codex \
  --with-figma \
  --with-lark \
  --non-interactive
```

只使用 Codex 时：

```bash
falla-openspec install "$TARGET_PROJECT" \
  --tools codex \
  --with-figma \
  --non-interactive
```

`--non-interactive` 只关闭 Falla 自身的选择界面；`--with-lark` 触发的外部登录仍可能要求浏览器
或终端认证。未传 `--with-figma` / `--with-lark` 时，非交互安装不会自动安装或登录外部工具。

如果没有执行 `npm link`，把以上命令中的 `falla-openspec` 替换为：

```bash
node "$FALLA_HOME/bin/falla-openspec.js"
```

例如：

```bash
node "$FALLA_HOME/bin/falla-openspec.js" install "$TARGET_PROJECT" \
  --tools codex \
  --with-figma \
  --non-interactive
```

### 2.4 初始化后验证

```bash
falla-openspec doctor "$TARGET_PROJECT" --json
```

没有全局链接时：

```bash
node "$FALLA_HOME/bin/falla-openspec.js" doctor "$TARGET_PROJECT" --json
```

首次安装成功后，本手册会同步写入目标项目的 `.falla/installation-and-update.md`，方便直接在
业务仓库内查阅；`.falla/install-manifest.json` 会记录 Falla/OpenSpec 版本、已选 Agent 工具和
所有受管文件哈希。不要手工删除或伪造该文件。

## 3. 工作流源码修改后更新目标项目

### 3.1 先验证工作流源码

```bash
cd "$FALLA_HOME"
npm run check
npm test
```

只改文档或规则时可按改动范围运行相关测试，但发布或批量更新目标项目前应运行完整测试。

### 3.2 确认目标项目原有工具选择

完整命令如下。注意文件名必须是 `install-manifest.json`，不要写成 `install-mainfest.json`：

```bash
cat "$HOME/android/androidCopy/.falla/install-manifest.json"
```

使用前面设置的变量时，等价命令是：

```bash
cat "$TARGET_PROJECT/.falla/install-manifest.json"
```

如果提示 `No such file or directory`，先检查目录和文件名：

```bash
ls -la "$HOME/android/androidCopy/.falla"
```

查看 `tools` 字段，例如：

```json
{
  "tools": ["claude", "codex"]
}
```

更新时必须传入相同的 `--tools`。漏掉某个工具表示不再使用它，安装器会安全移除该工具对应的
受管 Skill、Hook 和 marker；这不是单纯的“跳过更新”。

### 3.3 重复执行 install 完成更新

当前机器不依赖全局链接、同时使用 Claude Code 和 Codex 的完整命令：

```bash
node "$HOME/android/workflow/falla-openspec/bin/falla-openspec.js" install "$HOME/android/androidCopy" --tools claude,codex --non-interactive
```

已经执行过 `npm link` 时，等价的简写命令是：

```bash
falla-openspec install "$TARGET_PROJECT" \
  --tools claude,codex \
  --non-interactive
```

只使用 Codex：

```bash
falla-openspec install "$TARGET_PROJECT" \
  --tools codex \
  --non-interactive
```

更新规则、Schema、Skill 或 Hook 时，通常不要重复传 `--with-figma` 或 `--with-lark`。省略这两个
参数不会卸载已经配置好的外部工具，只是不重复执行安装和登录。若首次安装时跳过了某项集成，
可以在本次命令中显式追加对应参数。

重复安装会：

- 更新 `.falla/skill-spec/` 和两套 OpenSpec Schema；
- 更新所选工具的 `.claude/skills/`、`.codex/skills/` 与 Hook；
- 保留 marker 外的用户内容；
- 更新 `.falla/install-manifest.json` 中的受管文件哈希；
- 对内容已经一致的文件保持幂等，不重复改写。

### 3.4 更新后验证并重启会话

当前机器的完整命令：

```bash
node "$HOME/android/workflow/falla-openspec/bin/falla-openspec.js" doctor "$HOME/android/androidCopy" --json
```

已经执行过 `npm link` 时，等价的简写命令是：

```bash
falla-openspec doctor "$TARGET_PROJECT" --json
```

然后关闭并重新创建 Claude Code/Codex 会话。正在运行的会话可能已经缓存旧 Skill 或旧 Soul，
不能用它判断更新后的门禁是否生效。

## 4. 常见问题

### 4.1 报告“用户修改的受管文件不能覆盖”

安装器没有 `--force`。目标文件当前哈希既不等于上次 manifest 记录，也不等于新模板时，会停止
整个更新，防止静默覆盖用户改动。

处理步骤：

1. 备份报错文件；
2. 比较用户改动与新模板，确认哪些内容仍需要保留；
3. 将自定义规则移到非受管文件，或将共享文件中的自定义内容放在 Falla marker 外；
4. 从版本控制或可靠备份恢复上次安装的受管内容；
5. 重新执行 `install`，再按允许的扩展点补回自定义内容。

不要通过删除 `.falla/install-manifest.json`、删除报错文件或手工改哈希绕过保护，否则可能造成
部分文件已更新、部分文件仍旧版的生命周期不一致。

### 4.2 更新时误传了不同的 `--tools`

安装前先读取 manifest。若原来是 `["claude", "codex"]`，更新也应传
`--tools claude,codex`。只有明确停用某个 Agent 工具时才改变该参数。

### 4.3 Figma MCP 或 Lark CLI 已经安装，更新规则时是否要重装

不需要。普通更新省略 `--with-figma` 和 `--with-lark` 即可。只有集成本身缺失、损坏，或需要
重新认证时才显式追加对应参数。

### 4.4 PRD 中有 Figma 链接，为什么没有自动读取

这是设计门禁的预期行为。工作流不读取 PRD 正文中的设计稿链接。用户需要在当前对话中另行
手动提供包含明确 node id、并指定用于当前任务的 Figma 链接；工作流随后只通过 Figma MCP
读取该节点，不使用浏览器降级。

## 5. 安全与风险检查清单

- 更新前确认目标项目路径和 manifest 中的 `tools`，避免清理错误工具的受管文件。
- 不在命令、日志、artifact 或 handoff 中写入 token、cookie、API Key 或临时资源 URL。
- 不用 `--force`、删除 manifest 或伪造哈希绕过受管文件漂移检查。
- 更新期间不要并发运行另一个 install；项目锁会拒绝并发写入。
- 更新完成后新开 Agent 会话，避免旧规则缓存与新文件生命周期不一致。
- 若 doctor 失败，不要继续依赖部分更新的工作流，先修复报告的问题。
