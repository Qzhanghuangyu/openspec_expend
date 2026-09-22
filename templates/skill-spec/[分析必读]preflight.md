# [分析必读] Preflight（需求分析）

## 目标

回答三个问题：当前实现是什么、需求还缺什么、哪些问题会阻断后续设计。
本阶段只产出 `preflight.md`。

## 输入

- 用户提供的 PRD 或需求说明。
- 当前项目代码、接口、模型、测试和已有规格。
- 可选：用户在当前对话明确提供的设计节点。

## 必须执行

1. 完整读取需求；内容不可访问或不足以确定范围时请求补充。
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
7. 每个问题标记 `Missing Definition / Conflict / Implementation Risk / Decision Required`，以及
   `Blocker / Major / Minor`，并说明具体阻断的 artifact 或实施决策。
8. 写入官方返回的 `resolvedOutputPath`，再运行 status 确认 preflight 为 `done`。

## 何时暂停

- PRD 不完整或不可访问。
- Blocker 会阻止 proposal、spec、design 或任务拆解。
- 结论只能依赖猜测，无法获得当前代码或接口证据。

未阻断后续决策的问题继续记录在 preflight 中，不要求全部提前解决。

## 完成标准

- `preflight.md` 已创建，即使没有问题也有明确结论。
- 每个实现状态都有证据，每个问题都有类型、级别、影响和建议确认项。
- 未创建其他 artifact、子 change，也未修改业务代码、构建配置或测试。

## 按需参考

- 源码定位或 Git 边界：`references/code-search.md`
- UI Knowledge：`references/ui-knowledge.md`
- 用户明确提供设计节点：`references/design-tools.md`
