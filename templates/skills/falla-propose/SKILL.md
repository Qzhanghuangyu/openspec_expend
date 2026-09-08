---
name: falla-propose
description: Use when an existing Falla preflight change needs proposal artifacts, Android architecture planning, or parallel child-change decomposition.
---

# Falla Propose

把已有 preflight 转为官方 OpenSpec artifacts 和可并行认领的父子 change DAG。

## 必须执行

1. 读取 `.falla/skill-spec/[Must Read]soul.md` 和
   `.falla/skill-spec/[架构必读]propose.md`；缺失时停止。
2. 通过 `openspec status --change "<parent>" --json` 复用已有父 change；`preflight`
   未 done 时停止，不能只检查目录。
3. 按官方状态依次调用：

   ```bash
   openspec instructions <proposal|specs|design|tasks|comate> --change "<parent>" --json
   ```

   使用返回的模板、依赖和 `resolvedOutputPath`，不猜路径。
4. proposal/specs 只描述用户可观察的业务能力；design/tasks 先按 MVVM 拆 ViewModel 与
   View，再把 UI 拆到模块控件，并明确人工视觉校准项。
5. tasks 使用 checkbox 和逻辑依赖，形成“契约 → 控件并行 → 组装 → 联调”的 DAG。
6. 在 propose 阶段为每个可交付单元创建子 change：

   逻辑名必须恰好是两个 kebab-case 段：`<parent>/<child>`。View 只是任务类别，
   不能再形成第三层；例如 `medal/view-model`、`medal/top-bar`、`medal/list-card`。
   默认物理名格式中间的 `child` 是固定字面量：`<parent>-child-<child>`。
   例如 `medal/view-model` → `medal-child-view-model`，
   `medal/top-bar` → `medal-child-top-bar`。名称每段都使用小写 kebab-case。
   仅同名冲突时由协调工具追加 8 位哈希。
   不自行生成后缀，最终物理名只能采用 register 的 JSON 返回值。

   ```bash
   falla-openspec coordination register "<parent>/<child>" --json
   openspec new change "<physical>" --schema falla-task-driven --json
   openspec instructions tasks --change "<physical>" --json
   openspec instructions comate --change "<physical>" --json
   ```

7. `comate.md` 使用逻辑名记录双向 `depends-on` / `blocks`，并执行：

   ```bash
   falla-openspec coordination validate --change "<parent>" --json
   ```

## 完成边界

- 所有物理子 change 位于 `openspec/changes/` 顶层；逻辑引用保持 `<parent>/<child>`。
- apply 阶段不再创建或拆分子 change。
- DAG 校验失败、映射缺失或官方命令失败时停止，不手工嵌套目录、不伪造完成状态。
- 不在 propose 阶段修改业务代码。
