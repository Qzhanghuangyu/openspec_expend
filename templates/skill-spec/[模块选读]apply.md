# [模块选读] Apply（实施）

## 目标

一次只完成一个可执行的最小 task，并立即把代码、验证结果和进度写回项目文件。
本阶段不重新分析需求、不重新拆分 change。

## 黄金规则

1. 一次只处理一个 ready task。
2. 只修改该 task 必需的文件、符号、资源、测试和配置。
3. 完成条件与最小验证满足后，立即把对应 checkbox 从 `[ ]` 改为 `[x]`。
4. 同步更新 handoff 后，才能开始下一个 task。
5. 未完成、验证失败或等待人工确认时，不得提前勾选或最后批量补勾。

只有两个 task 技术上不可分割时才能合并处理，并须在开始前把原因写入 handoff。

## 输入

- 官方 `status` 和 `instructions apply`。
- 当前 change 的 `tasks.md`、`comate.md`。
- 父 change 的 design、其中的设计源证据及项目规则审计；子 change 不复制父规划。
- 用户已经确认的决定。

## 必须执行

1. 从父 comate 读取执行模式：single 实施父 change；parallel 只实施已有逻辑子 change。
2. parallel 先 resolve；需要整体拓扑报告时运行 coordination validate。
3. 执行官方 status 和 instructions apply：`blocked` 停止，`all_done` 只复核，`ready` 才认领；
   复核发现既有完成证据失效时先按第 13 步协调回退，不直接 claim `done`。
4. 使用 coordination claim 认领；保留其锁内官方状态和依赖复核。
5. 必读 `references/project-rules.md`，重新读取当前项目规则并核对 design：每条 required 必须已有明确
   适用性结论；适用规则必须落实到当前 task。遗漏、条件变化或偏离时不修改代码，返回 Propose。
6. 读取 instructions 返回的 `operationGuidance`，只采纳不与官方状态、范围锁、Soul 和用户决定冲突的建议；
   不把 guidance 原文复制到代码、日志或 handoff。
7. 重新读取最新 tasks/comate，选择一个依赖已满足的最小未完成 task，并把编号、完成条件和编辑范围
   写入 handoff 的“当前任务”。
8. 只加载该 task 必需的 context、design 片段、项目规则、知识条目和源码证据。设计相关 task 先复用
   父 `design.md` 已保存的设计事实和资源清单；复用本地资源前核对文件存在且哈希吻合。缺少二进制、
   必要元数据、用户告知设计变化或要求以最新设计为准时，只重读已记录、已获用户授权的精确
   Figma node id，无需重贴链接。
   授权记录不明确、新节点或范围扩大时请求用户确认；重读有差异则回 Propose 修正 design。
9. 只做当前 task 的最小实现与足以证明完成条件的验证，不为后续 task 提前改动：跑通受影响方法；
   不默认新增单测，易回归纯状态逻辑优先复用现有测试。普通实施 task 先做轻量检查，不为每处
   XML/资源或代码修改重复调用 Gradle；有构建影响时，后续集成验证任务必须已在 tasks 中安排，
   任务 handoff 标记尚待集成验证，不声称构建通过。到达集成节点后按 `references/android-quality.md` 对交付
   variant 构建实际应用 APK（或按不适用条件验证模块）；整包成功无需重复运行资源与模块任务。
   资源任务或 Kotlin 编译不能替代 APK 构建，XML 语法校验和 R 生成也不能证明 AAPT 通过。
   `human` 模式由 Agent 列出当前任务的人工验证步骤，不冒充已执行；`hybrid`/`agent` 模式执行
   可完成的检查。普通任务只保证自身完成条件可测试，不重复安排生命周期、资源释放或 NPE 清单。
   到达 Propose 规划的收尾检查任务时，一次性核对最终代码的实际资源持有、所有权与释放路径；
   没有需要主动释放的资源则记录“不适用”，不添加多余回收逻辑。必要的静态或运行时检查无法
   执行时记录缺口并返回 Propose 补独立 `[人工]` 项，人工未反馈前不声称通过或“无泄漏”。
   UI 复现还须按 `references/android-quality.md` 对照 design 的关键节点文本规格：能运行时核对
   状态、文案、层级和可观察边界，先确认当前页面按宽适配是否生效、画布宽与基准宽能否按同数值
   dp 对照，再记录实际内容高度与 Insets；不把 `design_height_in_dp` 或设计画布高度当成实际高度，
   不按两者比例压缩整页。记录设备配置、设计/运行值的单位及差异；不能取得的事实标明
   待核对；若必要的运行时节点核对不可执行，将其留在独立 `[人工]` 项，不绑在 APK 构建任务上。
   不用文本核对、资源哈希或 APK 成功声称视觉一致。需要视觉复现验收时保持独立 `[人工]`
   项未完成，直到收到人工明确的页面/状态、区域、预期与实际及通过/待改的文字反馈；不索要或
   读取截图。缺少必要人工项则返回 Propose 补齐；视觉反馈未通过时修复后重新请求确认。
