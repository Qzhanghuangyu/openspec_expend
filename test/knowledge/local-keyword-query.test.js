import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { buildKnowledgeIndex } from '../../src/knowledge/index/build.js';
import {
  INDEX_CONFIG_PATH,
  LOCAL_KEYWORD_MODEL,
  defaultIndexConfig,
} from '../../src/knowledge/index/config.js';
import { queryKnowledgeIndex } from '../../src/knowledge/index/query.js';

const SOURCE = 'app/src/main/java/Demo.kt';

function entry(id, { aliases, intents, applicable = '', notApplicable = '' }) {
  const data = {
    'schema-version': 1, id, kind: 'component', scope: 'project', status: 'draft',
    platform: 'android-view', aliases, intents, tags: [],
    codegraph: { 'primary-symbol': 'Demo', 'related-symbols': [] },
    'source-files': [SOURCE], 'layout-resources': [], tests: [],
    'source-hashes': {}, 'last-verified': null, 'verified-by': '',
  };
  return `---\n${YAML.stringify(data)}---\n# ${id}\n\n## 适用场景\n\n${applicable}\n\n## 不适用场景\n\n${notApplicable}\n`;
}

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-local-query-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, '.falla/ui-knowledge/components'), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await writeFile(path.join(root, SOURCE), 'class Demo\n');
  const config = defaultIndexConfig();
  config.semantic = {
    ...config.semantic,
    provider: 'local-keyword',
    model: LOCAL_KEYWORD_MODEL,
    dimensions: 512,
  };
  await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(config));
  const entries = {
    'anim-view': entry('anim-view', {
      aliases: ['VAP 播放器', 'MP4 透明动画控件'],
      intents: ['播放本地 VAP MP4 动画'],
      applicable: '播放本地 MP4 动效。',
    }),
    'h5-animation-view': entry('h5-animation-view', {
      aliases: ['H5 MP4 播放器'],
      intents: ['在 H5 页面播放透明 MP4'],
      applicable: 'WebView 上方播放 MP4 或 SVGA。',
    }),
    'svga-image-view': entry('svga-image-view', {
      aliases: ['SVGA 播放器'],
      intents: ['播放 SVGA 动画'],
      applicable: '播放 SVGA 文件。',
      notApplicable: '播放 MP4 时不应该使用本组件。',
    }),
    'standard-list': entry('standard-list', {
      aliases: ['RecyclerView 列表'],
      intents: ['分页与空状态'],
      applicable: '展示分页列表。',
    }),
  };
  for (const [id, markdown] of Object.entries(entries)) {
    await writeFile(path.join(root, `.falla/ui-knowledge/components/${id}.md`), markdown);
  }
  await buildKnowledgeIndex(root);
  return root;
}

test('播放MP4 优先召回 AnimView 和 H5AnimationView', async (t) => {
  const root = await fixture(t);
  const report = await queryKnowledgeIndex(root, '播放MP4', { topK: 4 });
  const ids = report.candidates.map(candidate => candidate.id);
  assert.deepEqual(ids.slice(0, 2), ['anim-view', 'h5-animation-view']);
  assert.ok(ids.indexOf('svga-image-view') > 1);
  assert.ok(['metadata', '适用场景'].includes(report.candidates[0].matchedSections[0]));
});
