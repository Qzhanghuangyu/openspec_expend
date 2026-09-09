import { stat } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { assertListContract, assertStatusAllContract } from '../openspec/contract.js';
import { runOpenSpec, runOpenSpecJson } from '../openspec/runner.js';
import { assertSupportedVersion, SUPPORTED_OPENSPEC_RANGE } from '../openspec/version.js';
import { validateCoordination } from '../coordination/dag.js';
import { loadCoordination } from '../coordination/store.js';
import { readProjectFile, sha256 } from '../install/files.js';
import {
  getHookRegistrationHash,
  isHookRegistrationPath,
} from '../install/hooks.js';
import { loadInstallManifest } from '../install/manifest.js';

const SCHEMA_NAMES = [
  'falla-spec-driven',
  'falla-task-driven',
];

async function exists(candidate, kind) {
  try {
    const entry = await stat(candidate);
    return kind === 'directory' ? entry.isDirectory() : entry.isFile();
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function doctorProject(options) {
  const root = path.resolve(options.root);
  const executable = options.executable ?? 'openspec';
  const checks = [];

  const versionResult = await runOpenSpec(['--version'], {
    cwd: root,
    executable,
    env: options.env,
  });
  const version = assertSupportedVersion(versionResult.stdout);
  checks.push({ id: 'openspec-version', ok: true });

  const initialized = await exists(path.join(root, 'openspec'), 'directory');
  checks.push({ id: 'openspec-project', ok: initialized });

  const statusByChange = new Map();
  if (initialized) {
    const list = assertListContract(await runOpenSpecJson(['list', '--json'], {
      cwd: root,
      executable,
      env: options.env,
    }));
    checks.push({ id: 'openspec-list', ok: true, count: list.changes.length });

    const batchStatus = assertStatusAllContract(await runOpenSpecJson([
      'status', '--all', '--json',
    ], { cwd: root, executable, env: options.env }));
    for (const status of batchStatus.changes) {
      statusByChange.set(status.changeName, status);
    }
    const listedNames = list.changes.map(({ name }) => name).sort();
    const statusNames = [...statusByChange.keys()].sort();
    if (JSON.stringify(listedNames) !== JSON.stringify(statusNames)) {
      throw new FallaError(3, 'OpenSpec list 与 status --all 的 change 集合不一致');
    }
    checks.push({ id: 'openspec-status', ok: true, count: list.changes.length });
  }

  let installedSchemas = 0;
  for (const schemaName of SCHEMA_NAMES) {
    if (await exists(path.join(root, 'openspec', 'schemas', schemaName, 'schema.yaml'), 'file')) {
      installedSchemas += 1;
    }
  }
  const allSchemasInstalled = installedSchemas === SCHEMA_NAMES.length;
  checks.push({ id: 'falla-schemas', ok: allSchemasInstalled, count: installedSchemas });

  let validSchemas = 0;
  if (initialized) {
    for (const schemaName of SCHEMA_NAMES) {
      if (!await exists(path.join(root, 'openspec', 'schemas', schemaName, 'schema.yaml'), 'file')) {
        continue;
      }
      try {
        await runOpenSpec(['schema', 'validate', schemaName], {
          cwd: root,
          executable,
          env: options.env,
        });
        validSchemas += 1;
      } catch {
        // doctor 只报告检查结果，不回显 OpenSpec 输出或 Schema 内容。
      }
    }
  }
  checks.push({
    id: 'falla-schema-validation',
    ok: validSchemas === SCHEMA_NAMES.length,
    count: validSchemas,
  });

  const manifestPresent = await exists(
    path.join(root, '.falla', 'install-manifest.json'),
    'file'
  );
  let manifest = null;
  if (manifestPresent) {
    try {
      manifest = await loadInstallManifest(root);
    } catch {
      // 格式错误由检查结果表示，避免把文件内容带入报告。
    }
  }
  checks.push({ id: 'falla-install-manifest', ok: manifest !== null });

  const driftedPaths = [];
  if (manifest) {
    for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
      try {
        if (isHookRegistrationPath(relativePath)) {
          const actualHash = await getHookRegistrationHash(root, relativePath);
          if (actualHash !== expectedHash) driftedPaths.push(relativePath);
          continue;
        }
        const content = await readProjectFile(root, relativePath);
        if (content === null || sha256(content) !== expectedHash) driftedPaths.push(relativePath);
      } catch {
        driftedPaths.push(relativePath);
      }
    }
  }
  driftedPaths.sort();
  checks.push({
    id: 'falla-install-integrity',
    ok: manifest !== null && driftedPaths.length === 0,
    paths: driftedPaths,
  });

  const coordinationPresent = await exists(
    path.join(root, '.falla', 'coordination.yaml'),
    'file'
  );
  let coordinationParents = 0;
  let coordinationErrors = 0;
  if (coordinationPresent) {
    try {
      const coordination = await loadCoordination(root);
      const parents = [...new Set(
        Object.values(coordination.mappings).map(({ parent }) => parent)
      )].sort();
      coordinationParents = parents.length;
      for (const parent of parents) {
        const result = await validateCoordination(root, {
          change: parent,
          statusProvider: async (physical) => statusByChange.get(physical) ?? null,
        });
        coordinationErrors += result.errors.length;
      }
    } catch {
      coordinationErrors += 1;
    }
  }
  checks.push({
    id: 'falla-coordination',
    ok: coordinationErrors === 0,
    present: coordinationPresent,
    parents: coordinationParents,
    errors: coordinationErrors,
  });

  return {
    ok: checks.every((check) => check.ok),
    openSpec: {
      executable,
      version: version.raw,
      supportedRange: SUPPORTED_OPENSPEC_RANGE,
    },
    node: { version: process.versions.node },
    project: { root, initialized },
    schemas: {
      expected: SCHEMA_NAMES.length,
      installed: installedSchemas,
      valid: validSchemas,
    },
    install: {
      manifest: manifestPresent,
      valid: manifest !== null,
      driftCount: driftedPaths.length,
    },
    coordination: {
      present: coordinationPresent,
      parents: coordinationParents,
      errors: coordinationErrors,
    },
    checks,
  };
}
