# 安装和更新 FallaOpenSpec

这套工作流用于 Android 项目。安装和更新用的都是 `install`，没有 `update` 命令。
下面的 `/path/to/falla-openspec` 是本仓库，`/path/to/project` 是业务项目；换成你机器上的真实路径。

## 第一次安装

需要 Node.js 20.19 或更高版本，以及 OpenSpec 1.12.x（目前支持 `>=1.12.0 <1.13.0`）。
业务项目必须已存在，CodeGraph CLI 也要先装好。下面的例子同时安装 Claude Code 和 Codex，并启用 Figma、CodeGraph、Lark、WebP 工具；只用一个 Agent，就把 `--tools` 改成 `claude` 或 `codex`。

```bash
export FALLA_HOME="/path/to/falla-openspec"
export TARGET_PROJECT="/path/to/project"

npm install -g @fission-ai/openspec@1.12.0
cd "$FALLA_HOME"
npm install
npm install -g "$FALLA_HOME"  # 建立 Skill 使用的 falla-openspec 命令入口
command -v falla-openspec
falla-openspec --version

# 项目已有 openspec/ 就跳过这一行
openspec init --tools none "$TARGET_PROJECT"

falla-openspec install "$TARGET_PROJECT" \
  --tools claude,codex --with-figma --with-codegraph --with-lark --with-webp --non-interactive
falla-openspec doctor "$TARGET_PROJECT" --json
```

看 `doctor` 输出里的 `checks` 是否包含通过的 `falla-cli`，以及 `groups.installation.ok` 是否为 `true`。
若 `command -v` 失败，先让 npm 的全局可执行目录进入启动 Agent 的同一 `PATH`；
只用 `node bin/falla-openspec.js` 能安装文件，但不会建立 Skill 所需的命令入口。
装好后重开 Claude Code 或 Codex 会话，旧会话不会加载新规则。

## 以后更新

源码仓库改了，不会自动同步到业务项目。先看上次装了哪些工具，再用相同的 `--tools` 重跑 `install`：

```bash
export FALLA_HOME="/path/to/falla-openspec"
export TARGET_PROJECT="/path/to/project"
cd "$FALLA_HOME"
cat "$TARGET_PROJECT/.falla/install-manifest.json"

# 更新 CLI 入口后再更新受管文件；这里以 manifest 的 tools 为 claude,codex 举例
npm install -g "$FALLA_HOME"
command -v falla-openspec
falla-openspec --version
falla-openspec install "$TARGET_PROJECT" --tools claude,codex --non-interactive
falla-openspec doctor "$TARGET_PROJECT" --json
```

少传一个工具，安装器会移除它的受管 Skill 和 Hook。普通更新不用重复加 `--with-*`，省略它们不会卸载已有集成。更新完也要重开 Agent 会话。
如果改的是工作流源码，先在本仓库运行 `npm run check` 和 `npm test`；只同步已验证的版本，可以跳过这步。

已有 change 不会被安装器改写。旧 change 继续执行前，应核对 `comate.md` 中的执行和验证模式，以及完成时的交接记录；
已有 `.falla/coordination.yaml` 映射的父 change 仍按 parallel 处理，别因为更新了模板就改成 single。

## 日常执行入口

普通 single 依次手动发起 Preflight、Propose、Apply；每轮只完成一个 task 并暂停，同一 Apply 会话回复“继续”恢复下一轮。
在目标项目先按 `.falla/skill-spec/references/coordination.md` 的“按场景读取”选择适用章节：
通用完成/验证与 single 规则用于日常执行，跨 change 依赖、旧记录或基线变化时追加对应规则；有子映射时加载 parallel 规则。

同一个 comate 按“handoff 增量更新”记录当前 task 的修改、验证、下一步与风险，已有效的结论用项目内引用承接。
保留模板字段和前序任务有效证据，注释只审计本次新增或实质修改的符号，生命周期收尾按规划任务执行。
具体门禁由上述权威规则定义，本节只作导航；安装更新不重写已有 tasks/comate 或自动刷新实施基线。

## 需要外部工具时

首次安装的示例把四个可选集成都带上了。不需要某项，就删掉对应参数；以后补装时也要沿用 manifest 中的 `--tools`：

- `--with-figma`：给所选 Agent 配 Figma MCP/插件。登录和设计稿权限还要单独确认。
- `--with-codegraph`：先在本机装好 CodeGraph CLI。敏感项目先检查 `codegraph telemetry status`，再启用索引。
- `--with-lark`：只安装 Lark CLI，不会替你申请权限。飞书 PRD 的正文与评论需要 `docs`、`drive` 业务域，可用 `lark-cli auth login --domain docs --domain drive --no-wait --json` 按需授权；别无参数运行 `lark-cli auth login`。
- `--with-webp`：检查 `cwebp`；已可用时不重复安装，缺失且 Homebrew 可用时尝试安装。Homebrew 不可用或安装后仍不可用会给 warning，并由 `doctor` 报告；此选项不自动转换业务项目资源。

这些集成安装失败会给 warning，不会撤销已安装的工作流文件。CodeGraph 的 `.codegraph/` 和 UI 知识索引 `.falla/ui-knowledge/.index/` 都是项目本地缓存，不要提交或跨项目共用。

Figma 还有一条使用限制：工作流不会打开 PRD 正文里的设计链接。首次授权时，用户需在对话中提供带 node id、用于当前 change 的链接。
Preflight 先把节点引用记入 `preflight.md`；Propose 归并到 `design.md`，后续窗口读记录即可，不必重贴链接。
新节点或范围扩大时重新确认。读设计默认通过 Figma MCP 提取结构（`get_design_context` 显式传 `excludeScreenshot=true`）；
工程切图优先使用带 `FIGMA_ACCESS_TOKEN` 的官方 REST API 原生导出 3x PNG（`res/drawable-xxhdpi/`），保证 Alpha 透明通道与真实倍率，规则见 `templates/skill-spec/references/design-tools.md`。

## 出问题了

- `doctor` 的 `installation` 失败：先处理受管文件冲突。没有 `--force`；备份并合并自己的修改，不要删 `.falla/install-manifest.json` 或伪造哈希。
- `doctor` 的 `falla-cli` 检查失败：确认启动 Agent 的 `PATH` 能找到 `falla-openspec`，从本仓库重新运行 `npm install -g "$FALLA_HOME"`，核对 `falla-openspec --version` 后重跑 doctor；不要只用 `node bin/falla-openspec.js` 绕过命令入口。
  如果移动或删除了本仓库，也要从新位置重新安装全局命令；部分 npm 环境会将本地安装链接到源码目录。
- 其他分组失败：`workflow` 检查 change，`knowledge` 检查知识条目，`integrations` 检查集成。`install` 成功只表示安装文件完整，不代表 Figma、Lark 已登录或 MCP 能连通。
- 安装中断：确认原进程已经退出，保留现状，用同一版本和相同 `--tools` 重跑，再执行 `doctor`。多文件更新不是事务。
- 更新后还是旧规则：核对项目路径，关闭并重新创建 Agent 会话。

路径和 `--tools` 最好在执行前再看一眼。不要把 token、cookie、API Key 或临时资源 URL 写进日志、知识库和交接文档。
项目目录和 `openspec/` 也不能是符号链接。更详细的知识库用法在目标项目的 `.falla/ui-knowledge/README.md`，阶段规则在 `.falla/skill-spec/`。
