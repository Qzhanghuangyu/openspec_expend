# [架构必读] Propose（方案与任务拆解）

## 目标

基于 preflight 生成 proposal、specs、design、tasks 和 comate。本阶段只规划，不修改业务代码。

## 输入

- 已完成的父 change 和 `preflight.md`、当前主规格及已有源码证据。
- 项目规则、有效 UI Knowledge 和用户已确认决定。

## 必须执行

1. 用官方 status 确认 preflight 已完成，按 instructions 的依赖顺序逐个生成 artifact。
2. 必读 `references/project-rules.md`，执行 Propose 项目规则审计门禁。
3. 复用有效的 preflight 证据；不得重新执行一次完整 preflight。需要核对评论或正文版本时，
   按需读取父 change 的 `prd-source.md`；取证和结论分离规则见 `[分析必读]preflight.md`。
4. 依赖设计事实、Figma 或工程资源时，必须读取 `references/design-tools.md`，按其规则复用
   父 `design-source.md` 与 design，处理缺口、迁移和授权。不要在阶段入口重新定义取证政策。
5. 明确各 artifact 职责；字段与格式由官方 instructions 返回的 Schema/模板定义：
   - proposal：动机、范围与可观察的业务能力。
   - specs：已确认且可测试的行为，不扩写推测场景或实现模块。
   - design：技术决策、页面结构、规则和实现基线、风险及验证安排。
     使用 XML 的页面在 `design.md` 列出布局文件与关键节点层级；现有节点核对源码，拟新增节点
     标注，未知项留待确认；不展开完整 XML 属性。纯 Compose 或非页面变更注明不适用。
   - tasks：按下节拆解实际任务。
   - comate：协作字段与滚动交接，具体规则见 coordination。
6. 涉及组件或页面模式时，必须读取 `references/ui-knowledge.md`，执行候选验证、选型与 required
   绑定；规划及实施均以该文档的复用决策为准。
7. 规划 Android 代码、资源或配置时，必须读取 `references/android-quality.md`，安排其要求的定向验证、
   集成、注释审计、代码收尾与必要人工任务；不在此复制检查清单。
8. 必读 `references/coordination.md`，确定执行/验证模式、初始化 comate，并按其规则建立并行映射。
9. 无规格级行为变化的纯重构、工具或文档变更设置 `skip_specs: true`。

## 任务拆解

- 核对现有接口、状态来源与页面链路，新方案须有能力缺口证据；定位源码必须读取 `references/code-search.md`。
- 从已确认行为与 design 按能力和依赖拆解。页面按需采用“契约 → 独立逻辑/组件 → 组装联调”，
  非页面按实际能力拆；不强制 View/ViewModel 两项或每控件一项，验证任务不代替能力拆解。
- 每项写输入、交付物、允许编辑范围、可测试完成条件和前置编号，按依赖拓扑排列。
  只拆可独立交付、验证且边界清晰的工作；强耦合的合并，共用文件指定唯一责任方。
- parallel 父 tasks 只记协调里程碑与子 change 引用，子 change 只保存自己的任务；根页面/XML
  只能有一个责任方。子 change 命名、创建和依赖字段遵循 coordination。

## 何时暂停

- preflight 未完成，或页面结构、核心契约及 required 基线无法确定。
- 项目规则审计或 coordination 的模式、依赖门禁未满足。

## 完成标准

- 父 artifacts 由官方 status 判定为 done 或合法 skipped，已创建子 change 的规划也完成。
- tasks 的范围、依赖和完成条件明确；`coordination validate` 通过。
- 没有修改业务代码。

## 按需参考

本阶段第 2、8 步为必读；其他参考按对应步骤触发强制加载。命令编排见 `falla-propose` Skill。
