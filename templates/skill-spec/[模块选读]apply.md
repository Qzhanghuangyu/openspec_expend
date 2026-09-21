# [模块选读] Apply（实施与协作分派）阶段约束

> 实施或继续实施某个父/子 change 时读取本文；只做规划或归档时不读。

## 目标与边界

把 propose 已规划的任务转化为经过验证的代码，并保证责任、进度和交接可追踪。
对应链路：`tasks → apply`。

- `single`：直接实施父 change。
- `parallel`：只实施 propose 已创建的子 change，并遵守既定依赖顺序。
- apply 不拆分、创建 change，也不切换执行模式。

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

- 读取官方 `contextFiles` 和 `context`；parallel 子 change 还需读取父 change 的规划
  artifacts，但不复制它们。
- `operationGuidance` 仅作建议，不能覆盖官方状态、编辑范围、Falla 门禁或用户选择。
- parallel 的子 change 必须是可独立认领、验证和交接的交付单元；实施前确认文件责任，
  避免多个执行者修改同一文件或公共接口。
- UI 实施前运行 `falla-openspec ui-knowledge validate --json`；只复用经过当前源码、
  依赖、资源、API 和生命周期核对的候选。
- 每次选择一项依赖已满足的任务：
  1. 使用 CodeGraph 定位符号、调用链、影响面和已有测试。
  2. 完成最小且聚焦的代码改动，不顺带重构。
  3. 检查空值、异常、并发、异步取消、资源释放、销毁后 UI 更新和敏感日志。
  4. 执行与改动匹配的最小 formatter、lint、测试或编译检查。
  5. 验证成功后才勾选 task，并简洁更新 handoff。
  6. 重新读取 `openspec instructions apply`，以最新状态继续。

## 3. comate 与暂停规则

`comate.md` 是 owner、状态、依赖和交接的协作事实：

- 使用 claim 认领，不手工覆盖他人的 owner。
- `depends-on` / `blocks` 必须与 propose 的拓扑关系一致，apply 不自行修改。
- blocked 或 done 时，handoff 必须记录完成内容、验证证据、生命周期与安全结论、
  遗留风险和恢复/接手条件。
- 不在 handoff 中写入凭据、敏感正文或完整 guidance。

任务不明确、设计冲突、验证失败或需要外部决策时停止猜测：

- 存在真实阻塞：置为 blocked，并记录原因和恢复条件。
- 只是用户中断或会话结束：保持 in-progress，记录安全检查点。
- 发现规划 artifact 有问题：建议返回对应规划阶段修正，不在 apply 中直接改写。

## 4. 完成标准

只有同时满足以下条件才能置为 done：

- 官方 instructions 为 `all_done`，tasks 全部勾选。
- 相关验证通过，handoff 完整。
- 生命周期、安全和人工视觉校准项已检查。
- parallel 重新通过 coordination validate，下游依赖可以继续实施。

最后向用户汇报完成任务、总体进度、验证结果、风险和下一步。
不得自动 archive、commit、push、merge 或 rebase。
