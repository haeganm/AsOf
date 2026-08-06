import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { recordSignal, type SignalDirection } from "../signals";

/**
 * The drop-in signal importer.
 *
 * Any local producer — a scanner, a screener, another project entirely — can
 * write a `*.jsonl` file into `data/inbox/` and its calls get sealed and graded
 * like everything else. One JSON object per line:
 *
 *   {"source":"myscanner","symbol":"NVDA","direction":"long",
 *    "kind":"orb_breakout","firedAt":"2026-08-06T09:35:00-04:00"}
 *
 * Required: source, symbol, kind, direction (long|short|info), firedAt.
 * Optional: knownAt (defaults to firedAt), title, detail, externalId, meta.
 *
 * Timestamps may carry any UTC offset — America/New_York stamps are normalised
 * to UTC. Sources are namespaced to `import:<name>` so an importer can never
 * impersonate a built-in source. Without an externalId, a content hash dedupes
 * re-drops of the same file. Files are archived to data/inbox/done/ after the
 * sweep; a malformed line is counted and reported, never silently dropped.
 *
 * Honesty note: a signal imported days after it fired is auto-flagged as
 * backfilled and stays off the live scorecard. Producers that want live grades
 * must drop their files promptly — that is the deal, and it is the right deal.
 */

export interface InboxResult {
  files: number;
  imported: number;
  duplicates: number;
  malformed: number;
}

const DIRECTIONS = new Set<string>(["long", "short", "info"]);

function inboxDir(root = process.cwd()) {
  return path.join(root, "data", "inbox");
}

/** Parse and validate one JSONL line; throws with a reason when unusable. */
export function parseInboxLine(line: string): Parameters<typeof recordSignal>[0] {
  const raw = JSON.parse(line) as Record<string, unknown>;
  const need = (key: string): string => {
    const v = raw[key];
    if (typeof v !== "string" || v.trim().length === 0) throw new Error(`missing "${key}"`);
    return v.trim();
  };

  const source = need("source").toLowerCase().replace(/^import:/, "");
  if (!/^[a-z0-9_-]{1,40}$/.test(source)) throw new Error(`source "${source}" must be a short slug`);
  const direction = need("direction");
  if (!DIRECTIONS.has(direction)) throw new Error(`direction must be long, short or info`);

  const toIso = (key: string, fallback?: string): string => {
    const v = raw[key];
    if (v === undefined || v === null || v === "") {
      if (fallback) return fallback;
      throw new Error(`missing "${key}"`);
    }
    const t = Date.parse(String(v));
    if (!Number.isFinite(t)) throw new Error(`"${key}" is not a parseable timestamp`);
    return new Date(t).toISOString();
  };

  const firedAt = toIso("firedAt");
  const knownAt = toIso("knownAt", firedAt);
  const symbol = need("symbol").toUpperCase();
  const kind = need("kind").toLowerCase();

  const externalId =
    typeof raw.externalId === "string" && raw.externalId.length > 0
      ? `sig:import:${source}:${raw.externalId}`
      : `sig:import:${source}:${crypto
          .createHash("sha256")
          .update(`${symbol}|${kind}|${firedAt}|${direction}`)
          .digest("hex")
          .slice(0, 24)}`;

  return {
    source: `import:${source}`,
    kind,
    symbol,
    direction: direction as SignalDirection,
    firedAt,
    knownAt,
    title:
      typeof raw.title === "string" && raw.title.length > 0
        ? raw.title.slice(0, 300)
        : `${source}: ${kind} on ${symbol}`,
    detail: typeof raw.detail === "string" ? raw.detail.slice(0, 2000) : null,
    externalId,
    meta: typeof raw.meta === "object" && raw.meta !== null ? (raw.meta as Record<string, unknown>) : {},
  };
}

/** Sweep data/inbox/*.jsonl into the signal store, archiving each file. */
export function sweepInbox(root = process.cwd()): InboxResult {
  const dir = inboxDir(root);
  fs.mkdirSync(path.join(dir, "done"), { recursive: true });
  const result: InboxResult = { files: 0, imported: 0, duplicates: 0, malformed: 0 };

  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    result.files++;

    const lines = fs
      .readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    for (const line of lines) {
      let input: Parameters<typeof recordSignal>[0];
      try {
        input = parseInboxLine(line);
      } catch {
        result.malformed++;
        continue;
      }
      if (recordSignal(input)) result.imported++;
      else result.duplicates++;
    }

    // Archive with a timestamp so the same filename can be dropped again later.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(file, path.join(dir, "done", `${stamp}-${name}`));
  }
  return result;
}
