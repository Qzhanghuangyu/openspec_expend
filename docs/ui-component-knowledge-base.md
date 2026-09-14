# UI 组件知识库约定

更新时间：2026-09-14

## 1. 决策

FallaOpenSpec 面向多个业务项目，因此不内置任何具体项目的 UI 组件扫描规则、组件清单、页面索引
或生成结果。工作流只为每个目标项目安装统一的知识库位置、通用条目模板和使用约束：

```text
<project>/.falla/ui-knowledge/
```

知识库内容由该项目的工程师、设计师，或经用户明确授权的 AI 独立完成。不同项目之间不自动同步、
合并或复制条目。

## 2. 安装器负责什么

安装器只写入受管文件：

```text
.falla/ui-knowledge/
├── README.md
└── templates/
    ├── component.md
    └── screen-pattern.md
```

安装器不负责：

- 扫描项目并生成 `index.json`；
- 推断项目有哪些组件；
- 自动创建 `components/` 或 `screen-patterns/` 条目；
- 把某个示例项目的模块、路径、类名或统计数据写入其他项目；
- 在 SessionStart 或普通 UI 任务中后台补库；
- 建立跨项目共享数据库。

## 3. 项目团队负责什么

项目需要维护知识库时，由人或经授权的 AI 创建：

```text
.falla/ui-knowledge/components/<stable-kebab-id>.md
.falla/ui-knowledge/screen-patterns/<stable-kebab-id>.md
```

推荐流程：

1. 明确本次是“知识库维护任务”，而不是普通功能开发的隐式副作用。
2. 使用 CodeGraph、有界 `rg`、布局/资源和测试定位候选。
3. 只为实际验证过的组件或页面模式创建条目。
4. 记录项目内相对路径、模块依赖、资源/API、状态、生命周期、风险和验证日期。
5. 由工程师或指定 reviewer 检查后，把状态从 `draft` 改为 `verified`。
6. 代码或设计发生变化后，更新 `last-verified`，或把条目标记为 `deprecated/invalid`。

## 4. 普通 UI 任务如何使用

- preflight/propose/apply 可以有界检索与当前需求相关的条目。
- 未找到条目不能证明项目没有对应能力，仍须核对当前代码和设计。
- 条目是复用提示，不是代码事实的替代品；必须重新检查依赖、资源可见性、主题、API 和生命周期。
- 普通任务不得顺带全量扫描并生成知识库。
- 只有用户明确授权或 change/tasks 明确要求知识沉淀时，AI 才能新增、更新条目。

## 5. 与 CodeGraph、Figma 的边界

| 能力 | 事实来源 |
| --- | --- |
| 类、函数、调用链、影响面 | CodeGraph + 当前源码 |
| XML、Gradle、Manifest、资源 | 当前项目文件 + 有界文本搜索 |
| 当前视觉设计 | 用户明确提供节点后的 Figma MCP |
| 项目内已验证复用经验 | `.falla/ui-knowledge/` |

知识库不能替代 Figma 当前节点，也不能把 CodeGraph 查询结果未经验证直接固化为推荐组件。

## 6. 安全与生命周期

条目禁止包含：

- token、cookie、API Key、签名文件内容或认证信息；
- 绝对用户目录；
- 完整设计正文和临时资源 URL；
- 大段无关源码或完整页面复制；
- 未确认的生命周期安全结论。

组件条目必须明确初始化和释放时机。涉及 Context、Activity、Fragment View、Binding、Observer、
Callback、Listener、Handler、Coroutine、Flow 或 Disposable 时，需要记录生命周期归属和清理要求。
