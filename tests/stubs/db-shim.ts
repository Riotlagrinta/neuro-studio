// Stands in for src/lib/db.ts: same tagged-template API as Neon's `sql`, backed by a real Postgres (PGlite).
import type { PGlite } from "@electric-sql/pglite";

let pg: PGlite;
export const setDb = (db: PGlite) => (pg = db);

// Neon returns bigint columns as strings; mirror that so the code under test sees the same shapes.
const normalize = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

export async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "");
  const res = await pg.query(text, values as unknown[]);
  return res.rows.map((r) => normalize(r as Record<string, unknown>));
}
