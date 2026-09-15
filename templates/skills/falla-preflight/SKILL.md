---
name: falla-preflight
description: Use when analyzing a PRD or product request before OpenSpec proposal work or implementation begins.
---

# Falla Preflight

在官方 OpenSpec 中建立正式 preflight artifact，并用证据记录实现状态与未明确事项。

## 必须执行

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[分析必读]preflight.md`；缺失时停止。
2. 完整读取 PRD。PRD 不可访问或不足以确定范围时请求补充，不开始编码。忽略 PRD 正文中的
   设计稿链接；只有用户在当前对话中另行手动提供含明确 node id、并指定用于当前任务的链接时，
   才执行 Soul 的 MCP 门禁：Figma 链接只用 Figma MCP 读取，禁止用浏览器降级。
3. 用 `openspec list --json` 检查同名或重叠 change。
4. 无可复用 change 时执行：

   ```bash
   openspec new change "<name>" --schema falla-spec-driven --goal "<goal>" --json
   ```

5. 执行 `openspec instructions preflight --change "<name>" --json`，按返回的
   `resolvedOutputPath` 和模板创建 `preflight.md`。
6. 对 UI 需求只检索当前项目根内 `.falla/ui-knowledge/components/` 与 `screen-patterns/` 的条目；
   若项目已配置本地 RAG，可先做模糊召回，否则使用有界 Markdown 搜索。禁止查询其他项目，
   缺失条目不能作为能力不存在的证据，也不得在 preflight 自动生成或批量补全知识库。
   对候选条目使用当前项目 CodeGraph 验证其源码符号、调用链和影响面，只读取命中的必要文件；
   XML、Gradle、资源和精确文本可使用有界 `rg`。CodeGraph 不可用时允许有界降级。
   只检查需求直接涉及的当前代码与文档；所有状态结论必须有文件、符号、模型、接口或测试
   证据。默认禁止 `git log`、`git show <commit>`、`git blame`、`git reflog`、`git rev-list` 等
   Git 历史读取。只有用户明确要求分析变更沿革、回归来源或具体提交时，才允许对相关路径执行
   一次有界批量查询；不得仓库级扫描或换参数重复读取历史。
7. 按三类检查维度、四类问题类型和三级阻塞级别记录问题；说明问题具体阻断的阶段，
   不把所有未决项一律阻断。
8. 执行 `openspec status --change "<name>" --json` 确认 preflight 为 done。

## 输出边界

- 本阶段只创建或更新 `preflight.md`。
- 不创建 proposal、specs、design、tasks、comate 或子 change。
- 不修改业务代码、构建配置或测试。
- 不把推测写成已确认需求，不输出凭据或无关文档正文。
