import { getDb, newId, nowIso } from "../db";

/** Ingestion bookkeeping, so a source that quietly stopped working is visible. */

export function startRun(source: string, target: string | null): string {
  const id = newId("run");
  getDb()
    .prepare("insert into ingest_runs (id,source,target,startedAt,finishedAt,ok,note) values (?,?,?,?,null,null,null)")
    .run(id, source, target, nowIso());
  return id;
}

export function finishRun(id: string, ok: boolean, note?: string) {
  getDb()
    .prepare("update ingest_runs set finishedAt=?, ok=?, note=? where id=?")
    .run(nowIso(), ok ? 1 : 0, note?.slice(0, 500) ?? null, id);
}

export interface IngestRun {
  id: string;
  source: string;
  target: string | null;
  startedAt: string;
  finishedAt: string | null;
  ok: number | null;
  note: string | null;
}

export function recentRuns(limit = 20): IngestRun[] {
  return getDb()
    .prepare("select * from ingest_runs order by startedAt desc limit ?")
    .all(limit) as IngestRun[];
}

export function lastRunFor(source: string, target?: string): IngestRun | null {
  const params: unknown[] = [source];
  let clause = "";
  if (target) {
    clause = "and target=?";
    params.push(target);
  }
  return (
    (getDb()
      .prepare(`select * from ingest_runs where source=? ${clause} order by startedAt desc limit 1`)
      .get(...params) as IngestRun) ?? null
  );
}
