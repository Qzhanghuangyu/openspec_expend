import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { FallaError } from '../errors.js';
import { toPhysicalName } from '../coordination/naming.js';
import { loadCoordination } from '../coordination/store.js';
import { readProjectFile, sha256 } from '../install/files.js';
import { convertChangeMetadata, convertLegacySchema } from './schema-converter.js';

const MAX_STRUCTURED_FILE_BYTES = 4 * 1024 * 1024;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseYaml(content, source) {
  try {
    const value = YAML.parse(content, { maxAliasCount: 100 });
    if (!isRecord(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new FallaError(1, `YAML 无法解析：${source}`);
  }
}

function mapDefaultSchema(schema) {
  if (schema === 'spec-driven') return 'falla-spec-driven';
  if (schema === 'task-driven') return 'falla-task-driven';
  return schema;
}

async function readVerifiedText(root, inventoryFile) {
  if (inventoryFile.size > MAX_STRUCTURED_FILE_BYTES) {
    throw new FallaError(1, `结构化迁移文件超过 4 MiB：${inventoryFile.path}`);
  }
  const absolute = path.join(root, ...inventoryFile.path.split('/'));
  const entry = await lstat(absolute);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new FallaError(1, `迁移源在扫描后发生变化：${inventoryFile.path}`);
  }
  const content = await readFile(absolute);
  if (sha256(content) !== inventoryFile.sha256) {
    throw new FallaError(1, `迁移源在扫描后发生变化：${inventoryFile.path}`);
  }
  return content.toString('utf8');
}

async function existingChangeNames(root) {
  const names = new Set();
  const changes = path.join(root, 'openspec', 'changes');
  try {
    const entries = await readdir(changes, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'archive') names.add(entry.name);
    }
    const archiveEntries = await readdir(path.join(changes, 'archive'), { withFileTypes: true });
    for (const entry of archiveEntries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
      if (match) names.add(match[1]);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }
  return names;
}

function childDescriptor(filePath, kind) {
  const parts = filePath.split('/');
  if (kind === 'active-child-change') {
    const parent = parts[2];
    const child = parts[4];
    return { parent, child, logical: `${parent}/${child}`, lifecycle: 'active' };
  }
  const archiveName = parts[3];
  const match = archiveName.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!match) throw new FallaError(1, `归档 change 缺少标准日期前缀：${archiveName}`);
  const child = parts[5];
  return {
    date: match[1],
    parent: match[2],
    child,
    logical: `${match[2]}/${child}`,
    lifecycle: 'archived',
  };
}

async function buildMappings(root, inventory) {
  const occupied = await existingChangeNames(root);
  const coordination = await loadCoordination(root);
  for (const mapping of Object.values(coordination.mappings)) occupied.add(mapping.physical);

  const descriptors = new Map();
  for (const file of inventory.files) {
    if (file.kind !== 'active-child-change' && file.kind !== 'archived-child-change') continue;
    const descriptor = childDescriptor(file.path, file.kind);
    const existing = descriptors.get(descriptor.logical);
    if (existing && existing.lifecycle !== descriptor.lifecycle) {
      throw new FallaError(1, `逻辑子 change 同时存在 active 和 archive：${descriptor.logical}`);
    }
    descriptors.set(descriptor.logical, descriptor);
  }

  const mappings = {};
  for (const logical of [...descriptors.keys()].sort()) {
    const descriptor = descriptors.get(logical);
    const existing = coordination.mappings[logical];
    const physical = existing?.physical
      ?? toPhysicalName(descriptor.parent, descriptor.child, occupied);
    occupied.add(physical);
    mappings[logical] = { ...descriptor, physical };
  }
  return { mappings, existing: coordination.mappings };
}

function changeDestination(file, mappings) {
  const parts = file.path.split('/');
  if (file.kind === 'active-parent-change') {
    return `openspec/changes/${parts[2]}/${parts.slice(3).join('/')}`;
  }
  if (file.kind === 'active-child-change') {
    const descriptor = childDescriptor(file.path, file.kind);
    return `openspec/changes/${mappings[descriptor.logical].physical}/${parts.slice(5).join('/')}`;
  }
  if (file.kind === 'archived-parent-change') {
    return `openspec/changes/archive/${parts[3]}/${parts.slice(4).join('/')}`;
  }
  const descriptor = childDescriptor(file.path, file.kind);
  return `openspec/changes/archive/${descriptor.date}-${mappings[descriptor.logical].physical}/${parts.slice(6).join('/')}`;
}

