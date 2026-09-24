# comate

> `hybrid` 无 `[人工]` task 时将 human-review 设为 `not-required`；有人工 task 保持 `pending`，
> 仅依据人工反馈改为 `passed`。`human` 模式始终需要人工确认。

- 格式版本 (format-version): 2
- 执行模式 (execution-mode): single
- 负责人 (owner): unassigned
- 状态 (status): todo
- 验证模式 (validation-mode): hybrid
- 人工验证状态 (human-review): pending
- 依赖 (depends-on): []
- 交接 (handoff):
  - 当前任务：
  - 已确认事实与关键决策：
  - 设计基线符合性：
  - 项目规则符合性：
  - 注释审计：
    - 已检查文件/符号（本 task 新增/实质修改，逐项列出）：
    - 已补注释的符号与说明：
    - 参数与生命周期说明：
    - 豁免项及原因（逐符号列出；没有则写无）：
  - 已修改文件：
  - 已完成：
  - 人工验证清单：
  - 人工验证反馈：
    - UI 视觉（适用时填人工确认的页面/状态、设备配置、区域、预期与实际、通过或待改；不传截图）：
  - 验证证据：
    - 定向测试 / 受影响模块编译（不适用写原因）：
    - 生命周期与资源释放收尾检查（有代码改动时填写；无须主动释放写不适用）：
    - 命令：
    - variant / 设备：
    - 结果：
  - 安全与敏感信息结论：
  - 下一步准确操作：
  - 遗留风险与恢复条件：
