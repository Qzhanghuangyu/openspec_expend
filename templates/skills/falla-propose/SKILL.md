---
name: falla-propose
description: Use when an existing Android Falla preflight change needs proposal artifacts, architecture planning, or explicitly requested parallel child-change decomposition.
---

# Falla Propose

把已有 preflight 转为官方 OpenSpec artifacts；默认保留单一 change，按用户明确要求启用并行子 change DAG。

## 必须执行

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[架构必读]propose.md`；缺失时停止。按 Soul 的索引准备规则执行本阶段
   CodeGraph prepare。
2. 通过 `openspec status --change "<parent>" --json` 复用已有父 change；`preflight`
   未 done 时停止，不能只检查目录。阶段中收到或继续依赖设计稿链接时执行 Soul 的 MCP 门禁：
   Figma 链接只用 Figma MCP 读取，禁止用浏览器降级。
   调用 `get_design_context` 时必须显式传 `excludeScreenshot=true`；禁止调用 `get_screenshot`，也禁止向当前模型发送截图或截图 URL。排除截图后无法确认的视觉细节必须进入人工校准。
3. 按官方状态依次调用：

   ```bash
   openspec instructions <proposal|specs|design|tasks|comate> --change "<parent>" --json
   ```

   使用返回的模板、依赖和 `resolvedOutputPath`，不猜路径。若项目存在
   `.falla/project-rules/`，在创建设计和任务前按文件名排序读取其顶层普通 `.md` 文件，再筛选
   当前需求适用规则；`index.md` 仅作可选导航，required 项目规则不得依赖 RAG 召回或被忽略。
4. proposal/specs 只描述用户可观察的业务能力。新建或重构页面时，已知准确参考类或文件先用
   `rg`/直接读取；不知道同类实现入口，或需要组件调用、继承、状态归属和生命周期时使用 CodeGraph。
   在 design 中明确“页面实现结构基线”：页面承载方式、文件归属、导航入口、ViewModel 作用域，
   以及 XML / Compose 的根节点、层级、滚动与状态容器、组件复用、Insets 和生命周期所有者；
   XML 需给出简明节点树。无法确定结构基线时保留开放问题，不生成可直接实施的下游任务。
   design 还必须记录当前需求命中的项目规则 ID、级别、适用对象、落地方式和例外，并将 required
   项目规则转成 tasks 前置条件和完成检查。design 还必须为当前 change 新增或实质修改的类、方法、
   参数、状态字段、资源所有者、非直观常量和复杂 Lambda 建立注释与可维护性契约。对 design 引用的
   UI Knowledge 或源码方案，逐个实现对象
   记录 `required`、`preferred` 或
   `reference-only`，以及选定类/基类/API、禁止替代和例外处理。required 只能在当前源码验证后确定；
   apply 如需偏离必须先返回 propose 更新 design。再按 MVVM 拆 ViewModel 与 View，把 UI 拆到模块
   控件，并明确人工视觉校准项。先执行
   `falla-openspec ui-knowledge validate --json`，只从通过检查的条目中检索当前项目的
   `.falla/ui-knowledge/`；RAG 命中的候选必须再由当前项目 CodeGraph 验证源码符号、调用关系和
   影响面，并核对依赖、资源、生命周期和验证日期后才能作为复用依据。缺失、跨项目或过期条目
   只能作为无效候选，回到当前代码和设计事实，不自动生成项目知识库。
   若是纯重构、工具或文档变更且没有规格级行为变化，在 `.openspec.yaml` 显式设置
   `skip_specs: true`，并接受官方 status 将 specs 标为 `skipped`；不得伪造空 requirement。
5. tasks 写入验证模式，默认 `hybrid`：Agent 负责 formatter、lint、单元测试、编译及静态检查，人工
   负责真机、真实服务端联调和视觉验收。只有用户明确要求时才改为 `human` 或 `agent`。所有 `[人工]`
   项必须写明前置条件、操作步骤、预期结果、variant/设备和服务端依赖。tasks 只覆盖当前已确认需求并写明允许编辑范围。
   CodeGraph、UI Knowledge、lint 或现有代码中发现的无关问题不得追加为重构、迁移、升级、清理或
   告警修复任务。tasks 必须包含 Agent 注释审计项：根据当前 diff 生成变更符号清单，逐项核对职责、
   参数、状态字段、生命周期、常量和复杂 Lambda，豁免必须记录原因。tasks 使用 checkbox 和逻辑依赖，
   形成“结构基线复核与最小可编译骨架 → 契约 → 控件并行 →
   组装 → 联调”的 DAG。每项任务必须能在一次独立实施上下文内完成定位、修改、验证和交接，
   并写明输入、编辑范围、完成条件和前置依赖；跨度过大时继续拆 task。下游任务不得绕过结构基线；
   parallel 模式必须明确根页面/XML 的唯一修改责任，依赖根结构或页面契约的子 change 必须等待
   对应前置任务完成。
6. 选择执行模式并写入父 `tasks.md` 和 `comate.md`：
   - 新 change 默认使用 `single`。ViewModel、View、控件、组装和联调只是父 change 内的任务组；
     不调用 coordination，不创建额外 change 目录。
   - 重跑已有 change 时，若 `.falla/coordination.yaml` 已有该父 change 的映射，则沿用 `parallel`
     并复用已有子 change，不得降级或重复创建。
   - 只有用户明确要求多人/多 agent 并行、创建子 change 或独立分派时，才使用
     `parallel`。AI 可以建议一次，但未得到明确确认时仍使用 single；任务较多、存在 MVVM
     分层或理论上可并行，都不能由 AI 自行升级执行模式。
7. 仅在 parallel 模式下为独立认领、独立验证和独立交接的交付单元创建子 change：

   逻辑名必须恰好是两个 kebab-case 段：`<parent>/<child>`。View 只是任务类别，
   不能再形成第三层；例如 `medal/view-model`、`medal/top-bar`、`medal/list-card`。
   默认物理名格式中间的 `child` 是固定字面量：`<parent>-child-<child>`。
   例如 `medal/view-model` → `medal-child-view-model`，
   `medal/top-bar` → `medal-child-top-bar`。名称每段只使用小写字母、数字和单连字符，
   与 OpenSpec 1.12 一致允许数字开头。
   仅同名冲突时由协调工具追加 8 位哈希。
   不自行生成后缀，最终物理名只能采用 register 的 JSON 返回值。

   ```bash
   falla-openspec coordination register "<parent>/<child>" --json
   openspec new change "<physical>" --schema falla-task-driven --json
   openspec instructions tasks --change "<physical>" --json
   openspec instructions comate --change "<physical>" --json
   ```

   若官方 `new change` 失败，先检查返回的物理 change 是否已经落盘。只有物理 change
   完全不存在时才可显式运行：

   ```bash
   falla-openspec coordination unregister "<parent>/<child>" --json
   ```

   物理 change 已存在时 unregister 会拒绝，不能删除文件或使用 force。

8. 仅在 parallel 模式下让 `comate.md` 使用逻辑名记录双向 `depends-on` / `blocks`，并执行：

   ```bash
   falla-openspec coordination validate --change "<parent>" --json
   ```

## 完成边界

- 默认 single 模式只生成父 change，不生成子 change 或 coordination 映射。
- parallel 模式的物理子 change 位于 `openspec/changes/` 顶层；逻辑引用保持 `<parent>/<child>`。
- apply 阶段不再创建、拆分子 change 或切换执行模式。
- DAG 校验失败、映射缺失或官方命令失败时停止，不手工嵌套目录、不伪造完成状态。
- 不在 propose 阶段修改业务代码。
