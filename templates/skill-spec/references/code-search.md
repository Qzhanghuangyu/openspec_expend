# CodeGraph 与源码检索

## 何时读取

当前阶段需要定位代码、判断调用关系或分析影响面时读取。

## 工具选择

- 已知名称、路径或字面文本时，用限定目录和类型的 `rg`；已知路径直接读，查文件名用 `rg --files`。
- 入口未知或需要调用链、继承、动态分派、状态流、生命周期、影响面及测试时，用 CodeGraph。
- 修改公共类、公共方法、共享模型、基类、Repository/API 签名或跨模块组件前，必须用 CodeGraph
  核对影响面。
- XML、Manifest、Gradle、资源、路由字符串、注解和接口字段最终使用有界文本检索核对。
- 已知入口用 `rg → CodeGraph`，未知入口用 `CodeGraph → rg`；不机械地同时调用。

## Git 历史边界

- 默认分析当前工作树，不读取 `git log`、`git show <commit>`、`git blame`、`git reflog` 或 `git rev-list`。
- 只有用户明确要求分析变更沿革、回归来源或具体提交时，才读取与问题直接相关的有限文件和提交。
- 同一问题只做一次有界批量查询，不反复读取历史。
- `git status --short` 和限定相关路径的 `git diff -- <paths>` 可用于识别当前未提交改动，但不得输出
  无关 diff 或敏感正文。

## 索引与降级

- Codex 每阶段执行 `falla-openspec codegraph prepare --json`；Claude 由 Skill Hook 准备。
  源码变化、切换分支或上次失败后重新准备。
- 未启用时 prepare 是空操作；不可用时可降级为有界 `rg`/`find`，但文本命中不能冒充真实调用关系。
- 最终结论必须核对当前磁盘源码、构建配置和生命周期代码。
- 禁止索引或输出凭据、签名、`local.properties`、环境变量、`google-services.json` 和构建产物。
