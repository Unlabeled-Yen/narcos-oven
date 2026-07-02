/**
 * ImportRun CRUD wrappers
 */
import type { ImportResolution, ImportRun } from "../domain/models";
import { db } from "./schema";

export async function saveImportRun(run: ImportRun): Promise<void> {
  await db.import_runs.put(run);
}

export async function getLatestUnresolved(): Promise<ImportRun | undefined> {
  const list = await db.import_runs
    .filter((r) => r.fully_resolved_at === null)
    .toArray();
  return list.sort((a, b) => (a.imported_at < b.imported_at ? 1 : -1))[0];
}

export async function addResolution(
  runId: string,
  resolution: ImportResolution
): Promise<void> {
  const run = await db.import_runs.get(runId);
  if (!run) return;
  run.resolutions[resolution.order_id] = resolution;
  const needsResolution =
    run.diff.disappeared.length + run.diff.fields_changed.length;
  const resolved = Object.keys(run.resolutions).length;
  if (resolved >= needsResolution) {
    run.fully_resolved_at = new Date().toISOString();
  }
  await db.import_runs.put(run);
}

export async function listAll(): Promise<ImportRun[]> {
  return db.import_runs.orderBy("imported_at").reverse().toArray();
}