async function addOperation(root, operations, destinations, operation) {
  const { allowOverwrite = false, ...planned } = operation;
  if (!operation.to) {
    operations.push(planned);
    return;
  }
  const desiredHash = operation.sha256;
  const duplicate = destinations.get(operation.to);
  if (duplicate) {
    operations.push(duplicate === desiredHash
      ? { kind: 'skip', from: operation.from, to: operation.to, reason: 'duplicate-identical', sha256: desiredHash }
      : { kind: 'conflict', from: operation.from, to: operation.to, reason: 'planned-content-conflict', sha256: desiredHash });
    return;
  }
  destinations.set(operation.to, desiredHash);

  const target = await readProjectFile(root, operation.to);
  if (target !== null) {
    const targetHash = sha256(target);
    if (targetHash !== desiredHash) {
      if (allowOverwrite) {
        operations.push({ ...planned, expectedTargetHash: targetHash });
        return;
      }
      operations.push({
        kind: 'conflict',
        from: operation.from,
        to: operation.to,
        reason: 'target-different',
        sha256: desiredHash,
      });
      return;
    }
    operations.push({ kind: 'skip', from: operation.from, to: operation.to, reason: 'target-identical', sha256: desiredHash });
    return;
  }
  operations.push(planned);
}

async function planConfig(root, inventoryFile, operations, destinations) {
  const source = parseYaml(await readVerifiedText(root, inventoryFile), inventoryFile.path);
  if (typeof source.schema === 'string') source.schema = mapDefaultSchema(source.schema);
  const targetBuffer = await readProjectFile(root, 'openspec/config.yaml');
  let merged = source;
  if (targetBuffer !== null) {
    const targetText = targetBuffer.toString('utf8');
    const target = parseYaml(targetText, 'openspec/config.yaml');
    merged = { ...source, ...target };
    if (YAML.stringify(merged, { lineWidth: 0 }) === YAML.stringify(target, { lineWidth: 0 })) {
      operations.push({
        kind: 'skip',
        from: inventoryFile.path,
        to: 'openspec/config.yaml',
        reason: 'target-config-preserved',
        sha256: sha256(targetBuffer),
      });
      destinations.set('openspec/config.yaml', sha256(targetBuffer));
      return;
    }
  }
  const content = YAML.stringify(merged, { lineWidth: 0 });
  await addOperation(root, operations, destinations, {
    kind: 'write',
    from: inventoryFile.path,
    to: 'openspec/config.yaml',
    content,
    sha256: sha256(content),
    allowOverwrite: true,
  });
}

async function schemaDirectoryMap(root, inventory) {
  const result = new Map();
  for (const file of inventory.files) {
    if (file.kind !== 'legacy-schema' || !file.path.endsWith('/schema.yaml')) continue;
    const sourceDirectory = file.path.slice('mercuryspec/schemas/'.length, -'/schema.yaml'.length);
    const converted = convertLegacySchema(await readVerifiedText(root, file), { source: file.path });
    result.set(sourceDirectory, converted);
  }
  return result;
}

