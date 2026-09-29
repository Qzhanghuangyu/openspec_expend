# [分析必读] Preflight（需求分析）

## 目标

核对当前实现、需求缺口和设计阻断项；正式 artifact 只产出 `preflight.md`，必要取证引用留在父 change 的 Agent 工作文件。

## 输入

- 用户提供的 PRD 或需求说明。
- 当前项目代码、接口、模型、测试和已有规格。
- 已有父 change 的 `prd-source.md`（若有在线 PRD 取证）及设计源引用。
- 可选：用户在当时对话明确提供的设计节点，或本 change 的 `design-source.md`。

## 必须执行

1. 读取完整需求；不可访问或范围不明时请求补充。飞书文档/Wiki PRD 还须读取评论和回复：

   ```bash
   lark-cli docs +fetch --doc "<PRD URL>" --scope full
   lark-cli drive +list-comments --url "<PRD URL>" --solved-status all --comment-scope all
   # 对每个 comment_id：
   lark-cli drive +list-replies --url "<PRD URL>" --comment-id "<id>"
   ```

   `reference_map.comments` 只辅助定位；沿 `--page-token` 读取全部评论和回复，区分解决状态、
   正文锚点、澄清与决策。
   记录正文版本和评论核对时间到父 change 的 `prd-source.md`；读取期间版本变化或用户指出评论更新时重新核对。
   评论接口无权限、失败或分页/截断未补齐时暂停，报告恢复条件，不声称没有评论。
   仅访问当前 PRD，不扩大到同一知识空间里的其他文档。
2. 执行 `openspec list --json`，优先复用同名或范围重叠的父 change。
3. 不存在可复用 change 时创建：

   ```bash
   openspec new change "<name>" --schema falla-spec-driven --goal "<goal>" --json
   ```

4. 获取官方写作指引：

   ```bash
   openspec instructions preflight --change "<name>" --json
   ```

5. 只调查需求范围，以文件、符号、模型、接口或测试支撑实现状态。
   区分可观察结果与实现建议；第三方 API 行为须核实，不凭名称推断。
6. 只核对方法主干能否执行及接口或架构的硬性冲突，不预设生命周期或 NPE 检查清单；
   只有 PRD 明确要求或源码已证实的问题才记录。不按 Stateful Interactions 或 Boundary and Exception Cases 枚举场景。
7. 将已确认的评论澄清并入对应需求项；“已解决”不等于已确认。未决、矛盾或无决策依据的建议不覆盖正文，
   按 `Decision Required` 或 `Conflict` 记录。
   将长评论 ID、位置、解决状态、回复完整性和精简取证结论只记入父 change 的 `prd-source.md`；
   `preflight.md` 仅用章节/问题主题描述已确认结论与未决事项，不复制机器 ID；
   不复制整段评论或个人信息。
   取证文件不是凭据仓库：不保存原始 URL、cookie、认证 token、回复全文或临时链接。
   按 Schema 模板创建取证文件，只接受项目内普通文件，不跟随符号链接；无在线 PRD 时不创建。
   每个问题标记 `Missing Definition / Conflict / Implementation Risk / Decision Required`，以及
   `Blocker / Major / Minor`，并说明具体阻断的 artifact 或实施决策。
8. 涉及授权设计节点时，必须读取 `references/design-tools.md`，按其中取证交接规则创建或更新父
   `design-source.md`；本阶段仅填必要的分析事实和缺口，不冒充完整设计。
9. 写入官方 `resolvedOutputPath`，运行 status 确认 preflight 为 `done`。
   用户答复阻塞问题后只更新当前 `preflight.md` 的结论与取证文件，复核 status 后结束本阶段；
   不以 Blocker 已解决或 proposal 就绪为由自动运行 Propose/Apply。

## 何时暂停

- PRD 不完整或不可访问；飞书 PRD 的评论/回复因权限、截断或分页失败而无法核对。
- Blocker 会阻止 proposal、spec、design 或任务拆解。
- 结论只能依赖猜测，无法获得当前代码或接口证据。

未阻断后续决策的问题继续记录在 preflight 中，不要求全部提前解决。

## 完成标准

- `preflight.md` 有明确结论，包括无问题时。
- 每个实现状态都有证据，每个问题都有类型、级别、影响和建议确认项；飞书 PRD 记录评论
  读取范围、已解决/未解决状态、对正文的影响和未决争议。
- 未创建其他正式 artifact 或子 change；取证文件仅含最小定位信息，不写凭据或评论全文。
- 未修改业务代码、构建配置或测试。
- 已反馈剩余阻塞项和下一阶段可否进入；停在 Preflight，等待用户手动发起 Propose。

## 按需参考

- 源码定位或 Git 边界：`references/code-search.md`
- UI Knowledge：`references/ui-knowledge.md`
- 用户明确提供设计节点：`references/design-tools.md`
