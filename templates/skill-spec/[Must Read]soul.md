# FallaOpenSpec 的灵魂（Soul）

> 本文是 FallaOpenSpec 的全局决策入口。当 Schema、Skill、Hook 或 CLI 行为与本文冲突时，
> 应修正实现，而不是绕过本文约束。

## 0. 读取规则

为避免 agent 每次全量读取规则，`.falla/skill-spec/` 使用前缀标明读取阶段：

| 前缀 | 何时读取 |
| --- | --- |
| `[Must Read]` | 任何 Falla 工作流开始前 |
| `[分析必读]` | PRD 分析与 preflight |
| `[架构必读]` | propose、规划和任务拆解 |
| `[模块选读]` | apply 某个父/子 change |
| `[任务选读]` | archive 等特定环节 |

先读本文判断阶段，再读取对应阶段文档。缺少必读文件时停止，不得声称规则已加载。

## 1. 定位

FallaOpenSpec 是建立在官方 OpenSpec 之上的 Android/移动端任务拆解与 SDD 扩展。
OpenSpec 是唯一工作流内核，负责 change、Schema、artifact DAG、status、instructions、
validate、spec 同步和 archive。Falla 不复制这些实现，只补充移动端决策规则与团队协作。

标准链路为：

`preflight → proposal → specs → design → tasks → comate → apply → archive`

所有业务规格和 change 位于 `openspec/`；`.falla/skill-spec/` 只保存工作流规则。

## 2. 两个核心问题

1. **UI 还原边界**：Figma 到 Android 的最后约 20% 涉及视觉手感、字体、动效、机型
   适配和设计隐性意图，不能假装可由 AI 稳定完成。
2. **团队协作**：单一 change 不足以表达多人、多 agent 的认领、依赖、阻塞和交接。

## 3. 核心信条

### 3.1 AI 搭框架，人类做最终校准

- AI 负责约 80%：布局结构、控件层级、可复用组件、主题基础样式、数据绑定和交互框架。
- AI 不反复追求无法客观验证的 100% 像素对齐。
- design 和 comate 必须明确记录留给工程师/设计师校准的视觉项。

### 3.2 为团队并行交付而拆解

拆解第一目标是让工作可独立认领、验证和交接，而不是让一个 agent 从头做到尾。

## 4. 拆解方法

### 4.1 MVVM 第一刀

页面级 change 首先拆为：

1. ViewModel：状态、事件、数据流、业务逻辑和数据层交互。
2. View：布局、控件、样式和交互框架。

先明确两者契约，再允许并行实现，防止状态和生命周期不一致。

### 4.2 UI 按模块控件继续拆解

顶部栏、列表项、底部栏、空状态、弹窗等应成为边界清晰、可独立开发和认领的任务；
页面组装与联调在这些组件之后收敛。

### 4.3 用 DAG 表达依赖

- 每项任务和子 change 显式声明前置依赖。
- 无未完成依赖者才可开始。
- 独立任务并行，有依赖任务按拓扑顺序推进。
- 典型顺序：ViewModel 数据契约 → 控件并行 → 页面组装 → 联调。

### 4.4 propose 阶段创建子 change

父 change 完成规划 artifact 后，必须在 propose 阶段创建子 change；apply 只实施已有子
change，不重新拆分。业务 `specs/` 只描述用户可观察、可测试的行为，不能用 View、
ViewModel、控件或接口层等实现模块冒充能力。

标准 OpenSpec 不支持嵌套 change，因此：

- 逻辑引用保持 `<parent>/<child>`。
- 物理 change 位于 `openspec/changes/<parent>-child-<child>/`。
- `.falla/coordination.yaml` 是逻辑名到物理名的唯一映射源。
- Skill 通过 `falla-openspec coordination` 解析映射，change 内部状态始终来自官方 OpenSpec。

### 4.5 comate.md 是协作事实

每个父、子 change 都维护 `comate.md`，记录：

- owner；
- todo / in-progress / blocked / done；
- depends-on / blocks；
- handoff。

依赖边必须双向一致且无环。owner、状态和依赖不复制到协调索引，避免双重事实来源。

## 5. 安全与完成边界

- 不把推测写成已确认需求，不用模糊兜底替代产品决策。
- 不在日志或报告中输出 token、密码、API Key、签名或规格正文。
- 实施时检查异步任务、观察者、回调和 UI 状态的生命周期，防止泄漏与销毁后更新。
- 完成功能后检查空值、异常分支和 NPE/崩溃风险，并记录结论。
- 不自动 commit、push、merge 或 rebase。

> FallaOpenSpec = 官方 OpenSpec 的严谨内核 + 对 AI UI 边界的诚实 + 可并行认领和交接的
> 移动端协作模型。
