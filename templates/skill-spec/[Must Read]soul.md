# FallaOpenSpec 的灵魂（Soul）

> 按阶段读取规则；需要工具细节时再读对应 `references/`。

## 1. 职责

FallaOpenSpec 是面向 Android View 与 Jetpack Compose 的 OpenSpec 扩展。

官方 OpenSpec 管理 change、artifact DAG、status、instructions、validate、spec 同步和 archive；
Falla 补充 Android 决策、任务、认领、依赖和交接。

标准链路：

`preflight → proposal → specs → design → tasks → comate → apply → archive`

## 2. 当前阶段读什么

| 阶段 | 必读文件 |
| --- | --- |
| 需求分析 | `[分析必读]preflight.md` |
| 方案与拆解 | `[架构必读]propose.md` |
| 代码实施 | `[模块选读]apply.md` |
| 归档 | `[任务选读]archive.md` |

先读 Soul，再读当前阶段文件。Hook 已注入时不要重复读取。缺少必读文件时停止。
阶段文件要求使用某项能力时，再读取对应参考：

- `references/design-tools.md`：Figma 或其他设计源。
- `references/code-search.md`：CodeGraph、`rg`、Git 历史边界。
- `references/ui-knowledge.md`：项目 UI Knowledge 与 RAG。
- `references/project-rules.md`：Propose/Apply 强制读取的项目规则门禁。
- `references/android-quality.md`：代码质量、生命周期、安全和范围锁。
- `references/coordination.md`：single/parallel、认领、依赖、检查点和人工验证。

## 3. 唯一事实源

| 内容 | 事实源 |
| --- | --- |
| artifact 规划与生命周期 | 官方 OpenSpec status / instructions |
| 业务规格 | `openspec/specs/` |
| 实施任务与完成进度 | `tasks.md` checkbox |
| 父 change 执行模式 | 父 `comate.md` 的 `execution-mode` |
| 验证模式、人工验收、owner、协作状态与 handoff | 当前 change 的 `comate.md` |
| 子 change 正向依赖 | 子 `comate.md` 的 `depends-on` |
| 逻辑名到物理名 | `.falla/coordination.yaml` |

`tasks.md` 不保存执行模式或验证模式。新 comate 不保存 `blocks`；反向依赖由 `depends-on` 推导。
Skill 编排命令；Schema instruction 约束 artifact；模板提供结构。

## 4. 五条原则

1. **先分析再设计，先设计再实施。** 不在后续阶段偷偷补做或覆盖前一阶段决策。
2. **默认 single，显式 parallel。** 只有用户明确要求独立并行分派时才创建子 change。
3. **一次只完成一个 task。** 最小修改、最小验证，完成后立即勾选并更新 handoff，再进入下一项。
4. **AI 实施并验证可验证项，人工验收视觉和真实环境。** 未验证的不称通过。
5. **当前事实优先。** 当前源码与官方状态 > artifacts > handoff > 对话记忆。

## 5. 全局底线

- 不把推测写成已确认需求，不用模糊兜底代替产品决定。
- 只修改当前已确认需求和当前 task 必需的文件、符号、资源与测试，不顺带重构或修复无关问题。
- 不引入已知的泄漏或销毁后更新；有代码改动时，在 Propose 规划的收尾任务集中检查实际资源所有权，普通 task 不重复套生命周期清单。
- 不在日志、artifact、handoff 或回复中输出 token、密码、API Key、签名、完整 PRD、完整设计正文或
  临时资源 URL。
- 不自动 commit、push、merge、rebase、归档或代替人工验收。
- 规则冲突时优先级为：系统安全与用户明确决定 > Soul > 阶段规则 > Schema instruction > 模板。
