import { FallaError } from '../errors.js';
import { doctorProject } from './doctor.js';
import { assertListContract, assertStatusContract } from '../openspec/contract.js';
import { runOpenSpec, runOpenSpecJson } from '../openspec/runner.js';
import { assertSupportedVersion } from '../openspec/version.js';
import { planMigration } from '../migration/planner.js';
import { scanLegacyProject } from '../migration/scanner.js';
import {
  applyMigration,
  recoverInterruptedMigrations,
  rollbackMigration,
} from '../migration/transaction.js';

const FALLA_SCHEMAS = [
  'falla-spec-driven',
  'falla-task-driven',
  'falla-legacy-spec-driven',
  'falla-legacy-task-driven',
];

async function validateWithOpenSpec(root, options) {
  const runnerOptions = {
    cwd: root,
    executable: options.executable ?? 'openspec',
    env: options.env,
  };
  assertSupportedVersion((await runOpenSpec(['--version'], runnerOptions)).stdout);
  for (const schema of FALLA_SCHEMAS) {
    await runOpenSpec(['schema', 'validate', schema], runnerOptions);
  }
  await runOpenSpec(['validate', '--all', '--strict'], runnerOptions);
  const list = assertListContract(await runOpenSpecJson(['list', '--json'], runnerOptions));
  for (const change of list.changes) {
    assertStatusContract(await runOpenSpecJson([
      'status', '--change', change.name, '--json',
    ], runnerOptions));
  }
}

export async function migrateProject(options) {
  if (options.rollback) {
    if (options.apply) throw new FallaError(1, '--apply 与 --rollback 不能同时使用');
    return rollbackMigration(options.root, options.rollback, { fs: options.fs });
  }
  if (options.apply) {
    const executable = options.executable ?? 'openspec';
    assertSupportedVersion((await runOpenSpec(['--version'], {
      cwd: options.root,
      executable,
      env: options.env,
    })).stdout);
    await recoverInterruptedMigrations(options.root, { fs: options.fs });
  }

  const inventory = await scanLegacyProject(options.root);
  const plan = await planMigration(inventory.root, inventory);
  if (!options.apply) return plan;

  const validator = options.validateCandidate
    ?? ((candidate) => validateWithOpenSpec(candidate, options));
  return applyMigration(inventory.root, plan, {
    fs: options.fs,
    validateCandidate: validator,
    validateTarget: async (root) => {
      await (options.validateTarget ?? ((target) => validateWithOpenSpec(target, options)))(root);
      const doctor = await doctorProject({
        root,
        executable: options.executable ?? 'openspec',
        env: options.env,
      });
      if (!doctor.ok) throw new FallaError(1, '迁移后 doctor 未通过');
    },
  });
}
