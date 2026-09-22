# [分析必读] Preflight（需求分析）阶段约束

Preflight 只回答三件事：当前实现是什么、需求还缺什么、哪些问题会阻断后续决策。通用的 Figma、
CodeGraph、UI Knowledge、安全和跨项目隔离规则统一继承 `[Must Read]soul.md`，本文件不重复定义。

## 1. 输入与范围

1. 完整读取 PRD；不可访问或内容不足时停止并请求补充。
2. 使用 `openspec list --json` 检查同名或范围重叠的 change；优先复用已有父 change。
3. 不存在时使用 `falla-spec-driven` 创建父 change；propose 不得再次创建。
4. 通过 `openspec instructions preflight --change "<name>" --json` 获取模板和输出路径。
5. 只核对需求直接相关的当前工作树、规格、接口、模型和测试，不做无边界扫描。

## 2. 证据规则

- 已知准确类名、路径、字段或资源时使用有界文本检索；未知入口、调用链、动态分派、状态归属、
  生命周期和影响面使用 CodeGraph。文本命中不能冒充调用关系。
- UI 需求可从已通过校验的当前项目 UI Knowledge 中召回候选，但候选必须由当前源码验证。
- 所有“已实现、部分实现、不存在、存在风险”结论必须给出文件、符号、模型、接口或测试证据。
- 默认只分析当前工作树。除非用户明确要求变更沿革、回归来源或具体提交，否则不得读取 Git 历史。
  经授权读取历史时必须限定相关路径和有限提交，并对同一问题只执行一次有界批量查询。
- `git status --short` 和相关路径的 `git diff -- <paths>` 可用于识别当前改动，但不得输出无关或敏感正文。

## 3. 检查维度

### Stateful Interactions

检查初始、加载、成功、空、失败、权限、弱网、离线、重试、前后台切换、进程重建、一次性事件，
以及页面销毁后的异步任务、回调和观察者。

### Boundary and Exception Cases

检查最大/最小值、长度、空值、重复操作、运行时/数据/API 版本兼容、灰度、降级、错误码和重试。

### Code Compatibility Gaps

检查 PRD 概念能否映射到现有模型、接口、权限和架构，以及是否需要跨模块改造、迁移或新增依赖。
未搜索到结果不能单独证明能力不存在。

## 4. 问题记录

每项问题标注：

- 检查维度；
- `Missing Definition / Conflict / Implementation Risk / Decision Required`；
- PRD 位置、当前理解、证据、不明确点、影响、建议确认项和可选方案；
- `Blocker / Major / Minor`，并说明具体阻断哪个 artifact 或实施决策。

未决问题不等于一律阻断 propose；未阻断项继续由 `preflight.md` 传递。

## 5. 完成边界

- 只创建或更新 `preflight.md`，即使没有问题也必须给出结论。
- 不创建 proposal、specs、design、tasks、comate 或子 change。
- 不修改业务代码、构建配置或测试。
- 不虚构接口 URL、字段、错误码、设计细节或产品决定。
- 完成后以官方 status 确认 preflight 为 `done`。
