# 需求行为差分第一步：验证记录

日期：2026-10-09（Asia/Shanghai）

本次按用户“查看本文档并着手修改”的请求，落实方案第三节的行为拆分、模板与 Propose 覆盖衔接。
第一步记录形成时，第二步尚未实施；用户后来明确要求开始第二步，进展另见
[第二步验证记录](2026-10-09-falla-workflow-recording-validation.md)。Apply 每轮一个 task 后暂停的规则、Schema DAG、
comate 格式、认领锁、基线和 Blocker 准入协议均保持原有契约。

## 1. 验证条件与局限

以下五个场景都是合成输入，PRD、评论和源码片段完整列出，不对应真实产品、用户或接口。
同一场景的前后对照使用相同输入和证据；符号名用于定位合成片段，不是本仓库的 Android 源码。
合成宿主约束：除场景 5 明确缺少调用链外，每次进入页面都调用对应 `bind`，展示及点击仅走给出的路径，
没有外层适配器、额外请求或持久化；场景 3 的 Switch 使用原生点击切换，场景 6 的点击调用 `onItemClick`。
这些条件只适用于此处样稿，真实项目必须取证核实，不能从方法名称推断绑定或生命周期。

“原模板汇总形式”演示旧三列表可以容纳的粗粒度写法，不是实际运行旧模型得到的结果；
“新规则走查样稿”由本次 Agent 按修改后的规则编写，不是独立、盲评或多次模型采样。
走查只说明规则能表达这些场景，并供人工检查覆盖与越界；不能证明新规则稳定提高模型分析质量。
尚待在真实需求或隔离模型会话中，以相同输入进行独立前后采样及人工复核；第二步按用户后续明确请求启动，
不能据此宣称第一步的实际效果已经确认。

检查关注明确行为的去向、必要缺口的范围依据、状态证据、问题是否只问一个决定、是否擅自补方案，以及
能否合并实现任务。条目数没有合格阈值；格式与路由测试不读取这些样稿来判定语义质量。

## 2. 简单静态展示

完整输入：Android 帮助页展示固定文字“帮助中心”，无其他交互要求。

全部可用源码证据：

```kotlin
fun bindHelp(title: TextView) { title.text = "帮助中心" }
```

原模板汇总形式：帮助页／已实现／`bindHelp`。

新规则走查样稿：R1，进入帮助页 → 展示指定文字，已实现；依据为上述需求，证据为 `bindHelp` 的文字赋值。
没有触发状态、请求、权限或持久化要求，不增加弱网、缓存、重复提交等问题。
Propose 去向：R1 已实现无需改动，零新增业务任务；不为增加覆盖条目生成任务。

## 3. 已有页面新增交互

完整输入：Android 设置页默认关闭提醒；点击开关切换本页状态，文字随开关显示“已开启”或“已关闭”；
退出后不保存，下次进入仍关闭。

全部可用源码证据：

```kotlin
fun bindReminder(toggle: Switch, label: TextView) {
    toggle.isChecked = false
    label.text = "已关闭"
    toggle.setOnCheckedChangeListener { _, _ -> }
}
```

原模板汇总形式：提醒设置／部分实现／已有开关，交互未完成。

| 编号 | 新规则走查样稿 | 状态与证据 |
| --- | --- | --- |
| R1 | 进入页面 → 开关关闭、文字为“已关闭” | 已实现，`bindReminder` 初始化 |
| R2 | 点击开关 → 切换本页开关状态 | 已实现，Switch 原生切换；此合成场景无拦截或回写 |
| R3 | 开关变化 → 文字显示对应状态 | 未实现，监听器为空，仅有初始赋值 |
| R4 | 重新进入 → 恢复关闭状态 | 已实现，输入指定每次进入调用 `bindReminder`，无持久化路径 |

无待确认决定：持久化已在输入中明确排除。Propose 将 R1、R2、R4 记为无需改动；
一个任务完成 R3 的状态文字绑定与定向验证，完成条件覆盖开关的两个状态，不拆成两个控件任务。

## 4. 异步非幂等提交

完整输入：奖励页显示名称；满足服务端 `eligible` 条件才显示领取按钮；点击提交；成功后显示返回的 `receiptId`；
请求失败显示接口错误文案；提交期间允许返回。契约明确领取接口非幂等；重复点击、离页后请求是否继续、
离页后结果如何反馈均未定义。

全部可用源码证据：

```kotlin
data class Reward(val name: String, val eligible: Boolean)
data class Receipt(val receiptId: String)
interface RewardApi { suspend fun claim(): Receipt }
fun bindReward(reward: Reward, name: TextView, claim: Button) {
    name.text = reward.name
    claim.isVisible = true
    claim.setOnClickListener { }
}
```

| 编号 | 新规则走查样稿 | 状态与证据 |
| --- | --- | --- |
| R1 | 进入奖励页 → 显示奖励名称 | 已实现，`bindReward` 的名称赋值 |
| R2 | 绑定奖励数据 → 按 `eligible` 显示入口 | 部分实现，已有按钮但恒为可见，未使用资格字段 |
| R3 | 点击领取 → 调用提交接口 | 未实现，监听器为空；接口声明不能证明存在调用 |
| R4 | 提交成功 → 显示 `receiptId` | 未实现，完整合成路径无结果显示或绑定 |
| R5 | 提交失败 → 显示接口错误文案 | 未实现，完整合成路径无错误处理 |
| R6 | 提交期间重复点击 → 处理方式待定义 | 无法判断，非幂等契约已知，行为决定缺失 |
| R7 | 提交期间返回 → 允许离开；离页后的请求与反馈待定义 | 无法判断，输入明确允许返回，其他结果未定义 |

