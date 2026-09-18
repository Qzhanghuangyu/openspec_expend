# Android 工作流可靠性完善 Implementation Plan

> **For agentic workers:** 使用 superpowers:subagent-driven-development 按独立边界实施；主任务负责集成和最终审阅。

**Goal:** 修复已复现问题，将 Android 工作流关键约束落实为可验证行为。

**Architecture:** 安装、协作、知识校验独立演进，doctor 汇总各层健康状态。保留 Markdown 事实源和官方 OpenSpec 内核。

**Tech Stack:** Node.js >=20.19、ESM、yaml 2.9.0、node:test。

**Spec:** docs/superpowers/specs/2026-09-15-android-workflow-hardening-design.md

## Global Constraints

- 只支持 Android View 与 Jetpack Compose。
- 不实现 RAG，不自动创建或修改项目 UI 条目。
- 保留 OpenSpec >=1.12.0 <1.13.0；不自动提交、推送或安装到业务项目。
- 文件操作拒绝越界及符号链接，输出只包含诊断代码和项目相对路径。

## Task 1：安装并发保护

Files: src/install/files.js、src/install/hooks.js、test/install/install.test.js。

- [x] 增加真实临时文件测试：生成更新计划后修改文件，执行必须失败且修改保留；覆盖新建文件冲突及 Hook marker 外修改。
- [x] 运行测试观察缺失保护的失败。
- [x] 计划携带 expectedFileHash；writeAtomicFile 支持 expectedHash 并在 rename 前复核。
- [x] 定向测试通过，审阅剩余非事务边界。

## Task 2：协作完整性与认领

Files: src/coordination/comate.js、src/coordination/dag.js、src/coordination/claim.js、src/coordination/health.js、src/commands/coordination.js、src/locks.js，以及对应测试。

Interfaces: `validateChangeRecords(root, statuses)` 返回 `{ok, errors}`；statuses 为官方 status 数组。`claimChange(root, reference, {owner, statusProvider})` 返回不含 owner/handoff 的认领结果。

- [x] 测试填完模板的多行交接可完成、空模板不可完成、父/single 状态矛盾、双 owner 并发只能一个成功。
- [x] 先看到测试失败，再实现解析、状态核对、排他认领。
- [x] 保持已有映射、归档和脱敏契约；定向测试通过。

## Task 3：项目 UI 知识校验

Files: src/knowledge/*.js、src/commands/knowledge.js、src/cli.js、test/knowledge/*.test.js。

Interfaces: `validateKnowledge(root)` 返回 `{ok, entries, errors, warnings}`；`fingerprintEntry(root, relative)` 返回 `{entry, sourceHashes}`。

- [x] 测试 Android 字段、重复 ID、verified 缺少证据、源码变化、路径越界/链接、超预算数据和只读性。
- [x] 测试缺失 API 失败后实现有界扫描、Schema 与指纹核对、脱敏结果。
- [x] 新增只读 CLI 命令，验证退出码与输出。

## Task 4：健康分组与索引准备

Files: src/commands/doctor.js、src/commands/install.js、src/ui/codegraph.js、src/cli.js、templates/hooks/*.mjs、对应 tests。

- [x] 测试安装成功和项目健康解耦、工具缺失显示不可用、重复 Skill 索引同步及失败重试。
- [x] doctor 消费 Task 2/3 接口；集成检查有超时、无原始输出。
- [x] 新增显式 codegraph prepare，更新阶段约束；定向测试通过。

## Task 5：Android 协议、文档和总体验证

Files: README.md、docs/installation-and-update.md、docs/ui-component-knowledge-base.md、templates/skill-spec、templates/skills、templates/ui-knowledge、package.json。

- [x] 更新平台边界、source-hashes、reviewer、维护流程和命令示例，补工作流发布版本。
- [x] 执行 npm run check、npm test、git diff --check；临时项目验证 install/doctor/CLI。
- [x] 审阅规格符合性、泄漏/生命周期和向后兼容风险，解决实际问题并记录验证。

## 接口审阅

Task 1 向 Task 2 提供兼容的 writeAtomicFile 可选哈希参数；Task 2/3 只向 Task 4 提供只读报告；Task 5 使用已实现命令，不修改事实源所有权。现有未跟踪的 2026-09-09 计划保留。


## 完成与验证（2026-09-15）

版本更新为 0.4.0。完成 Android 范围收敛、安装写入前哈希复核、comate 多行交接解析、排他认领、
项目 UI 知识只读校验及指纹、doctor 四组健康报告，以及阶段级 CodeGraph 准备和失败重试。

### 验证结果

- 最终完整 npm test：147 项通过，0 失败、0 跳过。
- npm run check：通过；额外检查 templates/hooks 中 3 个 .mjs 文件语法，全部通过。
- git diff --check：通过。
- 临时项目使用真实 CLI 完成初装、重复更新（0 个文件重写）、四组 doctor、空知识校验、
  未启用 CodeGraph 的 prepare，以及 single 认领和同 owner 重试；临时项目已清理。
- 定向测试覆盖计划生成后外部编辑、双 owner 并发、上游伪 done、父规划未完成、同 owner 重试时
  上游回退、坏协作文件保留其他诊断、知识越界/符号链接/大文件/失效指纹、Hook 同会话失败重试。

### 审阅及边界

主任务完成集成自审，修复父子认领门禁、非法知识字段诊断和 single 模式指令冲突。
独立审阅子任务因账户额度中断，未取得有效审阅结果，不计作审阅通过。
没有提交、推送或安装到真实业务项目；现有 2026-09-09 计划保留。

- 旧 verified 条目需重新核对 reviewer、日期和 source-hashes，不能仅刷新哈希掩盖源码变化。
- 认领锁只覆盖同机同一真实项目目录；不同工作树和跨机器仍依赖任务分派与合并规则。
- 多文件安装不是事务；最终哈希复核与替换之间仍有极短的外部编辑竞争窗口。
- 知识通过只证明结构与引用文件指纹符合协议，复用仍需核对 Android 资源、依赖和生命周期。
- 未在真实宿主验证 Figma/Lark 认证或 CodeGraph MCP 连接与索引新鲜度；本轮未实现 RAG。
