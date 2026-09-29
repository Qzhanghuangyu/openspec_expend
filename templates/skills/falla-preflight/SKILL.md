---
name: falla-preflight
description: Use when analyzing an Android client PRD or product request before OpenSpec proposal work or implementation begins.
---

# Falla Preflight

为 Android 需求创建或复用父 change，并只产出正式 `preflight.md`。

## 权威规则

执行前确认已加载：

- `.falla/skill-spec/[Must Read]soul.md`
- `.falla/skill-spec/[分析必读]preflight.md`

运行环境已经通过 Hook 注入时不要重复读取；未注入或无法确认时再读取。缺失任一文件即停止。
通用原则以 Soul 为准；具体工具或知识规则只按阶段文档的“按需参考”加载，本 Skill 不重复定义。

## 编排

1. 完整读取 PRD；飞书文档/Wiki 还须按阶段规则读取评论及回复（含已解决评论与分页），
   核对正文和明确确认的评论结论；长评论 ID、revision 与回复定位只写父 change 的
   `prd-source.md`，`preflight.md` 仅保留可读结论和覆盖范围。权限不足或评论不完整时暂停，
   不把讨论当成已确认需求。
2. 执行 `openspec list --json`，优先复用同名或范围重叠的 change。
3. 无可复用 change 时执行：

   ```bash
   openspec new change "<name>" --schema falla-spec-driven --goal "<goal>" --json
   ```

4. 执行：

   ```bash
   openspec instructions preflight --change "<name>" --json
   ```

5. 按阶段规则核实现状、记录问题。用户明确提供当前 change 的 Figma 节点时，在父 change 目录
   按 Schema 模板创建 `design-source.md`，写入授权范围与精确引用；若已读取，记必要事实和缺口。
   `preflight.md` 只写人工可读的授权概要与分析缺口；只向官方 `resolvedOutputPath` 写入该 artifact。
6. 执行 `openspec status --change "<name>" --json`，确认 `preflight` 为 `done`。

## 边界

不得创建 proposal、specs、design、tasks、comate 或子 change；不得修改业务代码、构建配置或测试。
