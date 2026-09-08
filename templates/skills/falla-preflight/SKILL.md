---
name: falla-preflight
description: Use when analyzing a PRD or product request before OpenSpec proposal work or implementation begins.
---

# Falla Preflight

在官方 OpenSpec 中建立正式 preflight artifact，并用证据记录实现状态与未明确事项。

## 必须执行

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[分析必读]preflight.md`；缺失时停止。
2. 完整读取 PRD。PRD 不可访问或不足以确定范围时请求补充，不开始编码。
3. 用 `openspec list --json` 检查同名或重叠 change。
4. 无可复用 change 时执行：

   ```bash
   openspec new change "<name>" --schema falla-spec-driven --goal "<goal>" --json
   ```

5. 执行 `openspec instructions preflight --change "<name>" --json`，按返回的
   `resolvedOutputPath` 和模板创建 `preflight.md`。
6. 只检查需求直接涉及的代码与文档；所有状态结论必须有文件、符号、模型、接口或测试证据。
7. 按三类检查维度、四类问题类型和三级阻塞级别记录问题；说明问题具体阻断的阶段，
   不把所有未决项一律阻断。
8. 执行 `openspec status --change "<name>" --json` 确认 preflight 为 done。

## 输出边界

- 本阶段只创建或更新 `preflight.md`。
- 不创建 proposal、specs、design、tasks、comate 或子 change。
- 不修改业务代码、构建配置或测试。
- 不把推测写成已确认需求，不输出凭据或无关文档正文。
