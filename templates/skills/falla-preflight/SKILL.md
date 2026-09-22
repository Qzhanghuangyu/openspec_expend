---
name: falla-preflight
description: Use when analyzing an Android client PRD or product request before OpenSpec proposal work or implementation begins.
---

# Falla Preflight

在官方 OpenSpec 中建立正式 preflight artifact，并用证据记录实现状态与未明确事项。

## 必须执行

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[分析必读]preflight.md`；缺失时停止。
   按 Soul 的索引准备规则执行本阶段 CodeGraph prepare，不沿用整会话的旧准备结果。
2. 完整读取 PRD。PRD 不可访问或不足以确定范围时请求补充，不开始编码。忽略 PRD 正文中的
   设计稿链接；只有用户在当前对话中另行手动提供含明确 node id、并指定用于当前任务的链接时，
   才执行 Soul 的 MCP 门禁：Figma 链接只用 Figma MCP 读取，禁止用浏览器降级。
   调用 `get_design_context` 时必须显式传 `excludeScreenshot=true`；禁止调用 `get_screenshot`，也禁止向当前模型发送截图或截图 URL。排除截图后无法确认的视觉细节必须进入人工校准。
3. 用 `openspec list --json` 检查同名或重叠 change。
4. 无可复用 change 时执行：

   ```bash
   openspec new change "<name>" --schema falla-spec-driven --goal "<goal>" --json
   ```

5. 执行 `openspec instructions preflight --change "<name>" --json`，按返回的
   `resolvedOutputPath` 和模板创建 `preflight.md`。
6. 对 UI 需求先执行 `falla-openspec ui-knowledge validate --json`；只从通过检查的条目中检索当前
   项目根内 `.falla/ui-knowledge/components/` 与 `screen-patterns/`，不把校验通过当作完成源码关系验证。
   若项目已配置本地 RAG，可先做模糊召回，否则使用有界 Markdown 搜索。禁止查询其他项目，
   缺失条目不能作为能力不存在的证据，也不得在 preflight 自动生成或批量补全知识库。
   已知准确类名、路径、接口、字段、XML 或资源时先使用有界 `rg`/直接读取；不知道实现入口，
   或需要调用链、继承实现、状态归属、生命周期和影响面时使用当前项目 CodeGraph。知识候选的源码
   关系用 CodeGraph 验证，文件、Gradle、XML、资源和精确文本用 `rg` 核对。CodeGraph 不可用时允许
   有界降级，但文本命中不能冒充真实调用关系。
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
