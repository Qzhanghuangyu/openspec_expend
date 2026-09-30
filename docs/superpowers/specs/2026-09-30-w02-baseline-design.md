# W02：完成证据的实施基线关联

已确认方案：用户于 2026-09-30 同意“自动指纹＋显式影响范围复核”，不自动清空进度。

## 目标与范围

- 将 PRD/Preflight 已确认决定、proposal/spec/design、授权设计取证、本地 task 完成条件及协作契约关联到 comate 中的实施基线。
- 需求或基线实质变化后不能静默保留旧完成结论、幂等认领或下游准入。
- 不处理 W03—W07，不改 Android 业务代码，不自动提交 W02、不推送。

## 记录与指纹

- `comate.md` 保留现有 format-version: 2；增加可选单行 JSON 字段 `实施基线 (baseline)` 与 `基线复核 (baseline-review)`。基线未记录用 `unrecorded`，尚无复核用 `none`，不另建重复事实源。
- 快照版本为 1，保存总指纹、固定名称的来源摘要与稳定 task 编号摘要，不保存 PRD/设计正文、临时链接、凭据或个人信息。
- 子 change 使用父的公共需求/设计/规格和父 tasks，使用本地 tasks 与协作契约；自己的 preflight/design 文件不能覆盖父来源。规范化上游引用及已记录交付 fingerprint 纳入基线，上游重新 done 后消费者仍须独立复核；外部子依赖核对其父前置，不要求父先 done。
- 仅忽略 checkbox 状态、owner/status/human-review/handoff 等进度字段。Markdown 的 BOM、CRLF、非代码区域空行和行尾空白不影响摘要；代码块、缩进代码、Markdown 硬换行及 YAML 字面量保留有意义空白，无法确定的排版差异仍触发复核而非自动撤销。
- 来源缺失以明确的缺失摘要记录；官方 status 与 Preflight 门禁仍负责规划/需求准入，来源新增或删除会改变基线。

## 检查与初始化

- `coordination baseline <change> --json` 只读返回当前/已记录指纹、固定来源名称、稳定 task 编号与脱敏诊断。
- validate、doctor、claim 共用检查：已记录但指纹不符报 `baseline-review-required`；缺记录且已有实施/完成/人工通过证据报 `baseline-unverified`。
- 无进度的 todo 可以先规划。首次认领在项目锁内把初始快照和认领字段一起原子写入；Propose 也可用 `coordination baseline <change> --record --owner <id>` 记录无进度基线，不产生认领或改变 owner/status。
- 新旧 format-version 都保留原字段与编号；旧已完成/实施中记录不能自动补成当前版本已验证。归档缺基线不原地改写，须新 change 重新核实。

## 显式复核与回退

- `baseline-review` 保存 `from`、`to`、`affected`、`preserved`、精简 `evidence`。from/to 必须匹配已记录/当前指纹；缺旧快照时 from 为 null。
- 复核人先列受影响任务、已启动下游、集成/生命周期/人工验收项，再按现有逆依赖和各自 owner 回退协议处理。新需求不明确、PRD 决定变更或冲突回 Preflight；已确认需求内的设计/task 修订回 Propose。
- --record 只更新调用者所属 comate 的基线，不改 checkbox、owner/status/human-review 或其他 owner 文件；已归档拒绝写入。
- 已变化的 task 内容不可被当成不受影响保留；受影响 task 必须未勾选，受影响人工任务必须 pending；仍有效的已完成 task 必须逐编号列入 preserved 并有复核依据。程序检查结构与状态，不自动判断自然语言影响或依据真实性。
- 刷新前在协调锁内校验父 DAG 的非基线错误、所有权、原文件 hash 和当前输入；基线字段原子写入。残留锁回收使用独占恢复保护，保护残留 fail-closed，不递归自动回收。手工编辑仍须遵守协作所有权，非协作外部进程的文件竞态不声称完全消除。

## 安全与验证

- 普通文件、无符号链接、受限真实目录、单文件 256 KiB、规格文件数/总输入预算均受限；句柄在 finally 释放。
- 错误与命令结果不回显复核依据、需求正文、异常栈或用户构造的非法编号。
- 回归覆盖 done、实施中、parallel 上游/下游、跨父/归档依赖、保留不受影响任务、人工回退、无权限及输入竞态；真实 OpenSpec 1.12.0，不用永远 ready 的 stub。
