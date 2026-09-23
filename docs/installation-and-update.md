# 安装和更新 FallaOpenSpec

这套工作流用于 Android 项目。安装和更新用的都是 `install`，没有 `update` 命令。
下面的 `/path/to/falla-openspec` 是本仓库，`/path/to/project` 是业务项目；换成你机器上的真实路径。

## 第一次安装

需要 Node.js 20.19 或更高版本，以及 OpenSpec 1.12.x（目前支持 `>=1.12.0 <1.13.0`）。
业务项目必须已存在，CodeGraph CLI 也要先装好。下面的例子同时安装 Claude Code 和 Codex，并启用 Figma、CodeGraph、Lark；只用一个 Agent，就把 `--tools` 改成 `claude` 或 `codex`。

```bash
export FALLA_HOME="/path/to/falla-openspec"
export TARGET_PROJECT="/path/to/project"

npm install -g @fission-ai/openspec@1.12.0
cd "$FALLA_HOME"
npm install

# 项目已有 openspec/ 就跳过这一行
openspec init --tools none "$TARGET_PROJECT"

node bin/falla-openspec.js install "$TARGET_PROJECT" \
  --tools claude,codex --with-figma --with-codegraph --with-lark --non-interactive
node bin/falla-openspec.js doctor "$TARGET_PROJECT" --json
```

看 `doctor` 输出里的 `groups.installation.ok` 是否为 `true`。装好后重开 Claude Code 或 Codex 会话，旧会话不会加载新规则。

## 以后更新

源码仓库改了，不会自动同步到业务项目。先看上次装了哪些工具，再用相同的 `--tools` 重跑 `install`：

```bash
export FALLA_HOME="/path/to/falla-openspec"
export TARGET_PROJECT="/path/to/project"
cd "$FALLA_HOME"
cat "$TARGET_PROJECT/.falla/install-manifest.json"

# 这里以 manifest 里的 tools 为 claude,codex 举例；不是这两个就改成实际值
node bin/falla-openspec.js install "$TARGET_PROJECT" --tools claude,codex --non-interactive
node bin/falla-openspec.js doctor "$TARGET_PROJECT" --json
```

少传一个工具，安装器会移除它的受管 Skill 和 Hook。普通更新不用重复加 `--with-*`，省略它们不会卸载已有集成。更新完也要重开 Agent 会话。
如果改的是工作流源码，先在本仓库运行 `npm run check` 和 `npm test`；只同步已验证的版本，可以跳过这步。

已有 change 不会被安装器改写。旧 change 继续执行前，应核对 `comate.md` 中的执行和验证模式，以及完成时的交接记录；
已有 `.falla/coordination.yaml` 映射的父 change 仍按 parallel 处理，别因为更新了模板就改成 single。

## 需要外部工具时

首次安装的示例把三个集成都带上了。不需要某项，就删掉对应参数；以后补装时也要沿用 manifest 中的 `--tools`：

- `--with-figma`：给所选 Agent 配 Figma MCP/插件。登录和设计稿权限还要单独确认。
- `--with-codegraph`：先在本机装好 CodeGraph CLI。敏感项目先检查 `codegraph telemetry status`，再启用索引。
- `--with-lark`：只安装 Lark CLI，不会替你申请权限。飞书 PRD 的正文与评论需要 `docs`、`drive` 业务域，可用 `lark-cli auth login --domain docs --domain drive --no-wait --json` 按需授权；别无参数运行 `lark-cli auth login`。

这些集成安装失败会给 warning，不会撤销已安装的工作流文件。CodeGraph 的 `.codegraph/` 和 UI 知识索引 `.falla/ui-knowledge/.index/` 都是项目本地缓存，不要提交或跨项目共用。

Figma 还有一条使用限制：工作流不会打开 PRD 正文里的设计链接。首次授权时，用户需在对话中提供带 node id、用于当前 change 的链接。
Preflight 先把节点引用记入 `preflight.md`；Propose 归并到 `design.md`，后续窗口读记录即可，不必重贴链接。
新节点或范围扩大时重新确认；只通过 Figma MCP 读取，不用浏览器或截图绕过权限。`get_design_context` 使用 `excludeScreenshot=true`。

## 出问题了

- `doctor` 的 `installation` 失败：先处理受管文件冲突。没有 `--force`；备份并合并自己的修改，不要删 `.falla/install-manifest.json` 或伪造哈希。
- 其他分组失败：`workflow` 检查 change，`knowledge` 检查知识条目，`integrations` 检查集成。`install` 成功只表示安装文件完整，不代表 Figma、Lark 已登录或 MCP 能连通。
- 安装中断：确认原进程已经退出，保留现状，用同一版本和相同 `--tools` 重跑，再执行 `doctor`。多文件更新不是事务。
- 更新后还是旧规则：核对项目路径，关闭并重新创建 Agent 会话。

路径和 `--tools` 最好在执行前再看一眼。不要把 token、cookie、API Key 或临时资源 URL 写进日志、知识库和交接文档。
项目目录和 `openspec/` 也不能是符号链接。更详细的知识库用法在目标项目的 `.falla/ui-knowledge/README.md`，阶段规则在 `.falla/skill-spec/`。
