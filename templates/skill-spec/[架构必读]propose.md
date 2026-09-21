# [架构必读] Propose（提案与拆解）阶段约束

Propose 把已经完成 preflight 的父 change 转换为可被团队并行认领的任务图。

## Figma 文本兼容模式

本阶段凡调用 Figma MCP 的 `get_design_context`，都必须显式传入
`excludeScreenshot=true`。禁止调用 `get_screenshot`，也禁止把截图、截图 URL、图片块或其他栅格化
预览送入当前模型。排除截图后无法确认的视觉细节必须记录为人工视觉校准项，不得通过浏览器或截图绕过。

## 1. 前置与官方 artifact

1. 复用 preflight 已创建的父 change，不创建第二个父 change。
2. 用 `openspec status --change "<parent>" --json` 确认 `preflight` 为 done；目录存在不等于完成。
3. 依次读取官方 `openspec instructions <artifact> --change "<parent>" --json`，创建
   proposal、specs、design、tasks、comate。
4. 每次只写官方返回的 `resolvedOutputPath`，不猜文件路径。

## 2. 拆解规则

- 页面级需求先拆 ViewModel 与 View。
- UI 再拆顶部栏、列表项、底部栏、空状态、弹窗等独立模块控件。
- tasks 使用 checkbox，并显式标出依赖；契约先行、控件并行、组装和联调最后收敛。
- `specs/` 只承载用户可观察、可测试的业务行为，不承载实现模块。
- 纯重构、工具或文档变更且没有规格级行为变化时，在 `.openspec.yaml` 显式设置
  `skip_specs: true`；官方 status 中 `skipped` 表示依赖已满足，不创建空 delta spec。
- design 明确可自动验证的 UI 实现和留给人工校准的具体视觉项，不用固定百分比判断完成。

## 3. 选择执行模式

### 3.1 single（默认）

- 新 change 未收到用户明确的并行拆分要求时，`tasks.md` 中写入 `执行模式：single`。
- 重跑已有 change 时，若 `.falla/coordination.yaml` 已存在该父 change 的子映射，则保留
  `parallel` 并复用已有子 change，不得降级为 single 或重复创建。
- ViewModel、View、独立控件、组装和联调只作为父 change 内的任务组，不创建额外 change 目录。
- apply 直接实施父 change，并按 `tasks.md` 的依赖顺序推进。
- 不调用 `coordination register`，也不创建 `falla-task-driven` change。

### 3.2 parallel（显式启用）

只有用户明确要求多人/多 agent 并行、创建子 change 或独立分派时，才写入
`执行模式：parallel` 并创建子 change。任务规模较大、存在 ViewModel/View 分层或理论上可并行，
都不能单独作为启用依据。

parallel 模式下：

1. 为每个独立认领、独立验证和独立交接的交付单元确定逻辑名 `<parent>/<child>`。
   逻辑名必须恰好两段；View 是拆解类别，不得形成 `<parent>/view/<component>` 第三层。
2. 使用 `falla-openspec coordination register "<parent>/<child>" --json` 获得唯一物理名。
   默认物理名中间的 `child` 是固定字面量；例如 `medal/view-model` 映射为
   `medal-child-view-model`，`medal/top-bar` 映射为 `medal-child-top-bar`。
   每段只使用小写字母、数字和单连字符，并允许数字开头。只有冲突时工具才追加逻辑引用
   SHA-256 的前 8 位；agent 不得自行编造后缀。
3. 使用官方 `openspec new change "<physical>" --schema falla-task-driven --json` 创建 change。
4. 用官方 instructions 创建子 change 的 `tasks.md` 和 `comate.md`。
5. `depends-on` 与 `blocks` 使用逻辑名，并保持双向一致。
6. 执行 `falla-openspec coordination validate --change "<parent>" --json`。

如果官方 change 创建失败，停止并检查返回的物理 change 是否已经落盘。只有物理 change
完全不存在时，才可显式运行
`falla-openspec coordination unregister "<parent>/<child>" --json` 清理本次孤儿映射；
物理 change 已存在时不得移除映射、删除文件或伪造成功。

## 4. 完成标准

- 父 change 的 proposal、specs、design、tasks、comate 全部由官方 status 判定 done。
- single 模式不创建子 change 或 coordination 映射。
- parallel 模式的所有子 change 都是 OpenSpec 顶层物理 change，并能通过逻辑名解析；每个子
  change 至少有 `.openspec.yaml`、`tasks.md` 和 `comate.md`，DAG 无缺失节点、非对称边或环。
- 无实现模块伪装成业务规格。
