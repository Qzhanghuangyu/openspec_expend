import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { doctorProject } from './doctor.js';
import {
  applyManagedFileRemovalPlan,
  applyManagedFilePlan,
  collectManagedFiles,
  planManagedFileRemovals,
  planManagedFiles,
} from '../install/files.js';
import { ensureLocalIndexesIgnored } from '../install/gitignore.js';
import {
  applyHookRemovalPlan,
  applyHookRegistrationPlan,
  isHookRegistrationPath,
  planHookRemovals,
  planHookRegistrations,
} from '../install/hooks.js';
import {
  getFallaVersion,
  loadInstallManifest,
  manifestsMatch,
  saveInstallManifest,
} from '../install/manifest.js';
import { runOpenSpec } from '../openspec/runner.js';
import { assertSupportedVersion } from '../openspec/version.js';
import { withProjectLock } from '../locks.js';
import {
  installCodeGraph,
  selectCodeGraphInstallation,
} from '../ui/codegraph.js';
import {
  installFigmaMcp,
  selectFigmaMcpInstallation,
} from '../ui/figma-mcp.js';
import {
  installLarkCli,
  selectLarkCliInstallation,
} from '../ui/lark-cli.js';
import { selectTools } from '../ui/tool-select.js';
import { showWelcomeScreen } from '../ui/welcome-screen.js';

const TOOL_CHOICES = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
];

async function requireProjectRoot(rootInput) {
  const candidate = path.resolve(rootInput);
  let entry;
  try {
    entry = await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new FallaError(1, `项目目录不存在：${candidate}`);
    }
    throw error;
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new FallaError(1, '项目根必须是真实目录，不能是符号链接');
  }
  const root = await realpath(candidate);
  const openspecPath = path.join(root, 'openspec');
  let openspecEntry;
  try {
    openspecEntry = await lstat(openspecPath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new FallaError(1, '项目尚未初始化 OpenSpec；请先运行 openspec init');
    }
    throw error;
  }
  if (openspecEntry.isSymbolicLink() || !openspecEntry.isDirectory()) {
    throw new FallaError(1, 'openspec 必须是项目内真实目录，不能是符号链接');
  }
  return root;
}

async function defaultLarkIntegration() {
  await installLarkCli();
}

