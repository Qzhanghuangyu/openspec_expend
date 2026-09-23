# [分析必读] Preflight（需求分析）

## 目标

回答三个问题：当前实现是什么、需求还缺什么、哪些问题会阻断后续设计。
本阶段只产出 `preflight.md`。

## 输入

- 用户提供的 PRD 或需求说明。
- 当前项目代码、接口、模型、测试和已有规格。
- 可选：用户在当时对话明确提供的设计节点，或本 change 已记录的“设计节点交接”。

## 必须执行

1. 完整读取需求；内容不可访问或不足以确定范围时请求补充。若来源是飞书文档/Wiki，
   还必须读取该 PRD 的评论和回复，不能只看正文或把评论 sidecar 丢掉：

   ```bash
   lark-cli docs +fetch --doc "<PRD URL>" --scope full
   lark-cli drive +list-comments --url "<PRD URL>" --solved-status all --comment-scope all
   # 对每个 comment_id：
   lark-cli drive +list-replies --url "<PRD URL>" --comment-id "<id>"
   ```

   `docs +fetch` 的 `reference_map.comments` 可辅助定位，但不代替评论列表。沿返回的
   `--page-token` 读取全部评论及每条评论的回复；区分已解决/未解决、正文锚点、
   回复中的澄清与决策。
   记录正文版本和评论核对时间；读取期间版本变化或用户指出评论更新时重新核对。
   评论接口无权限、失败或分页/截断未补齐时，不把“没有读到”写成“没有评论”，暂停并报告恢复条件。
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

5. 只调查需求直接涉及的范围，并用文件、符号、模型、接口或测试支撑实现状态。
6. 检查：
   - Stateful Interactions：加载、成功、空、失败、权限、弱网、重试、前后台和进程重建。
   - Boundary and Exception Cases：边界值、空值、重复操作、兼容、灰度、降级和错误码。
   - Code Compatibility Gaps：需求与现有模型、接口、权限、架构及模块边界的差异。
7. 对照正文与评论完整线程理解需求：明确确认的澄清与正文合并为当前需求口径，并落实到受影响
   需求项；“已解决”不等于已确认。未决意见、相互矛盾的回复或没有决策依据的建议不自动覆盖正文，
   按 `Decision Required` 或 `Conflict` 记录。
   在 preflight 记评论 ID/位置、解决状态和精简结论，不复制整段评论或个人信息。
   每个问题标记 `Missing Definition / Conflict / Implementation Risk / Decision Required`，以及
   `Blocker / Major / Minor`，并说明具体阻断的 artifact 或实施决策。
8. 如果用户在当前对话明确提供用于此 change 的 Figma 节点，把授权范围、日期、file key 和精确
   node id 写入 `preflight.md` 的“设计节点交接”。只保存稳定引用和必要的分析状态，不保留原始链接或
   凭据；读取失败也要记录脱敏原因与恢复条件。不得从 PRD 链接推断授权。
9. 写入官方返回的 `resolvedOutputPath`，再运行 status 确认 preflight 为 `done`。

## 何时暂停

- PRD 不完整或不可访问；飞书 PRD 的评论/回复因权限、截断或分页失败而无法核对。
- Blocker 会阻止 proposal、spec、design 或任务拆解。
- 结论只能依赖猜测，无法获得当前代码或接口证据。

未阻断后续决策的问题继续记录在 preflight 中，不要求全部提前解决。

## 完成标准

- `preflight.md` 已创建，即使没有问题也有明确结论。
- 每个实现状态都有证据，每个问题都有类型、级别、影响和建议确认项；飞书 PRD 记录评论
  读取范围、已解决/未解决状态、对正文的影响和未决争议。
- 未创建其他 artifact、子 change，也未修改业务代码、构建配置或测试。

## 按需参考

- 源码定位或 Git 边界：`references/code-search.md`
- UI Knowledge：`references/ui-knowledge.md`
- 用户明确提供设计节点：`references/design-tools.md`
