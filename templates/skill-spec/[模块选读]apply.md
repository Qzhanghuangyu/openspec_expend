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
3. 执行官方 status 和 instructions apply：`blocked` 停止，`all_done` 只复核，`ready` 才认领。
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
   不默认新增单测，按需复用现有测试。签名、资源、XML 或构建配置变化做受影响模块编译；不机械
   运行全量检查或扩写状态矩阵。`human` 模式由 Agent 列出上述检查的人工步骤，不冒充已执行；
   `hybrid`/`agent` 模式由 Agent 执行可完成的检查。页面改动静态核对退出时任务、监听器、资源释放
   和 NPE；需要证明释放行为时做运行时退出检查，记录设备、步骤与结果。静态核对、单测和编译均
   不能证明无泄漏；未实测不称“无泄漏”。所需实测无法执行时记录原因与恢复条件；由独立 `[人工]`
   项承接实测。Agent 已完成的其他验证可以勾选，该人工项保持未完成。若规划中缺少或把实测绑在
   无法完成的自动验证项里，返回 Propose 调整 tasks，不以 `not-required` 绕过。
10. 勾选前按本 task 的代码差异逐项检查新增/实质修改的符号：需要说明职责、参数、状态或生命周期的
    已补注释；只有纯转发且无副作用的 override/getter/setter/委托可以注明具体理由豁免。
    方法短、编译通过或“简单方法”不是豁免理由。将已检查符号、已补注释和逐项豁免写入 handoff；
    缺注释或未审计时不勾选 task。
11. 验证通过且上述条件满足后立即勾选该 task，并立即更新 handoff：已完成、修改文件、定向验证、
    静态生命周期核对与运行时退出结果（未执行注明原因）、安全结论、下一步和风险。
12. 状态落盘后重新读取 instructions/tasks，再选择下一个 ready task。

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
