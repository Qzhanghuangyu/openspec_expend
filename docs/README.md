# 工作流文档索引

现行操作入口见 [README](../README.md) 和 [安装更新手册](installation-and-update.md)。
规则以当前安装的 `.falla/skill-spec/` 为准，版本和受管文件以 `.falla/install-manifest.json` 核对；
本目录的历史设计、计划、审计和验证记录不作为当前会话的执行授权，也不替代 tasks/comate 的完成证据。

## 当前调整与验证

- [2026-10-09 精简方案及实施进展](2026-10-09-falla-workflow-simplification-proposal.md)
- [第一步行为差分验证](2026-10-09-falla-workflow-simplification-validation.md)：合成走查与契约回归，未完成独立模型前后采样。
- [第二步规则导航与增量交接验证](2026-10-09-falla-workflow-recording-validation.md)

## 历史方案、审计与交接线索

以下记录只适用于各自日期的仓库状态；没有独立版本号的记录按日期和其中注明的提交定位，不能直接当作新版安装步骤。

| 日期 | 记录 | 当前使用方式 |
| --- | --- | --- |
| 2026-09-15 | [Android 工作流设计](superpowers/specs/2026-09-15-android-workflow-hardening-design.md)与[实施计划](superpowers/plans/2026-09-15-android-workflow-hardening.md) | 查询原始动机与实现线索，执行限制查现行规则 |
| 2026-09-28 | [验证修订计划](superpowers/plans/2026-09-28-workflow-validation-fixes.md) | 查询当时验证问题及修订范围 |
| 2026-09-29 | [规则权威位置调整](superpowers/plans/2026-09-29-workflow-rule-authority.md) | 查询规则归属演变，不复制历史操作清单 |
| 2026-09-30 | [基线设计](superpowers/specs/2026-09-30-w02-baseline-design.md)与[实施计划](superpowers/plans/2026-09-30-w02-baseline.md) | 查询基线协议来源，恢复按现行 coordination 执行 |
| 2026-09-30 | [工作流审计与修复记录](workflow-audit-2026-09-30.md) | 按修复进展和提交定位历史问题，原始发现不代表当前仍未修复 |

恢复某个真实 change 时，读取该项目官方 status/instructions、tasks、design、comate 与相关 diff；
历史文档只补背景，不能据此修改其他 owner、重编任务、刷新 hash 或认定旧人工结果仍有效。
