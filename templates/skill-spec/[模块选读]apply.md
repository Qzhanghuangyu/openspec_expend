# [模块选读] Apply（实施与协作分派）阶段约束

> 实施或继续实施某个父/子 change 时读取本文；只做规划或归档时不读。

## 目标与边界

把 propose 已规划的任务转化为经过验证的代码，并保证责任、进度和交接可追踪。
对应链路：`tasks → apply`。

- `single`：直接实施父 change。
- `parallel`：只实施 propose 已创建的子 change，并遵守既定依赖顺序。
- 不在此阶段拆分、创建 change 或切换执行模式。

## Figma 文本兼容模式

调用 Figma MCP 的 `get_design_context` 时必须传入 `excludeScreenshot=true`。
禁止调用 `get_screenshot`，也不得通过浏览器或其他方式向当前模型提供截图。
无法确认的视觉细节记录为人工视觉校准项。

## 1. 开始门禁

1. 读取全局规则和本文，不重跑 preflight、propose 或 archive。
2. 确定 change：
   - 用户已指定或上下文唯一时直接使用，并输出 `使用变更：<name>`。
   - 无法唯一确定时执行 `openspec list --json`；多个候选时请用户选择，不得猜测。
3. 从父 `tasks.md` / `comate.md` 确认执行模式；缺失时检查
   `.falla/coordination.yaml`，不得自行升级为 parallel。
4. parallel 使用逻辑名 `<parent>/<child>`，通过以下命令获取物理名：

   ```bash
   falla-openspec coordination resolve "<parent>/<child>" --json
   ```

5. 执行：

   ```bash
   falla-openspec doctor --json
   ```

   parallel 还需执行：

   ```bash
   falla-openspec coordination validate --change "<parent>" --json
   ```

   当前 change 异常、依赖未完成或 DAG 校验失败时停止。

6. 使用物理名读取官方状态：

   ```bash
   openspec status --change "<physical>" --json
   openspec instructions apply --change "<physical>" --json
   ```

   - `blocked`：报告缺失项和恢复条件，不修改业务代码。
   - `all_done`：不重复实施，只核对验证和交接。
   - `ready`：输出 change、执行模式和进度，然后认领：

     ```bash
     falla-openspec coordination claim "<change>" --owner "<id>" --json
     ```

   single 使用父名，parallel 使用逻辑子名。认领冲突时停止，不直接修改 owner。

## 2. 实施与协作

- 读取官方 `contextFiles` 和 `context`；parallel 子 change 还需读取父 change 的规划 artifacts，但不
  复制它们。读取 tasks 的验证模式；字段缺失时按 `hybrid` 处理，不得自行切换模式。
- `operationGuidance` 仅作建议，不能覆盖官方状态、编辑范围、Falla 门禁或用户选择。
- 开始实施前从当前 task、design 和用户确认内容建立范围锁，只修改完成当前需求所必需的文件、符号、
  资源和测试。不得顺带重构、抽象、重命名、迁移资源、升级依赖、替换架构、统一风格或修复无关告警。
  UI Knowledge、项目规则、CodeGraph、lint 和测试发现的既有问题只记录为风险，不自动整改。
- 如果当前任务必须扩大范围才能正确完成，先停止并说明新增范围、原因、影响和验证方式，返回 propose
  更新 design/tasks 或请求用户确认；仅可直接修复由当前改动造成的编译、测试、安全或生命周期问题。
- 如果存在 `.falla/project-rules/`，必须按文件名排序读取其顶层普通 `.md` 文件，判断当前任务适用
  规则并与 design 绑定交叉核对；`index.md` 仅作可选导航，项目规则不依赖 RAG 召回。适用的
  `required` 规则未绑定到 design 时先返回 propose；`required` 必须遵守，`preferred` 偏离时记录原因，
  `reference-only` 只参考；需要偏离 required 时，在修改代码前停止并返回 propose 记录例外。
- 实施前从 design 提取已确认实现基线，并逐项核对具体实现对象、Knowledge/源码证据、约束级别、
  选定类/基类/API、禁止替代和例外处理。`required` 是硬约束；`preferred` 偏离时记录原因；
  `reference-only` 只参考思路。design 已绑定具体知识条目时必须读取该条目及其当前源码证据，不能
  只做泛化检索。lint、性能微优化、个人偏好或通用最佳实践不能覆盖 required 基线；认为必须偏离时，
  在修改代码前停止并返回 propose 更新 design。
- 新建或重构页面时，先确认 design 已给出页面实现结构基线，包括页面承载方式、文件归属、
  XML / Compose 节点结构、状态容器、ViewModel 作用域和生命周期所有者；缺失或与当前源码冲突时
  停止实施并返回 propose 修正。
- parallel 的子 change 必须是可独立认领、验证和交接的交付单元；实施前确认文件责任，
  避免多个执行者修改同一文件或公共接口。
- UI 实施前运行 `falla-openspec ui-knowledge validate --json`；只复用经过当前源码、
  依赖、资源、API 和生命周期核对的候选。
