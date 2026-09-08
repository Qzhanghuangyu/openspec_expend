# [架构必读] Propose（提案与拆解）阶段约束

Propose 把已经完成 preflight 的父 change 转换为可被团队并行认领的任务图。

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
- design 明确 AI 搭建的 UI 框架和留给人工校准的约 20% 视觉项。

## 3. 子 change 落盘

子 change 必须在 propose 阶段创建，apply 不得创建：

1. 为每个交付单元确定逻辑名 `<parent>/<child>`。
   逻辑名必须恰好两段；View 是拆解类别，不得形成 `<parent>/view/<component>` 第三层。
2. 使用 `falla-openspec coordination register "<parent>/<child>" --json` 获得唯一物理名。
   默认物理名中间的 `child` 是固定字面量；例如 `medal/view-model` 映射为
   `medal-child-view-model`，`medal/top-bar` 映射为 `medal-child-top-bar`。
   每段使用小写 kebab-case。只有冲突时工具才追加逻辑引用 SHA-256 的前 8 位；
   agent 不得自行编造后缀。
3. 使用官方 `openspec new change "<physical>" --schema falla-task-driven --json` 创建 change。
4. 用官方 instructions 创建子 change 的 `tasks.md` 和 `comate.md`。
5. `depends-on` 与 `blocks` 使用逻辑名，并保持双向一致。
6. 执行 `falla-openspec coordination validate --change "<parent>" --json`。

如果官方 change 创建失败，停止并报告未完成映射；不得静默删除文件或伪造成功。

## 4. 完成标准

- 父 change 的 proposal、specs、design、tasks、comate 全部由官方 status 判定 done。
- 所有子 change 都是 OpenSpec 顶层物理 change，并能通过逻辑名解析。
- 子 change 至少有 `.openspec.yaml`、`tasks.md` 和 `comate.md`。
- DAG 无缺失节点、非对称边或环。
- 无实现模块伪装成业务规格。