export async function planMigration(rootInput, inventory) {
  const root = await realpath(path.resolve(rootInput));
  if (inventory.root !== root) throw new FallaError(1, '扫描结果与迁移项目根不一致');
  const operations = [];
  const destinations = new Map();
  const { mappings, existing } = await buildMappings(root, inventory);
  const schemas = await schemaDirectoryMap(root, inventory);
  const schemasWithoutSpecs = [...schemas.values()]
    .filter(({ skipSpecs }) => skipSpecs)
    .map(({ name }) => name);
  const metadataAudit = [];

  for (const skipped of inventory.skipped) {
    operations.push({ kind: 'skip', from: skipped.path, reason: skipped.reason });
  }

  for (const file of inventory.files) {
    if (file.kind === 'legacy-config') {
      await planConfig(root, file, operations, destinations);
      continue;
    }
    if (file.kind === 'legacy-workflow-rule') {
      operations.push({ kind: 'skip', from: file.path, reason: 'workflow-rule-separated' });
      continue;
    }
    if (file.kind === 'current-rule') {
      operations.push({ kind: 'skip', from: file.path, to: file.path, reason: 'current-rule-preserved', sha256: file.sha256 });
      continue;
    }
    if (file.kind === 'legacy-rule') {
      const target = file.path.replace(/^\.falla\/spec\//, '.falla/skill-spec/');
      const current = await readProjectFile(root, target);
      if (current !== null) {
        operations.push({ kind: 'skip', from: file.path, to: target, reason: 'newer-rule-preserved', sha256: sha256(current) });
      } else {
        await addOperation(root, operations, destinations, {
          kind: 'copy', from: file.path, to: target, sha256: file.sha256,
        });
      }
      continue;
    }
    if (file.kind === 'business-spec') {
      await addOperation(root, operations, destinations, {
        kind: 'copy',
        from: file.path,
        to: file.path.replace(/^mercuryspec\/specs\//, 'openspec/specs/'),
        sha256: file.sha256,
      });
      continue;
    }
    if (file.kind === 'legacy-schema') {
      const sourceDirectory = file.path.slice('mercuryspec/schemas/'.length).split('/')[0];
      const converted = schemas.get(sourceDirectory);
      if (!converted) throw new FallaError(1, `旧 Schema 缺少 schema.yaml：${sourceDirectory}`);
      const targetDirectory = `openspec/schemas/${converted.name}`;
      if (file.path.endsWith('/schema.yaml')) {
        await addOperation(root, operations, destinations, {
          kind: 'write',
          from: file.path,
          to: `${targetDirectory}/schema.yaml`,
          content: converted.schemaYaml,
          sha256: sha256(converted.schemaYaml),
        });
        for (const template of converted.templates) {
          await addOperation(root, operations, destinations, {
            kind: 'write',
            from: file.path,
            to: `${targetDirectory}/${template.path}`,
            content: template.content,
            sha256: sha256(template.content),
          });
        }
      } else {
        const tail = file.path.slice(`mercuryspec/schemas/${sourceDirectory}/`.length);
        await addOperation(root, operations, destinations, {
          kind: 'copy', from: file.path, to: `${targetDirectory}/${tail}`, sha256: file.sha256,
        });
      }
      continue;
    }
    if (file.kind.endsWith('-change')) {
      const destination = changeDestination(file, mappings);
      if (file.path.endsWith('/.openspec.yaml')) {
        const converted = convertChangeMetadata(await readVerifiedText(root, file), {
          source: file.path,
          schemasWithoutSpecs,
        });
        if (converted.audit.parent) metadataAudit.push({ source: file.path, parent: converted.audit.parent });
        await addOperation(root, operations, destinations, {
          kind: 'write',
          from: file.path,
          to: destination,
          content: converted.content,
          sha256: sha256(converted.content),
        });
      } else {
        await addOperation(root, operations, destinations, {
          kind: 'copy', from: file.path, to: destination, sha256: file.sha256,
        });
      }
      continue;
    }
    operations.push({ kind: 'skip', from: file.path, reason: 'unclassified-legacy-file' });
  }

  if (Object.keys(mappings).length > 0) {
    const coordinationMappings = { ...existing };
    for (const [logical, mapping] of Object.entries(mappings)) {
      coordinationMappings[logical] = { physical: mapping.physical, parent: mapping.parent };
    }
    const content = YAML.stringify({ version: 1, mappings: coordinationMappings }, { lineWidth: 0 });
    await addOperation(root, operations, destinations, {
      kind: 'write',
      to: '.falla/coordination.yaml',
      content,
      sha256: sha256(content),
      allowOverwrite: true,
    });
  }

  return {
    version: 1,
    root,
    mappings,
    operations,
    warnings: [...inventory.warnings],
    audit: { metadata: metadataAudit },
  };
}