- 每次选择一项依赖已满足的任务：
  1. task 已给出准确类、方法、路径、资源或 API 时，先用有界 `rg`/直接读取完成定位和精确核对；
     不知道实现入口，或需要调用链、继承实现、动态分派、生命周期、影响面和受影响测试时使用
     CodeGraph。修改公共或跨模块符号前必须用 CodeGraph 检查影响面；不机械地同时调用两种工具。
  2. 完成最小且聚焦的代码改动，不顺带重构；只格式化当前 change 触及的文件。
  3. Android XML 必须保持属性逐行和层级缩进。根据当前 diff 生成变更符号清单，覆盖新增或实质
     修改的类、方法、参数、状态字段、资源所有者、非直观常量和复杂 Lambda，并逐项完成注释审计。
     类说明职责与边界；方法说明用途、关键分支、副作用和“为什么”；参数逐项说明业务含义、单位/
     范围、可空性、所有权或回调时机；必要时说明返回值、异常、线程和生命周期。公共 API 使用
     KDoc/JavaDoc 的 `@property`、`@param` 等。含自定义状态、资源或生命周期逻辑的 override 不得豁免；
     简单无副作用 override/getter/setter/委托可豁免但必须记录原因。复杂 Lambda 应提取命名方法或
     明确参数语义。禁止逐行翻译、重复名称或类型的噪声注释。
  4. 检查空值、异常、并发、异步取消、资源释放、销毁后 UI 更新和敏感日志。
  5. hybrid 模式执行与改动匹配的 formatter、lint、单元测试、编译和静态检查；不执行真机、真实
     服务端联调或视觉验收。human 模式不主动运行验证，agent 模式执行工具可完成的验证。已经有与
     当前代码版本一致的有效证据时不得无意义重复运行。
  6. 在 hybrid/agent 模式下，已知继承声明、组件名、资源和关键 API 时用有界 `rg` 精确检查；需要
     确认真实调用方、间接实现或影响面时使用 CodeGraph。检查结果必须与 required 基线一致，并检查
     实际 diff 符合 design 绑定的 required 项目规则；将 Rule ID 和符合性证据写入 handoff。
     发现偏离时不勾选 task，先返回 propose。
  7. 实施和自动验证任务完成后同步勾选；带 `[人工]` 的任务只能依据人工明确反馈同步，Agent 不自行
     执行、推定或批量勾选。hybrid/human 模式完成 Agent 职责后保持 in-progress，并将 human-review 置为 pending。
  8. 收到人工反馈后记录 reviewer、日期、环境和逐项结果：失败则 human-review=failed，只修复明确
     失败项；全部通过才设为 passed。相关代码、资源、配置或验证环境变化后，受影响项恢复 pending。
  9. 重新读取 `openspec instructions apply`，以最新状态继续。

## 3. comate、检查点与暂停规则

`comate.md` 是 owner、状态、依赖、交接和长任务恢复的持久事实：

- 使用 claim 认领，不手工覆盖他人的 owner。validation-mode=hybrid/human 时，human-review 初始为 pending。
- `depends-on` / `blocks` 必须与 propose 的拓扑关系一致，apply 不自行修改。
- blocked 或 done 时，handoff 必须记录完成内容、注释审计、验证证据、生命周期与安全结论、
  遗留风险和恢复/接手条件。
- handoff 维护滚动检查点，只保留当前任务、已确认事实与关键决策、已修改文件、验证结果、
  下一步和风险，不追加流水账，也不写入凭据、敏感正文、完整 guidance 或大段源码。
- 完成分析、开始跨文件修改、完成一组修改、开始耗时验证、获得验证结果或即将暂停时更新检查点。
- 上下文压缩或重新进入任务后，不依赖对话记忆直接继续；依次读取官方 status/instructions、
  tasks、design、comate、`git status --short` 和相关 diff，再用 CodeGraph 复核符号与调用关系。
  事实优先级为：
  当前源码与官方状态 > artifacts > handoff > 对话记忆。
- parallel 执行者只更新自己的子 change comate；父 comate 只维护整体汇总，避免并发覆盖。

任务不明确、设计冲突、验证失败或需要外部决策时停止猜测：

- 存在真实阻塞：置为 blocked，并记录原因和恢复条件。
- 只是用户中断或会话结束：保持 in-progress，记录安全检查点。
- 发现规划 artifact 有问题：建议返回对应规划阶段修正，不在 apply 中直接改写。

## 4. 完成标准

只有同时满足以下条件才能置为 done：

- 官方 instructions 为 `all_done`，tasks 全部勾选。
- hybrid/human 模式的 human-review 为 passed，且所有 `[人工]` task 都有人工明确反馈；Agent 不重复
  执行真机、真实服务端联调或视觉验收。
- hybrid/agent 模式的自动化验证通过，handoff 完整。
- 生命周期、安全和人工视觉校准项已检查。
- parallel 重新通过 coordination validate，下游依赖可以继续实施。

最后向用户汇报完成任务、总体进度、验证结果、风险和下一步。
不得自动 archive、commit、push、merge 或 rebase。
