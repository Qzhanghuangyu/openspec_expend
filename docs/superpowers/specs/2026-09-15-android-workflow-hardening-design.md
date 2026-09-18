# Android 工作流可靠性完善

用户已在工作流审阅后授权按建议修复，并明确只服务 Android 客户端。

## 边界

- 保留官方 OpenSpec >=1.12.0 <1.13.0 内核，不复制其解析器或归档功能。
- 只支持 Android View 与 Jetpack Compose；不增加其他技术栈配置层。
- 项目知识由各项目维护，本次不实现 RAG，不生成业务条目，不自动认证外部服务。
- 改动留在当前工作区供用户审阅，不自动提交、推送或更新业务项目。

## 设计

1. 兼容单行及模板的多行 handoff，空占位字段不能满足完成门禁。协作校验覆盖父 change 与 single change；未进入实施且尚无 comate 的规划不误报。
2. 安装写入保留计划时原始哈希，并在替换前复核；同时检查共享 Hook 文件用户区域。继续采用文件原子替换，不声称跨文件事务或编辑器级原子 CAS。
3. 新增只读 `ui-knowledge validate` 与 `ui-knowledge fingerprint <entry>`。仅扫描当前项目固定知识目录，拒绝链接、越界、敏感证据路径和超预算数据。校验 Android 平台、版本、ID、状态、reviewer、日期和证据。verified 条目要求 `source-hashes` 覆盖引用文件；变化时报告 stale 并禁止直接复用，不自动修改条目。
4. doctor 输出 installation、workflow、knowledge、integrations 分组状态。安装自身是否成功只由安装组判定，业务问题不会把文件安装误报为失败；doctor 总体仍反映所有组。可选集成不可用显式呈现。
5. 新增 `coordination claim <change> --owner <id>`，同一真实项目内使用排他锁串行认领。复核规划、依赖和当前 owner；不同 owner 不可抢占，已归档/完成/blocked 不自动重启，不回显交接或 owner。跨机器与多个工作树不共享本地锁。
6. 新增 `codegraph prepare`，每次显式执行都同步；Claude 每次 Falla Skill 进入前准备，失败可重试；Codex SessionStart 与各阶段操作指令一起保证同步入口可达。doctor 只检查可执行性和索引路径，不声称验证图谱新鲜度。
7. 文档明确图谱、知识、任务的不同有效性；UI 验收用具体人工校准项而非固定百分比。保持 single 默认以及知识写回授权边界。

## 验证

真实模板解析、安装计划后并发修改、并发 claim、非法/过期/跨界知识、doctor 分组与 CLI 退出码、Hook 失败重试，最后运行完整 Node 测试与语法检查。使用临时项目，不安装到业务项目。
