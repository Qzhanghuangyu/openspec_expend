# [任务选读] Archive（归档）阶段约束

Archive 使用官方 OpenSpec 完成 delta spec 同步与归档，不手动移动 change 目录。

## Figma 文本兼容模式

本阶段凡调用 Figma MCP 的 `get_design_context`，都必须显式传入
`excludeScreenshot=true`。禁止调用 `get_screenshot`，也禁止把截图、截图 URL、图片块或其他栅格化
预览送入当前模型。排除截图后无法确认的视觉细节必须记录为人工视觉校准项，不得通过浏览器或截图绕过。

## 1. 前置检查

1. 读取父 `tasks.md` / `comate.md` 的执行模式；字段缺失时检查 `.falla/coordination.yaml`，
   有该父 change 的子映射则按 parallel，否则按 single。
2. `openspec validate "<physical>" --strict --json --no-interactive`。
3. `openspec status --change "<physical>" --json`，汇总非 done/skipped artifact。
4. `openspec instructions archive --change "<physical>" --json`，读取 context，并只采纳适用且
   不冲突的 operationGuidance。
5. 统计 `tasks.md` 中未完成 checkbox。
6. 检查 `comate.md` 是否 done、handoff 是否完整。validation-mode=hybrid/human 时必须确认
   human-review=passed，且 `[人工]` tasks 都有人工明确反馈；pending/failed 时不得调用 Apply 代替
   人工测试，只展示验收清单并等待结果。
7. 仅 parallel 模式在父 change 归档前运行 coordination validate，确认所有子 change 完成或明确交接；
   single 模式直接检查父 change 的 tasks 与 comate。

这些结果是告警与决策材料，不得隐瞒。若存在问题，先展示问题及可能影响并请求用户
明确确认；不能自行把任务改为完成，也不能臆造 abandoned/cancelled 等 OpenSpec 未提供的流程。

## 2. Delta spec 与用户选择

- 从官方 status 的 `artifactPaths.specs.existingOutputPaths` 获取 delta 文件。
- 汇总将应用到 `openspec/specs/` 的新增、修改、移除和重命名，不输出无关正文。
- 用户可以选择先修复、继续归档、或明确跳过 spec 同步。
- 若 validate 失败但用户明确要求继续，官方命令必须显式使用 `--no-validate`；
  若用户选择不同步规格，显式使用 `--skip-specs`。不得静默添加这些参数。
- 不存在 `--skip-validate` 或 `--force` 例外；不得编造参数。
- 移除某能力最后一个 requirement 会删除主规格；只有用户明确确认退役时才设置
  `retire_capabilities: true`，不得从空 delta 或 guidance 自动推断。

## 3. 执行与完成

- 调用 `openspec archive "<physical>" --json`；已取得对应例外确认时才追加
  `--no-validate`、`--skip-specs` 或 `--yes`。
- single 模式只归档父 change；parallel 模式先分别归档子 change，再归档父 change。
- parallel 模式保留 coordination 映射；所有模式都保留归档目录内的 `comate.md` 审计记录。
- 官方命令失败时停止，不把错误解释为无 delta 或已归档。
- 展示 change、schema、官方归档位置、spec 同步情况和仍存在的告警。
