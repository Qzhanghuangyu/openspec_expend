# FallaOpenSpec Migration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复迁移审查中确认的六项 P0/P1 问题，使真实 MercurySpec 项目达到可安全执行迁移副本演练的状态。

**Architecture:** 保持官方 OpenSpec 为唯一内核。协调层根据 active/archive 生命周期选择官方状态源；迁移层按 change 根目录与 metadata 建模，并以 validating/committed 明确事务提交边界；安装层只删除 manifest 可证明仍由 Falla 管理的内容；公开 JSON 适配只校验工作流真实消费的字段。

**Tech Stack:** Node.js 20.19+、ES Modules、`node:test`、YAML 2.9、官方 OpenSpec 1.12 CLI。

**Spec:** `docs/FALLA-OPENSPEC-WORKFLOW-REVIEW.md`

## Global Constraints

- 官方 `openspec` CLI 是唯一 change、artifact、Schema、validate 和 archive 内核。
- 支持范围保持 `>=1.12.0 <1.13.0`，契约基线固定为 `1.12.0`。
- 不导入 `@fission-ai/openspec/dist` 或 `src`。
- `mercuryspec/` 始终只读；真实 Android 项目只执行 dry-run。
- 用户修改过的受管文件、Hook 或 marker 不得覆盖或删除。
- 报告不得包含凭据、环境变量、规格正文、owner 或 handoff 正文。
- 每个生产行为必须先有能在旧实现上按预期失败的回归测试。
- 当前任务在 `codex/migration-hardening` 分支原地执行，不创建缺失 OpenSpec 1.12 基线改动的额外 worktree。

---

### Task 1: Archived coordination lifecycle

**Files:**

- Modify: `src/coordination/dag.js`
- Modify: `test/commands/coordination.test.js`

**Interfaces:**

- Consumes: `resolveChange(root, logical) -> { lifecycle, path, physical }`
- Produces: `statusProvider(physical)` 仅在 lifecycle 为 `active` 时调用；archive 节点继续由归档内 `tasks.md` 和 `comate.md` 校验。

- [ ] **Step 1: Write the failing mixed-lifecycle CLI test**

创建父 change 与两个子 change，将第一个子 change 的 tasks/comate 完成并用官方 CLI 归档，保留第二个 active 子 change。调用真实 `coordinationCommand(['validate', ...])`，断言不产生 `invalid-node`，并且 active 节点仍会执行官方 artifact 门禁。

- [ ] **Step 2: Verify RED**

Run: `node --test test/commands/coordination.test.js`

Expected: FAIL，因为 archive 子节点仍触发 `openspec status --change <physical>`。

- [ ] **Step 3: Implement lifecycle-aware status lookup**

将 `readNode` 中的状态读取改为：

```js
const officialStatus = statusProvider && resolved.lifecycle === 'active'
  ? await statusProvider(mapping.physical)
  : null;
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/commands/coordination.test.js test/coordination/dag.test.js`

Expected: PASS。

### Task 2: Collision-safe registration and orphan cleanup

**Files:**

- Modify: `src/coordination/resolver.js`
- Modify: `src/commands/coordination.js`
- Modify: `src/cli.js`
- Modify: `test/coordination/resolver.test.js`
- Modify: `test/commands/coordination.test.js`
- Modify: `test/cli.test.js`
- Modify: `README.md`
- Modify: `templates/skill-spec/[架构必读]propose.md`
- Modify: `templates/skills/falla-propose/SKILL.md`

**Interfaces:**

- Produces: `unregisterMapping(root, reference) -> { logical, physical, parent, removed: true }`
- Constraint: 只有 physical 在 active 和 archive 都不存在时才允许移除 mapping。
- Constraint: register 的 occupied 集合包括 coordination、active 目录名和 archive 日期前缀后的物理名。

- [ ] **Step 1: Write failing resolver tests**

覆盖：

```js
await mkdir('openspec/changes/medal-child-detail');
const mapping = await registerMapping(root, 'medal/detail');
assert.equal(mapping.physical, 'medal-child-detail-<sha256-prefix>');
```

再覆盖 archive 同名冲突、孤儿 mapping 可 unregister、physical 已存在时 unregister 拒绝、并发 hash 仍由 store 保证。

- [ ] **Step 2: Verify RED**

Run: `node --test test/coordination/resolver.test.js`

Expected: FAIL，因为 register 未扫描文件系统且没有 unregister API。

- [ ] **Step 3: Implement filesystem occupancy and safe unregister**

新增内部目录枚举函数，所有文件系统条目都视为占用；archive 只接受标准 `YYYY-MM-DD-<physical>` 并提取 `<physical>`。`unregisterMapping` 使用 snapshot hash 原子更新 coordination；存在 physical change 时抛出 code 1，不删除任何 change 文件。

