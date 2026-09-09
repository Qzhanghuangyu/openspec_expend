# [模块选读] Apply（实施与协作分派）阶段约束

Apply 只实施 propose 阶段已经创建的父/子 change，不在此阶段拆分或创建 change。

## 1. 开始门禁

1. 读取全局规则和本文。
   不读取或重跑 preflight、propose、archive；Skill 名称不是 Shell 命令。
2. 若输入为逻辑 `<parent>/<child>`，执行
   `falla-openspec coordination resolve "<parent>/<child>" --json` 获取物理名。
3. 执行 `falla-openspec doctor <project> --json` 和
   `falla-openspec coordination validate --change "<parent>" --json`。
4. 上游依赖未 done 时停止；不得以赶进度为由绕过。
5. owner 为 unassigned 时先认领，再把状态改为 in-progress。
6. 使用官方 `openspec status` 和 `openspec instructions apply` 获取真实状态、contextFiles、
   context 与 operationGuidance。

## 2. 实施与状态

- 读取官方 contextFiles 和 context；子 change 还需通过协调映射读取父 change 的 proposal、specs、
  design 和 tasks，不复制这些文件。
- operationGuidance 仅是操作建议：逐条判断适用性，不能覆盖官方状态、允许编辑路径、Falla 门禁
  或用户明确选择，也不得把 context/guidance 正文复制到代码、日志或报告。
- 逐项进行最小改动；对应验证成功后才把 `- [ ]` 改成 `- [x]`。
- UI 只搭框架，把无法自动校准的视觉细节写入 handoff。
- 遇到不明确、设计冲突或错误时暂停，把状态改为 blocked，并写明原因、当前进度、
  下一步和接手条件。
- 全部任务与验证完成后才能标记 done；确认下游依赖已因此解锁。

## 3. 安全与生命周期

- 检查空值和异常分支，避免 NPE/崩溃。
- 检查协程、Flow、观察者、回调、监听器和 UI 引用的创建与释放时机。
- 不在日志、comate 或报告中写入凭据和敏感正文。
- 不自动 commit、push、merge 或 rebase。
