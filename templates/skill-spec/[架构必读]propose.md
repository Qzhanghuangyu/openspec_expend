# [架构必读] Propose（方案与任务拆解）

## 目标

把已完成的 preflight 转成可实施、可验证、可交接的 proposal、specs、design、tasks 和 comate。
本阶段只规划，不修改业务代码。

## 输入

- 已完成的父 change 和 `preflight.md`。
- 当前主规格与 preflight 已记录的源码证据。
- `.falla/project-rules/` 的全部顶层规则、有效 UI Knowledge，以及用户明确提供的设计节点。

## 必须执行

1. 用 `openspec status --change "<parent>" --json` 确认 preflight 已完成。
2. 按官方状态逐个调用：

   ```bash
   openspec instructions <proposal|specs|design|tasks|comate> --change "<parent>" --json
   ```

3. 必读 `references/project-rules.md`。如果项目规则目录存在，确定性读取全部顶层 `.md`，并在 design 中
   审计每条 required：明确“适用/不适用/冲突/已批准例外”；未分类完整前不得继续生成 tasks/comate。
4. 优先复用仍有效的 preflight 证据；不得重新执行一次完整 preflight。只有证据缺失、源码变化或设计决策需要时才补充调查。
   先读 `preflight.md` 的“设计节点交接”；其中已确认用于当前 change 的节点可跨会话继续使用，无需用户重贴链接。
   如果用户在 Propose 新提供节点、但 design 尚未可写，先把最小授权记录追加到 preflight 的该节；
   design 可写后立即归并，并以 design 为后续阶段唯一设计事实源，不能把部分设计草稿冒充已完成 artifact。
   需要 Figma 时只分析用户明确授权的节点，并在 `design.md` 的“设计源证据”章节保存用户授权记录、
   file key、精确 node id、核对日期、实施事实、完整资源清单/目标路径、下载状态/文件哈希、未决项和重新
   核对条件。后续阶段不再依赖对话记忆。
5. 明确各 artifact 的职责：
   - proposal：为什么改、改什么、影响什么。
   - specs：用户可观察、可测试的行为；不得把实现模块写成能力。
   - design：技术决策、页面结构、实现基线、规则绑定、生命周期、安全、风险和人工校准。
     使用 XML 的页面在 `design.md` 列出布局文件与关键节点层级（根、主要内容、滚动/状态容器）；
     只写便于人工修正的结构草图，已有节点要有源码依据，拟新增节点明确标注，不展开完整 XML 属性。
     纯 Compose 或非页面变更注明不适用。
   - tasks：实际交付任务、允许编辑范围、完成条件和前置依赖。
   - comate：执行/验证模式、owner、协作状态、change 依赖和 handoff。
6. 页面工作先确定 ViewModel 与 View 契约，再拆独立控件，最后安排组装和联调。
   注释契约逐符号判断，不能用“方法短”统一豁免。
7. 每个 task 必须足够小，能在一次独立实施上下文内完成。通用质量门禁不复制成固定任务。
8. 默认在父 comate 写入 `execution-mode: single` 和 `validation-mode: hybrid`。
9. 纯重构、工具或文档变更且没有规格级行为变化时设置 `skip_specs: true`。

## Parallel 模式

只有用户明确要求多人/多 Agent 并行、创建子 change 或独立分派时才启用：

1. 使用恰好两段的逻辑名 `<parent>/<child>`。
2. 通过 `coordination register` 获取物理名，再用官方 CLI 创建 `falla-task-driven` change。
3. 子 change 只保存自己的 tasks/comate；父 tasks 只记录协调里程碑和子 change 引用。
4. 子 comate 只维护 `depends-on`；反向 blocks 由协调器推导。
5. 根页面/XML 只能有一个责任方。
6. 完成后运行 `coordination validate`。

## 何时暂停

- preflight 未完成。
- 页面结构、核心契约或 required 实现基线无法确定。
- 任一 required 尚未完成适用性分类，或项目规则与需求、官方状态、安全约束冲突。
- 需要 parallel，但用户尚未明确同意。

## 完成标准

- 父 artifacts 均由官方 status 判定为 done 或合法 skipped。
- tasks 足够小，依赖、范围和完成条件明确。
- single 不存在子映射；parallel 的子 change 和 DAG 均合法。
- 没有修改业务代码。

## 按需参考

- 设计源：`references/design-tools.md`
- 源码定位：`references/code-search.md`
- UI Knowledge：`references/ui-knowledge.md`
- 项目规则门禁（必读）：`references/project-rules.md`
- Android 实现约束：`references/android-quality.md`
- 并行拆解与协作：`references/coordination.md`