- [ ] **Step 4: Add CLI and workflow guidance**

新增：

```bash
falla-openspec coordination unregister "<parent>/<child>" --json
```

仅用于官方 `new change` 失败且物理目录未创建时清理 reservation。帮助、README 和 propose 规则同步说明，不提供 force。

- [ ] **Step 5: Verify GREEN**

Run: `node --test test/coordination/resolver.test.js test/commands/coordination.test.js test/cli.test.js test/templates/skills.test.js`

Expected: PASS。

### Task 3: Metadata-aware flat archived child migration

**Files:**

- Modify: `src/migration/scanner.js`
- Modify: `src/migration/planner.js`
- Modify: `test/helpers/legacy-project.js`
- Modify: `test/migration/scanner.test.js`
- Modify: `test/migration/planner.test.js`
- Modify: `test/e2e/android-copy-migration.test.js`

**Interfaces:**

- Produces: inventory file 可选 `change` 描述 `{ date, parent, child, logical, lifecycle }`，不保存 metadata 正文。
- Produces: 扁平 `archive/YYYY-MM-DD-child` 且根 metadata 含合法 `parent` 时，整个根目录归类为 `archived-child-change`。

- [ ] **Step 1: Extend fixture and write failing assertions**

在 fixture 添加：

```text
mercuryspec/changes/archive/2026-07-21-flat-avatar/.openspec.yaml
  schema: task-driven
  parent: profile
```

断言根目录全部文件均为 `archived-child-change`，计划包含 `profile/flat-avatar` mapping，目标为 `openspec/changes/archive/2026-07-21-profile-child-flat-avatar/...`。

- [ ] **Step 2: Verify RED**

Run: `node --test test/migration/scanner.test.js test/migration/planner.test.js`

Expected: FAIL，旧实现将其识别为 archived parent。

- [ ] **Step 3: Implement root-level metadata classification**

扫描完成后聚合直接归档根；仅读取根 `.openspec.yaml`，校验大小、扫描时 SHA-256、YAML object、`parent` kebab-case 和 child kebab-case。存在 parent 时为根下每个 inventory file 写同一个 `change` 描述并重分类；不把 YAML 内容放入 inventory/report。

- [ ] **Step 4: Teach planner to prefer inventory descriptors**

`childDescriptor(file, kind)` 优先返回 `file.change`，否则兼容既有嵌套路径推导。保留 active/archive 同逻辑名冲突检查。

- [ ] **Step 5: Verify GREEN and real shape**

Run: `node --test test/migration/scanner.test.js test/migration/planner.test.js test/e2e/android-copy-migration.test.js`

Expected: PASS；真实 canary mapping 数比原先增加 6，且 dry-run 前后哈希一致。

### Task 4: Durable migration commit phases

**Files:**

- Modify: `src/migration/transaction.js`
- Modify: `test/migration/transaction.test.js`
- Modify: `test/migration/rollback.test.js`

**Interfaces:**

- New phase flow: `prepared -> writing -> validating -> committed`。
- Backward compatibility: legacy `applied` journal 仍可显式 rollback，并在恢复扫描中视为已提交。

- [ ] **Step 1: Write failing phase tests**

在 `validateTarget` 回调中读取 journal，断言 phase 为 `validating` 且 `appliedCount === operations.length`；成功返回后断言 phase 为 `committed`。把成功 journal 改为 `validating` 后调用 recovery，断言目标精确恢复。

- [ ] **Step 2: Verify RED**

Run: `node --test test/migration/transaction.test.js test/migration/rollback.test.js`

Expected: FAIL，旧实现校验期间已是 `applied`，且不接受 `validating`。

- [ ] **Step 3: Implement phase transitions**