10. 勾选前按本 task 的代码差异逐项检查新增/实质修改的符号：需要说明职责、参数、状态或生命周期的
    已补注释；只有纯转发且无副作用的 override/getter/setter/委托可以注明具体理由豁免。
    方法短、编译通过或“简单方法”不是豁免理由。将已检查符号、已补注释和逐项豁免写入 handoff；
    缺注释或未审计时不勾选 task。
    注释中的事实应由源码证实；保护销毁后的 UI 不等于取消网络请求或证明无泄漏。
11. 当前 task 的完成条件满足后立即勾选并更新 handoff：已完成、修改文件、定向验证、
    安全结论、下一步和风险；只有收尾检查任务记录生命周期与资源释放核对结果。实施任务有待集成结果时，
    指向尚未完成的集成任务；集成任务只有实际构建通过才能勾选，记录命令、variant 和结果。
12. 状态落盘后重新读取 instructions/tasks，再选择下一个 ready task。
13. 若后续发现已勾选任务的完成条件被构建或运行错误推翻，先恢复该任务未完成并纠正 handoff，
    再按任务范围修复和复验；若 change 已是 `done`，先按 `references/coordination.md` 协调父子状态、
    下游依赖和原 owner，再撤销 checkbox；已归档时返回 Propose。不得保留失效的通过记录或以较弱
    的检查替代失败门禁。

## 何时暂停

- task、设计或 required 基线不明确：返回 propose 修正。
- task 部分完成或验证失败：保持 `in-progress`，记录失败证据和下一步，不勾选。
- 存在真实外部阻塞：设为 `blocked`，记录原因和恢复条件。
- 等待人工验证：保持 `in-progress` 和 `human-review: pending`。
- 上下文不足或即将压缩：先更新 handoff，停在已落盘的稳定边界。

## 完成标准

- 当前 task 的完成条件、逐符号注释审计和适用验证均满足，才可立即勾选。
- `[人工]` task 只依据人工明确反馈勾选；相关实现或环境变化后恢复 pending。
- `hybrid` 且当前 tasks 没有 `[人工]` 项时，可将 `human-review` 设为 `not-required`；有人工项须
  待反馈为 `passed`，`human` 模式始终须人工确认。
- 全部 tasks 完成且结构化 handoff 完整后，才可把 comate 设为 done。
- parallel 完成后重新运行 coordination validate。
- 不自动 archive、commit、push、merge 或 rebase。

## 按需参考

- 源码定位：`references/code-search.md`
- UI Knowledge：`references/ui-knowledge.md`
- 项目规则门禁（必读）：`references/project-rules.md`
- Android 质量、生命周期、安全和范围锁：`references/android-quality.md`
- 认领、依赖、检查点和人工验证：`references/coordination.md`
- 继续依赖设计节点时：`references/design-tools.md`