function sortedFiles(files) {
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

export async function installProject(options) {
  const root = await requireProjectRoot(options.root);
  const executable = options.executable ?? 'openspec';
  const version = assertSupportedVersion((await runOpenSpec(['--version'], {
    cwd: root,
    executable,
    env: options.env,
  })).stdout);

  const interactive = options.interactive === true;
  const ui = {
    showWelcomeScreen,
    selectTools,
    selectFigma: selectFigmaMcpInstallation,
    selectCodeGraph: selectCodeGraphInstallation,
    selectLark: selectLarkCliInstallation,
    ...options.ui,
  };
  if (interactive) await ui.showWelcomeScreen({ interactive: true });
  const selectedTools = options.tools ?? (interactive
    ? await ui.selectTools(TOOL_CHOICES, { interactive: true })
    : TOOL_CHOICES.map(({ id }) => id));
  const tools = [...new Set(selectedTools)];
  const withFigma = options.withFigma ?? (interactive
    ? await ui.selectFigma({ interactive: true })
    : false);
  const withCodeGraph = options.withCodeGraph ?? (interactive
    ? await ui.selectCodeGraph({ interactive: true })
    : false);
  const withLark = options.withLark ?? (interactive
    ? await ui.selectLark({ interactive: true })
    : false);

  return withProjectLock(root, 'install', async () => {
  const previous = await loadInstallManifest(root);
  const previousFiles = previous?.files ?? {};
  const managedFiles = await collectManagedFiles(tools);
  const managedPlan = await planManagedFiles(root, managedFiles, previousFiles);
  const hookPlan = await planHookRegistrations(root, tools, previousFiles);
  const desiredPaths = new Set([
    ...managedPlan.map(({ relativePath }) => relativePath),
    ...hookPlan.map(({ relativePath }) => relativePath),
  ]);
  const obsoletePaths = Object.keys(previousFiles).filter((relativePath) =>
    !desiredPaths.has(relativePath));
  const hookRemovalPaths = obsoletePaths.filter(isHookRegistrationPath);
  const fileRemovalPaths = obsoletePaths.filter((relativePath) =>
    !isHookRegistrationPath(relativePath));
  const fileRemovalPlan = await planManagedFileRemovals(
    root, fileRemovalPaths, previousFiles
  );
  const hookRemovalPlan = await planHookRemovals(root, hookRemovalPaths, previousFiles);
  const gitIgnore = await ensureLocalIndexesIgnored(root);

  await applyManagedFilePlan(root, managedPlan);
  await applyHookRegistrationPlan(root, hookPlan);
  await applyManagedFileRemovalPlan(root, fileRemovalPlan);
  await applyHookRemovalPlan(root, hookRemovalPlan);

  const files = {};
  for (const item of managedPlan) files[item.relativePath] = item.desiredHash;
  for (const item of hookPlan) files[item.relativePath] = item.managedHash;

  const codeGraphEnabled = withCodeGraph === true
    || previous?.integrations?.codegraph === true;
  const candidateManifest = {
    formatVersion: 3,
    fallaVersion: await getFallaVersion(),
    openSpecVersion: version.raw,
    installedAt: String(options.now?.() ?? new Date().toISOString()),
    tools: [...tools].sort(),
    integrations: { codegraph: codeGraphEnabled },
    files: sortedFiles(files),
  };
  if (manifestsMatch(previous, candidateManifest)) {
    candidateManifest.installedAt = previous.installedAt;
  }
  const manifestWritten = await saveInstallManifest(root, candidateManifest);

  const doctor = await doctorProject({ root, executable, env: options.env });
  const warnings = [];
  const integrations = options.integrations ?? {};
  if (withFigma === true) {
    try {
      const results = await (integrations.installFigma ?? installFigmaMcp)(tools);
      for (const result of results ?? []) {
        if (result.success === false) warnings.push({ integration: 'figma', tool: result.toolId });
      }
    } catch {
      warnings.push({ integration: 'figma' });
    }
  }
  if (withCodeGraph === true) {
    try {
      const installer = integrations.installCodeGraph
        ?? ((toolIds, projectRoot) => installCodeGraph(
          toolIds, projectRoot, undefined, { env: options.env }
        ));
      await installer(tools, root);
    } catch {
      warnings.push({ integration: 'codegraph' });
    }
  }
  if (withLark === true) {
    try {
      await (integrations.installLark ?? defaultLarkIntegration)();
    } catch {
      warnings.push({ integration: 'lark' });
    }
  }

  return {
    ok: doctor.ok,
    tools,
    integrations: candidateManifest.integrations,
    written: [
      ...managedPlan.filter(({ action }) => action === 'write').map(({ relativePath }) => relativePath),
      ...hookPlan.filter(({ action }) => action === 'write').map(({ relativePath }) => relativePath),
      ...(gitIgnore.action === 'write' ? [gitIgnore.relativePath] : []),
      ...(manifestWritten ? ['.falla/install-manifest.json'] : []),
    ].sort(),
    skipped: [
      ...managedPlan.filter(({ action }) => action === 'skip').map(({ relativePath }) => relativePath),
      ...hookPlan.filter(({ action }) => action === 'skip').map(({ relativePath }) => relativePath),
      ...(gitIgnore.action === 'skip' ? [gitIgnore.relativePath] : []),
    ].sort(),
    removed: [
      ...fileRemovalPlan.filter(({ action }) => action === 'delete')
        .map(({ relativePath }) => relativePath),
      ...hookRemovalPlan.filter(({ action }) => action === 'write')
        .map(({ relativePath }) => relativePath),
    ].sort(),
    warnings,
    doctor,
  };
  });
}