`executeTargets` 完成时写 `validating`。最终 validate、doctor（由调用方 validator 负责）和 report 成功后写 `committed`。恢复逻辑回滚 `prepared/writing/validating/rollback-incomplete`，跳过 `committed` 与旧 `applied`。journal 校验要求 validating/committed/applied 的计数等于 operation 数。

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/migration/transaction.test.js test/migration/rollback.test.js test/e2e/workflow.test.js`

Expected: PASS。

### Task 5: Narrow OpenSpec 1.12 consumed contracts

**Files:**

- Modify: `src/openspec/contract.js`
- Modify: `test/openspec/contract.test.js`
- Modify: `test/contract/openspec-1.12.test.js`

**Interfaces:**

- Status requires: `changeRoot: string`、`artifactPaths: Record<string, { outputPath, resolvedOutputPath, existingOutputPaths: string[] }>`、`nextSteps: string[]`、`actionContext: object`。
- Artifact instructions require string arrays and dependency records `{ id, done, path, description, skipped? }`。
- Apply instructions require `contextFiles` values为 string arrays，以及 tasks `{ id, description, done }`。

- [ ] **Step 1: Write failing malformed-payload tests**

为错误的 `artifactPaths.*.existingOutputPaths`、`contextFiles.*`、dependencies 和 tasks 成员分别断言 code 3 与精确 field。

- [ ] **Step 2: Verify RED**

Run: `node --test test/openspec/contract.test.js`

Expected: FAIL，因为旧契约只检查外层 array/object。

- [ ] **Step 3: Implement exact consumed validators**

复用 `assertStringArray`，新增 artifact path、dependency 和 task 的局部 validator。允许官方新增字段；可选字段只在存在时校验。

- [ ] **Step 4: Strengthen real CLI fixture and verify GREEN**

真实契约测试断言 status 含 glob-expanded artifactPaths，apply 的 contextFiles 和 tasks 通过完整结构校验，`skip_specs` 的 existingOutputPaths 为空。

Run: `node --test test/openspec/contract.test.js test/contract/openspec-1.12.test.js`

Expected: PASS。

### Task 6: Safe managed-file pruning

**Files:**

- Modify: `src/install/manifest.js`
- Modify: `src/install/files.js`
- Modify: `src/install/hooks.js`
- Modify: `src/commands/install.js`
- Modify: `src/cli.js`
- Modify: `test/install/install.test.js`
- Modify: `test/install/hooks.test.js`
- Modify: `test/commands/doctor.test.js`

**Interfaces:**

- Manifest v2 keys: `formatVersion`、`fallaVersion`、`openSpecVersion`、`installedAt`、`tools`、`files`。
- Loader 兼容旧 v1 manifest；新安装始终写 v2。
- Install result 新增 `removed: string[]`。

- [ ] **Step 1: Write failing subset-reinstall tests**

先安装 `claude,codex`，再只安装 `codex`，断言 Claude Skill、Hook 脚本和 settings 中的 Falla Hook 被移除，Codex 与公共 Schema/规则保留，manifest 只记录当前文件且 tools 为 `['codex']`。

再覆盖：待删除文件或 marker 被用户修改时安装停止且内容不变；旧 v1 manifest 可安全升级并 prune。

- [ ] **Step 2: Verify RED**

Run: `node --test test/install/install.test.js test/install/hooks.test.js test/commands/doctor.test.js`

Expected: FAIL，因为旧 manifest 延续 previousFiles 且没有删除计划。

- [ ] **Step 3: Implement standalone prune plan**

`planManagedFileRemovals(root, obsoletePaths, previousFiles)` 只允许删除“当前 SHA-256 等于旧 manifest 哈希”的普通文件；不存在则视为已清理；内容变化或符号链接时停止。应用使用带 expected hash 的安全 remove，不递归删除目录。

- [ ] **Step 4: Implement hook registration removal**

对 `AGENTS.md`、`.codex/config.toml` 只移除哈希匹配的 Falla marker；对 `.claude/settings.json` 只移除哈希匹配的 Falla PreToolUse entry，保留所有用户条目。marker/entry 被修改时停止。

- [ ] **Step 5: Write manifest v2 and report removals**

当前 desired files 从空对象构建，不继承旧条目；candidate manifest 写排序后的 tools。CLI 人类摘要同时报告 written/removed/warnings。

- [ ] **Step 6: Verify GREEN**

Run: `node --test test/install/install.test.js test/install/hooks.test.js test/commands/doctor.test.js test/cli.test.js`

Expected: PASS。

### Task 7: Full verification and migration readiness report

**Files:**

- Modify: `README.md`
- Modify: `docs/FALLA-OPENSPEC-WORKFLOW-REVIEW.md`

**Interfaces:** No new runtime interfaces.

- [ ] **Step 1: Update operator documentation**

记录 unregister 恢复路径、manifest v2 安全 prune、迁移 committed 阶段，以及真实迁移前必须先解决的业务规格冲突。

- [ ] **Step 2: Run full verification**

```bash
npm run check
FALLA_ANDROID_CANARY_ROOT=/path/to/androidCopy npm test
npm audit --audit-level=high
npm pack --dry-run --json
git diff --check
```

Expected: 0 failures、0 high vulnerabilities、打包不包含测试或敏感文件。

- [ ] **Step 3: Run fresh real-project dry-run**

```bash
falla-openspec migrate /path/to/androidCopy --json
```

Expected: 源/目标树零写入；扁平归档 mapping 增加；若 `gift-panel` 未人工处理，仍明确报告唯一 `target-different` conflict，禁止 apply。

- [ ] **Step 4: Reconcile review findings**

在审查文档中将已修复项标记为已修复，并保留 P2 与业务冲突风险。没有 `conflict=0` 和副本 apply/rollback 演练证据时，不宣称真实项目已可直接迁移。
