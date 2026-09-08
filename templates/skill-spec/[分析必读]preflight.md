# [分析必读] Preflight（需求分析）阶段约束

Preflight 位于 propose 之前，只负责创建或复用父 change、核对实现状态，并把 PRD 未明确
事项写入正式 `preflight.md` artifact。

## 1. 强制流程

1. 完整读取 PRD；不可访问或内容不完整时停止并请求补充。
2. 用 `openspec list --json` 检查同名或范围重叠的 change。
3. 不存在时执行 `openspec new change "<name>" --schema falla-spec-driven --json`；propose
   不得再次创建父 change。
4. 执行 `openspec instructions preflight --change "<name>" --json`，使用返回的模板和路径。
5. 只读取与需求直接相关的代码、规格和接口，不做无边界仓库扫描。
6. 用具体文件、符号、模型、接口或测试支撑实现状态。
7. 写入 `preflight.md` 后重新执行官方 `openspec status --change "<name>" --json`。

## 2. 核心检查范围

### 2.1 Stateful Interactions

检查初始、加载、成功、空、失败、权限、弱网、离线、重试、前后台切换、进程重建等状态：

- 触发条件和状态迁移；
- 前端、服务端或本地数据的责任；
- 是否持久化；
- 一次性事件是否可能重复消费；
- 页面销毁后异步任务、回调或观察者是否继续更新 UI。

不得从静态 UI 推断完整交互。

### 2.2 Boundary and Exception Cases

检查最大/最小值、长度、空值、重复操作、历史版本兼容、灰度、降级、错误码和重试。
不得用“按现有逻辑”“默认兜底”等表述替代明确规则。

### 2.3 Code Compatibility Gaps

检查 PRD 概念能否映射到现有模型、接口、权限和架构；确认是否需要跨模块改造、迁移或
新增依赖。未搜索到结果不能单独作为“能力不存在”的证据。

## 3. 问题分类

每项问题分别标注检查维度与主要类型：

- Missing Definition
- Conflict
- Implementation Risk
- Decision Required

并标明 `Blocker / Major / Minor`。问题未解决不等于一律阻断 propose；必须说明它具体
阻断哪个 artifact 或实施决策，未阻断项可由 `preflight.md` 继续传递。

## 4. 问题格式

```markdown
## [检查维度][问题类型] 问题标题

- 检查维度：
- 问题类型：
- PRD 位置：
- 当前理解：
- 不明确或冲突点：
- 可能影响：
- 建议确认项：
- 可选方案：
- 阻塞级别：Blocker / Major / Minor
```

## 5. 阶段边界

- 不创建 proposal、specs、design、tasks 或子 change。
- 不修改业务代码、构建配置或测试。
- 不虚构接口 URL、字段、错误码或产品决定。
- 即使没有问题，也必须创建 `preflight.md` 并给出检查结论。
