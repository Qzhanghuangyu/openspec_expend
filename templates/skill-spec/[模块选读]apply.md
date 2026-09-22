# [模块选读] Apply（实施）阶段约束

Apply 只实施 propose 已建立的计划，不重新做需求分析或任务拆分。通用工具、安全、生命周期、范围锁、
项目规则、Figma 和 CodeGraph 规则统一继承 `[Must Read]soul.md`。

## 1. 事实源与前置检查

- 官方 status/instructions：规划状态和 apply 可执行状态。
- `tasks.md`：实施任务及 checkbox 进度。
- 当前 `comate.md`：执行模式、验证模式、人工验证、owner、协作状态、依赖和 handoff。
- `.falla/coordination.yaml`：只保存 parallel 逻辑名到物理名映射。

执行顺序：

1. 从父 comate 读取 `execution-mode`；不得从 tasks 推断或在 apply 中切换。
2. parallel 解析逻辑子 change；需要整体拓扑报告时执行 coordination validate。
3. 执行官方 status 和 instructions apply。`blocked` 停止，`all_done` 只复核，`ready` 才认领。
4. claim 在项目锁内重新检查官方状态、owner 和上游依赖；这项复核不得省略。
5. 从当前 comate 读取 `validation-mode`；缺失属于旧记录，只能按 hybrid 兼容并提示迁移。
6. 逐条处理 instructions 返回的 `operationGuidance`；只采纳适用且不与官方状态、范围锁、Soul 或用户
   决定冲突的建议，不复制其原文到代码、日志或 handoff。

`doctor` 用于安装、升级和排障，不作为每次 apply 的固定前置。当前 change 使用上述定向检查，
UI Knowledge 或 CodeGraph 只有在本任务实际需要时才检查。

## 2. 单任务原子循环

apply 必须一次只推进一个当前可执行的最小 task，不得先完成多个 task、最后再批量勾选。只有两个 task
技术上不可分割时才可合并处理，并在开始前把原因写入 handoff。每轮严格执行：

1. 重新读取最新 `tasks.md` 与 `comate.md`，按依赖选择一个未完成且当前 ready 的最小 task，并把其编号、
   完成条件和允许编辑范围写入 handoff 的“当前任务”。
2. 读取该 task 所需的官方 `contextFiles`、父 design 和用户确认内容，建立仅覆盖该 task 的范围锁。不得
   为后续 task 提前修改代码、资源、测试或配置。
3. 复核 design 中与该 task 直接相关的结构基线、required 实现基线和 required 项目规则。apply 只验证
   引用是否仍有效，不重新开展完整方案探索；源码或规则已变化时暂停并返回 propose。
4. 完成该 task 的最小代码改动，只格式化该 task 触及的文件。
5. 按 Soul 的实现质量门禁检查注释、XML、空值、异常、并发、异步取消、资源释放、销毁后 UI 更新和
   敏感信息；根据验证模式运行足以证明该 task 完成的最小验证。已有与当前代码版本一致的证据时不重复运行。
6. 只有该 task 的完成条件和适用验证均满足后，立即把对应 checkbox 从 `[ ]` 改为 `[x]`，并立即更新
   handoff 的已完成内容、修改文件、验证证据、生命周期/安全结论、下一步和风险。不得等待其他 task
   完成后批量勾选，也不得先勾选再补实现或验证。
7. task 部分完成、验证失败或遇到阻塞时不得勾选；保留 `in-progress` 或按真实阻塞设为 `blocked`，并
   立即记录已完成部分、失败证据和恢复条件。`[人工]` task 只能依据人工明确反馈更新。
8. 当前 task 状态和 handoff 已落盘后，重新读取 `openspec instructions apply` 和 tasks，再决定是否进入
   下一个 ready task。上下文不足或即将压缩时先停止在这个稳定边界，不携带未落盘进度继续。

## 3. 暂停、人工验证与完成

- 真实阻塞：设为 `blocked`，handoff 记录原因和恢复条件。
- 用户中断或会话结束：保持 `in-progress`，记录安全检查点。
- 规划错误或 required 基线需要变化：停止修改并返回 propose。
- hybrid/human 等待人工验证时保持 `in-progress` 和 `human-review: pending`。
- 人工失败设为 `failed`，只修复明确失败项；全部通过后设为 `passed`。相关代码、资源、配置或环境变化后
  恢复 pending。
- done 前必须满足：tasks 全部完成、适用自动验证通过、人工门禁满足、结构化 handoff 完整；parallel
  还必须通过 coordination validate。

## 4. Handoff

handoff 是滚动检查点，不是流水账。done 时必须完整填写：已完成、注释审计、验证证据、生命周期结论、
安全与敏感信息结论、遗留风险与恢复条件；hybrid/human 还必须填写人工验证反馈。不得写入凭据、
临时资源 URL、完整 PRD、完整 guidance 或大段源码。