原模板汇总形式：奖励页／部分实现／已有展示，领取流程待完善；它没有逐项表达上述状态与决定。

三个问题分别关联行为，不合成一个“大边界问题”：

- B1 → R6：提交期间是否允许再次发起领取？`Decision Required / Blocker`，阻断非幂等提交的状态规格及任务完成条件。
- B2 → R7：离页后业务请求是否继续？`Decision Required / Blocker`，阻断请求所有者与作用域的设计。
- B3 → R7：离页后领取结果如何反馈？`Missing Definition / Blocker`，阻断成功/失败结果的验收条件。

这三个问题的 Blocker 判定来自具体阻断，并非因为属于异常或生命周期维度。没有擅自选择禁用按钮、
取消请求、重试、后台执行或弹窗。当前无异步回调实现，不能断言已经泄漏；后续必须核对实际回调所有权，
不得更新已销毁的 View，该工程约束与 B2 的业务决定分别处理。

Propose 去向：B1–B3 未解决前不进入规划；允许只读取证。决定确认后，R2–R5 可以由一个边界清晰的领取流程任务
共同覆盖，也可按真实依赖拆分，不要求每个 R 单独一个 task。R6、R7 必须按已确认决定补齐场景，不能直接复制为规格。

## 5. 已有功能差分与证据不足

完整输入：Android 订单页沿用已有金额展示；本次新增复制订单号，点击后把完整订单号写入剪贴板并提示“已复制”。
可用证据仅限下列片段，没有绑定调用链、反射入口或第三方适配器信息。

```kotlin
fun renderAmount(order: Order, label: TextView) { label.text = order.amount }
fun copyOrder(order: Order, clipboard: ClipboardManager) {
    clipboard.setPrimaryClip(ClipData.newPlainText("订单号", order.id))
}
```

原模板汇总形式：订单页复制／部分实现／已有复制方法。

| 编号 | 新规则走查样稿 | 状态与证据 |
| --- | --- | --- |
| R1 | 订单页展示原有金额 | 无法判断，`renderAmount` 有赋值但当前调用链未核实 |
| R2 | 点击复制 → 写入完整订单号 | 无法判断，`copyOrder` 写入完整 ID，但点击绑定缺证据 |
| R3 | 复制完成 → 提示“已复制” | 无法判断，当前方法无提示，不足以排除外层回调或适配器 |

核验缺口是源码/调用链问题，不要求用户重新决定已明确的交互，也不因为搜索不到提示就断言未实现。
Propose 应定向补读入口与反馈链，再把已实现无需改动和实际缺失分别落到任务；暂不能用这两个方法宣称链路完成。
剪贴板写入由输入明确要求，样稿不复制任何真实订单号或业务数据。

## 6. 带评论澄清的 PRD

完整输入：正文要求 Android 列表默认选中第一项；当前权威需求负责人明确回复“改为默认不选，选中任意一项后才可提交”。
另外一条已标解决的建议是“默认全选”，没有确认回复。正文与评论线程已完整提供且版本一致；iOS 排序不在本次 Android 范围。

全部可用源码证据：

```kotlin
fun bindSelection(items: List<Item>, submit: Button) {
    var selected: Item? = items.firstOrNull()
    submit.isEnabled = selected != null
    onItemClick = { item -> selected = item; submit.isEnabled = true }
}
```

原模板汇总形式：列表选择／部分实现／默认态需要修改。

新规则走查样稿：R1，进入列表 → 默认未选中，未实现，`firstOrNull` 与已确认评论冲突；
R2，未选中 → 禁止提交，部分实现，禁用分支只在无条目时出现；R3，点击选中 → 可以提交，已实现，点击回调设置可用状态。
R1、R2 的依据使用已确认的评论结论，不让“已解决但未确认”的全选建议覆盖决定；iOS 排序在覆盖核对中简要排除。
无待确认决定，Propose 用一个初始选择状态任务覆盖 R1、R2，R3 已实现无需改动；评论版本与技术定位仅进入原有取证文件。

## 7. 自动化回归

运行命令：

```bash
node --test test/templates/skills.test.js test/templates/rule-routing.test.js test/templates/artifact-safety-fields.test.js test/contract/schemas.test.js test/coordination/preflight.test.js test/coordination/tasks.test.js test/workflow/preflight-gates.test.js
git diff --check
```

结果：72 项测试全部通过，diff 无空白错误。覆盖父子 Schema 官方校验与 skip_specs、
规则权威路由、模板字段、精确任务依赖、旧记录兼容、Blocker 阻断、符号链接安全与 Apply 暂停契约。
修改前有一项目录契约测试因本机 `.DS_Store` 失败，本次只在该测试中过滤 macOS 目录元数据，仍检查未知规则文件。

未修改协作解析器、认领或基线实现，没有进行 Android 构建。包模板变更尚未安装到外部 Android 项目。

## 8. 剩余风险

- 样稿不是独立模型采样，真实需求仍可能漏行为、过度拆分或误提问题，需要人工复核。
- R 编号仅为 Markdown 引用，机器不会发现遗漏或错误引用；不能用测试通过代替需求覆盖审阅。
- 细分证据容易扩大敏感内容记录，必须继续采用脱敏结论与项目内定位，不复制凭据、PRD 全文或业务数据。
- 生命周期缺口须区分已证实的资源所有权约束与尚未确认的业务行为；本次没有 Android 运行证据。
- 已安装副本需走现有 install/doctor 更新并重开 Agent 会话；旧进度不能通过重编号或刷新 hash 追认。
