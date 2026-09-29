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

1. 按阶段规则核对需求与取证完整性。
2. 执行 `openspec list --json`，优先复用同名或范围重叠的 change。
3. 无可复用 change 时执行：

   ```bash
   openspec new change "<name>" --schema falla-spec-driven --goal "<goal>" --json
   ```

4. 执行：

   ```bash
   openspec instructions preflight --change "<name>" --json
   ```

5. 按阶段规则生成 preflight 与必要取证文件；artifact 只写入官方 `resolvedOutputPath`。
6. 执行 `openspec status --change "<name>" --json`，确认 `preflight` 为 `done`。

## 边界

不得创建 proposal、specs、design、tasks、comate 或子 change；不得修改业务代码、构建配置或测试。
