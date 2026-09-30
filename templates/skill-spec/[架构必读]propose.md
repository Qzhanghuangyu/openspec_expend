# [架构必读] Propose（方案与任务拆解）

## 目标

基于 preflight 生成 proposal、specs、design、tasks 和 comate。本阶段只规划，不修改业务代码。

## 输入

- 用户在本轮手动调用 Propose；已完成的父 change 和 `preflight.md`、当前主规格及已有源码证据。
  preflight done/ready 或仅答复澄清不构成本阶段调用。
- 项目规则、有效 UI Knowledge 和用户已确认决定。

## 必须执行

1. 用官方 status 确认 preflight 已完成；必读 `[分析必读]preflight.md` 的“阻塞项准入记录”，
   逐项核对当前范围的 Blocker 状态及确认依据，并执行 `coordination preflight` 准入检查。
   官方 done/ready 和用户调用 Propose 都不代表未决需求已获确认；检查通过后才按依赖顺序生成 artifact。
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
  Figma UI task 须列出负责的设计条目 ID 与页面/状态，把对应的可核对设计事实写入完成条件。
  只拆可独立交付、验证且边界清晰的工作；强耦合的合并，共用文件指定唯一责任方。
- 新任务 checkbox 的编号固定为所在章节.序号（如 1.1、1.2、2.1），不得使用 `T1`/`T2` 或全局流水号。
  前置依赖只引用当前 tasks.md 中现存任务的精确编号，逐项列出；跨子 change 的依赖写入
  comate 的 `depends-on`，不以本地编号冒充。OpenSpec `instructions apply` 的 `tasks[].id` 是顺序 ID，
  不代替 tasks.md 的人读编号。规划时调整编号须同步修改所有引用；已有认领或完成进度的 change
  不因模板更新自动重编，迁移须另行核对当前状态和 handoff。
- 新 tasks 保留模板的 `<!-- falla-tasks-format: 1 -->` 标记，使用 `## 1. 标题` 这样的编号章节；
  每个 task 的章节号须与所在章节一致。依赖写在任务同行的 `（依赖：1.1、1.2）` 或缩进续行的
  `- 依赖：1.1、1.2` 中，一项只写一个字段，无前置写 `依赖：无`。可用中文顿号/逗号或英文逗号
  分隔精确编号；字段不可留空、引用自身、引用后置任务或形成环，不使用模糊文字替代编号。
  不在代码围栏里写示例 checkbox，官方会将其计入任务。旧文件无格式标记时允许已有 `T1`、全局
  数字或嵌套编号，但重复编号和显式依赖仍受校验；未编号且无依赖字段的旧任务只保留进度统计，
  不推测依赖。迁入新格式时由 Propose 核对编号、全部引用及进度后显式加标记。
- parallel 父 tasks 只记协调里程碑与子 change 引用，子 change 只保存自己的任务；根页面/XML
  只能有一个责任方。明确父里程碑负责人将承担的汇总验收、状态恢复与最终归档职责，
  但不在 Propose 自动认领；父 owner/status 从默认模板保留待认领。子 change 命名、创建、
  依赖及后续父协调者认领遵循 coordination 的“Parallel 父协调职责与交接”。

## UI 结构覆盖核对（涉及设计页面时）

对当前范围的已授权页面/状态，按有功能或视觉上显著、影响验收的主要区域核对其父层和设计证据；
在 design 关键节点表中以设计条目 ID 对应 spec（合法 `skip_specs` 则注明）与负责的 task/子 change，
或写明范围外、未取得及原因。任务生成后回填 task 引用，反查每个区域均有责任与完成条件；
图层重叠时也要按实际父层归属。不逐个核对装饰性叶节点，也不为这项核对重复读取 Figma；必要结构事实缺失才依
`references/design-tools.md` 定向补读。静态设计可证明存在及层级，不得推断点击行为或动态参数；
未知交互保留待确认，不能以猜测补齐规格。

## 重规划与旧进度

已有 owner、checkbox 或人工验收证据时，不从模板重建 comate/tasks，不用更新指纹消除旧证据失效。
必读 coordination 的“实施基线与完成证据失效”，先列受影响任务及验收范围，按各自 owner/父子依赖回退，
保留有依据的不受影响进度，再显式复核记录。仅已确认需求内的方案变动留在 Propose；需求/决定不明确先回 Preflight。

## 何时暂停

- preflight 未完成、准入未通过、确认依据无法核实，或页面结构、核心契约及 required 基线无法确定。
  返回 Preflight 核对并补齐当前记录，不以生成后续文件消除阻塞，不自行选择未确认的业务行为。
- 项目规则审计或 coordination 的模式、依赖门禁未满足。

## 完成标准

- 父 artifacts 由官方 status 判定为 done 或合法 skipped，已创建子 change 的规划也完成。
- tasks 的范围、依赖和完成条件明确；按 coordination 初始化/显式复核基线，`coordination validate` 通过。
- 适用 UI 的结构覆盖核对已完成；OpenSpec 的 `planningComplete` 不证明设计事实到 spec/task 的语义覆盖。
- 没有修改业务代码。
- 完成规划后停止并等待用户审阅或修改 design/tasks；不得自动进入 Apply。

## 按需参考

本阶段第 2、8 步为必读；其他参考按对应步骤触发强制加载。命令编排见 `falla-propose` Skill。
