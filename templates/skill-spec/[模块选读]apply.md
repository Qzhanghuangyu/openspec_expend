# [模块选读] Apply（实施与协作分派）阶段约束

Apply 只实施 propose 阶段已经规划完成的 change，不在此阶段拆分、创建 change 或切换执行模式。
`single` 模式直接实施父 change；`parallel` 模式只实施 propose 已创建的父/子 change。

## 1. 开始门禁

1. 读取全局规则和本文。
   不读取或重跑 preflight、propose、archive；Skill 名称不是 Shell 命令。
2. 读取 `tasks.md` 中的执行模式；缺失时先检查 `.falla/coordination.yaml`：已有当前父 change 的映射则沿用 `parallel`，否则按 `single` 处理；不得自行升级。
3. single 模式直接使用父 change，不调用映射或 DAG 命令；若输入为逻辑 `<parent>/<child>`，说明模式
   不匹配并停止。parallel 模式下，逻辑 `<parent>/<child>` 执行
   `falla-openspec coordination resolve "<parent>/<child>" --json` 获取物理名。
4. 执行 `falla-openspec doctor <project> --json`；仅 parallel 模式执行
   `falla-openspec coordination validate --change "<parent>" --json`。
   按 Soul 的 doctor 分组边界处理，知识或图谱失败不等于安装失败。
5. parallel 模式下上游依赖未 done 时停止；不得以赶进度为由绕过。
6. single 父 change 与 parallel 逻辑子 change 均通过
   `falla-openspec coordination claim "<change>" --owner "<id>" --json` 认领为 in-progress；
   owner 采用当前已约定身份，不直接编辑 owner 绕过锁或抢占他人任务。
7. 使用官方 `openspec status` 和 `openspec instructions apply` 获取真实状态、contextFiles、
   context 与 operationGuidance。

## 2. 实施与状态

- 读取官方 contextFiles 和 context；single 模式直接以父 change 的 artifacts 为上下文；parallel
  模式的子 change 还需通过协调映射读取父 change 的 proposal、specs、design 和 tasks，不复制这些文件。
- operationGuidance 仅是操作建议：逐条判断适用性，不能覆盖官方状态、允许编辑路径、Falla 门禁
  或用户明确选择，也不得把 context/guidance 正文复制到代码、日志或报告。
- 逐项进行最小改动；对应验证成功后才把 `- [ ]` 改成 `- [x]`。
- UI 实施前运行 `falla-openspec ui-knowledge validate --json`，只从通过校验的条目中有界检索
  `.falla/ui-knowledge/`；条目必须有当前项目相对路径证据，并重新核对依赖、
  资源、API、生命周期和验证日期。缺失条目不阻断，也不允许据此猜测组件。
- UI 完成可验证的布局与交互，把需要人工校准的视觉细节写入 handoff。除非当前 tasks 明确包含知识库维护，
  不得自动生成、批量扫描或修改 UI 组件知识库。
- 遇到不明确、设计冲突或错误时暂停，把状态改为 blocked，并写明原因、当前进度、
  下一步和接手条件。
- 全部任务与验证完成后才能标记 done；确认下游依赖已因此解锁。

## 3. 安全与生命周期

- 检查空值和异常分支，避免 NPE/崩溃。
- 检查协程、Flow、观察者、回调、监听器和 UI 引用的创建与释放时机。
- 不在日志、comate 或报告中写入凭据和敏感正文。
- 不自动 commit、push、merge 或 rebase。
