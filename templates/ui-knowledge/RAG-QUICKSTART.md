# UI 知识 RAG 快速使用

> 更新日期：2026-09-20。Markdown 是事实源，`.index/` 只是可删除、可重建的本地缓存。

## 1. 准备命令

未执行 `npm link` 时：

```bash
export FALLA_HOME="/path/to/falla-openspec"
export TARGET_PROJECT="/path/to/android-project"

falla() {
  node "$FALLA_HOME/bin/falla-openspec.js" "$@"
}
```

## 2. 配置本地检索

首次测试时复制配置：

```bash
cp "$TARGET_PROJECT/.falla/ui-knowledge/config.example.yaml" \
   "$TARGET_PROJECT/.falla/ui-knowledge/config.yaml"
```

将 `semantic` 修改为：

```yaml
semantic:
  provider: local-keyword
  model: local-keyword-v1
  dimensions: 512
  indexPath: .falla/ui-knowledge/.index
  topK: 8
```

`local-keyword` 不需要网络或 API Key，支持中文字符/词组、英文 token 与轻微拼写差异，并对 metadata、适用场景和不适用场景使用不同权重。`fake` 仅用于自动化机制测试。

## 3. 首次构建

```bash
falla ui-knowledge validate --project "$TARGET_PROJECT" --json
falla ui-knowledge index build --project "$TARGET_PROJECT" --json
falla ui-knowledge index status --project "$TARGET_PROJECT" --json
```

`build` 拒绝覆盖已有索引。

## 4. 查询

```bash
falla ui-knowledge index query \
  --project "$TARGET_PROJECT" \
  --text "H5 页面播放透明 MP4" \
  --top-k 5 \
  --json
```

结果中的复用状态：

- `reference-only`：draft，只能参考。
- `direct-reuse-candidate`：verified 且指纹有效，仍需 CodeGraph 和生命周期核对。
- `rejected`：失效、非法或 stale，禁止直接复用。

## 5. 知识增加或修改后

新增、修改或删除 Markdown 后执行：

```bash
falla ui-knowledge index sync --project "$TARGET_PROJECT" --json
```

`sync` 只重新生成新增和变化条目的向量；无变化时 `embeddedChunks` 应为 `0`。

## 6. 何时重建

Provider、模型、向量维度、Schema 或分块版本变化时：

```bash
falla ui-knowledge index rebuild --project "$TARGET_PROJECT" --json
```

## 7. 清理索引

```bash
falla ui-knowledge index clear --project "$TARGET_PROJECT" --json
```

只删除：

```text
.falla/ui-knowledge/.index/
```

不会删除 Markdown 和 `config.yaml`。

## 8. 常见错误

- `Embedding Provider` 未配置：检查 `config.yaml` 的 `semantic.provider`。
- `index-already-exists`：已有索引应使用 `sync` 或 `rebuild`。
- `index-not-found`：先执行 `build`。
- `index-rebuild-required`：Provider、模型或维度变化，执行 `rebuild`。
- `stale`：源码或 Markdown 已变化，先核对条目，再执行 `sync`。

## 9. 日常推荐顺序

```text
新增/修改知识 Markdown
→ validate
→ sync
→ query
→ CodeGraph 验证候选
→ 决定 direct-reuse / reference-only / rejected
```

不要提交 `.falla/ui-knowledge/.index/`，不要在配置或索引中保存 API Key、Token、Cookie 或密码。
