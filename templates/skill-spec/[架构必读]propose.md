# [架构必读] Propose（架构与任务拆解）阶段约束

Propose 消费已完成的 preflight，把已确认需求转成 proposal、specs、design、tasks 和 comate。
通用工具、安全、知识、范围和人工校准规则统一继承 `[Must Read]soul.md`。

## 1. 前置与证据复用

1. 以 `openspec status --change "<parent>" --json` 为准确认 preflight 完成。
2. 按官方 artifact 状态逐个调用 instructions，使用返回的依赖、模板和 `resolvedOutputPath`。
3. 优先复用 preflight 已记录且仍有效的证据；只有证据缺失、源码已变化或设计决策需要时才补充调查，
   不重新执行一次完整 preflight。
4. 项目规则、UI Knowledge 和源码基线的处理统一遵守 Soul；required 结论必须由当前源码验证。

## 2. Artifact 职责

- `proposal.md`：为什么改、改什么、影响什么。
- `specs/`：只记录用户可观察、可测试的行为，不承载 View、ViewModel、控件或接口层等实现模块。
- `design.md`：技术决策、页面实现结构基线、MVVM/组件边界、项目规则绑定、实现基线、生命周期、
  安全、风险和人工视觉校准项。
- `tasks.md`：只记录具体交付任务、依赖、允许编辑范围和完成条件；不重复保存执行模式或验证模式。
- `comate.md`：执行模式、验证模式、人工验收状态、owner、协作状态、change 依赖和 handoff 的唯一来源。

纯重构、工具或文档变更且无规格级行为变化时，在 `.openspec.yaml` 设置 `skip_specs: true`，
不得创建空 requirement。

## 3. 任务拆解

- 页面级工作先明确 ViewModel 与 View 契约，再按可独立交付的 UI 控件拆分，最后组装和联调。
- 新建或重构页面必须先确定页面承载方式、文件归属、导航、ViewModel 作用域、根节点、滚动/状态容器、
  组件复用、Insets、根页面/XML 修改责任和生命周期所有者。无法确定时保留开放问题，不生成下游实施任务。
- 每项任务应能在一次独立实施上下文内完成定位、修改、验证和交接，并写明输入、允许编辑范围、
  完成条件和前置依赖。
- 通用质量门禁不预填成大量固定 checkbox；只把当前 change 实际需要的实现与验证任务写入 tasks。
- `[人工]` task 必须写明前置条件、操作步骤、预期结果、variant/设备和服务端依赖。

## 4. 执行与验证模式

模式只记录在父 `comate.md`：

- `execution-mode: single`：默认，全部实施任务保留在父 change。
- `execution-mode: parallel`：仅用户明确要求多人/多 agent 并行、创建子 change或独立分派时使用。
- `validation-mode: hybrid`：默认；可在用户明确要求时改为 `human` 或 `agent`。

已有父 change 若存在子映射，必须保持 parallel；模式冲突时停止修复，不根据复杂度自行切换。

## 5. Parallel 子 change

1. 每个交付单元使用恰好两段的逻辑名 `<parent>/<child>`。
2. 用 `coordination register` 获取物理名，禁止自行拼接冲突后缀。
3. 使用官方 CLI 创建 `falla-task-driven` change，并生成 tasks/comate。
4. 子 change 只保存自己的具体任务；父 tasks 只保存协调里程碑和子 change 引用，不复制子任务清单。
5. 子 `comate.md` 只保存 `depends-on`；`blocks` 由协调器反向推导，不再人工维护。
6. 根页面/XML 只能有一个明确责任方。
7. 执行 `coordination validate`，确认节点存在、依赖无环且前置状态有效。

创建官方 change 失败时，只有确认物理目录完全不存在，才可 unregister 本次孤儿映射。

## 6. 完成标准

- 父 proposal、specs（或 skipped）、design、tasks、comate 均由官方 status 判定完成。
- single 不存在子映射；parallel 至少存在一个合法子映射。
- 所有任务范围、依赖和验证方式明确，无实现模块伪装成业务规格。
- 本阶段不修改业务代码。
