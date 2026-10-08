import "./stubs/env-setup";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { setDb } from "./stubs/db-shim";
import { setUser } from "./stubs/auth-stub";
import { authorize, DAILY_LIMITS, getBalance, getLedger, refund, refundByRef } from "../src/lib/access";
import { applyMarkup, billingEnabled, billingMarkup, chargeFor, signupBonus } from "../src/lib/billing";
import { explain } from "../src/lib/errors";
import { upsertUser } from "../src/lib/users";

const schemaSql = readFileSync("db/schema.sql", "utf8");

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ok -", name);
  } catch (e) {
    failed++;
    console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 420));
  }
}

const withEnv = async (vars: Record<string, string | undefined>, fn: () => void | Promise<void>) => {
  const before: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) before[k] = process.env[k];
  const apply = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  apply(vars);
  try {
    await fn();
  } finally {
    apply(before);
  }
};

// ============================================================================================ pure helpers
async function pureHelpers() {
  console.log("\n=== pricing helpers ===");
  await t("applyMarkup rounds UP to the ledger's 4 decimals and ignores floating-point noise", () => {
    assert.equal(applyMarkup(0.35, 1.5), 0.525);
    assert.equal(applyMarkup(0.1 + 0.2, 1.5), 0.45, "0.30000000000000004 x 1.5 must not charge 0.4501");
    assert.equal(applyMarkup(0.065, 1.5), 0.0975);
    assert.equal(applyMarkup(0.0001, 1.5), 0.0002, "a fraction of the last decimal rounds up, never down");
    assert.equal(applyMarkup(5 * 0.013, 2), 0.13);
    for (let i = 1; i <= 2000; i++) {
      const cost = i / 1000;
      const charge = applyMarkup(cost, 1.5);
      assert.ok(charge >= cost * 1.5 - 1e-9 && charge < cost * 1.5 + 1e-4, `cost ${cost}: charged ${charge}`);
      assert.equal(Math.round(charge * 1e4) / 1e4, charge, "at most 4 decimals");
    }
  });
  await t("a free, negative or non-finite cost charges nothing; a bad markup never means free", () => {
    for (const cost of [0, -1, NaN, Infinity, -Infinity]) assert.equal(applyMarkup(cost, 1.5), 0, String(cost));
    for (const markup of [NaN, 0, 0.5, -3, Infinity]) assert.equal(applyMarkup(0.4, markup), 0.4, `markup ${markup} falls back to cost`);
  });
  await t("env parsing: billing is off unless exactly 'true'; markup >= 1 (1.5 by default); the bonus is clamped", async () => {
    for (const v of [undefined, "", "false", "1", "yes", "TRUE "]) {
      await withEnv({ BILLING_ENABLED: v }, () => assert.equal(billingEnabled(), v === "TRUE ", String(v)));
    }
    for (const [v, want] of [[undefined, 1.5], ["", 1.5], ["abc", 1.5], ["0.5", 1.5], ["-2", 1.5], ["1", 1], ["2.25", 2.25], ["1000", 100]] as const) {
      await withEnv({ BILLING_MARKUP: v }, () => assert.equal(billingMarkup(), want, String(v)));
    }
    for (const [v, want] of [[undefined, 0], ["abc", 0], ["-1", 0], ["2", 2], ["99999", 1000]] as const) {
      await withEnv({ SIGNUP_BONUS_USD: v }, () => assert.equal(signupBonus(), want, String(v)));
    }
    await withEnv({ BILLING_MARKUP: "2" }, () => assert.equal(chargeFor(0.35), 0.7));
  });
  await t("SOLDE_INSUFFISANT has a French explanation that points to the credits page", () => {
    assert.match(explain("SOLDE_INSUFFISANT"), /Crédits insuffisants/);
  });
}

// ============================================================================================ database scenarios
async function scenario() {
  console.log("\n=== ledger on PGlite ===");
  const db = new PGlite();
  setDb(db);
  await db.exec(schemaSql);
  await t("schema.sql applies twice in a row (idempotent)", async () => {
    await db.exec(schemaSql);
  });

  process.env.ALLOWED_EMAILS = "a@example.com, b@example.com";
  process.env.DAILY_COST_CAP_USD = "1000";
  const A = { id: await upsertUser({ email: "a@example.com", name: "Alice" }), email: "a@example.com", name: "Alice" };
  const B = { id: await upsertUser({ email: "b@example.com", name: "Bob" }), email: "b@example.com", name: "Bob" };

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
  const balance = async (id: string) => Number((await q<{ b: string }>(`SELECT credit_balance($1::uuid)::float AS b`, [id]))[0].b);
  const credit = async (id: string, amount: number, reason = "topup", ref: string | null = null) => (await q<{ id: string | null }>(`SELECT credit_user($1::uuid, $2::numeric, $3, $4) AS id`, [id, amount, reason, ref]))[0].id;
  const events = async (id: string) => Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = $1::uuid AND NOT refunded`, [id]))[0].n);
  const ledgerRows = async (id: string) => Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE user_id = $1::uuid`, [id]))[0].n);
  const reset = async () => {
    await db.exec("DELETE FROM credit_ledger; DELETE FROM usage_events");
  };

  // ---------------------------------------------------------------- billing off
  console.log("billing off (the default)");
  await t("authorize behaves as before and writes nothing to the ledger", async () => {
    await reset();
    setUser(A);
    const r = await authorize("voice", 0.5);
    assert.equal(r.ok, true);
    assert.equal(await ledgerRows(A.id), 0);
    assert.equal(await events(A.id), 1);
    if (r.ok) await refund(r.eventId);
    assert.equal(await events(A.id), 0, "the old refund path still works");
    assert.equal(await ledgerRows(A.id), 0);
  });

  await withEnv({ BILLING_ENABLED: "true", BILLING_MARKUP: "1.5" }, async () => {
    // ---------------------------------------------------------------- charging
    console.log("billing on: charging");
    await t("no credits: SOLDE_INSUFFISANT, no event, no ledger row — and it is not reported as a quota", async () => {
      await reset();
      setUser(A);
      const r = await authorize("voice", 0.4);
      assert.deepEqual(r, { ok: false, error: "SOLDE_INSUFFISANT" });
      assert.equal(await events(A.id), 0);
      assert.equal(await ledgerRows(A.id), 0);
    });
    await t("a free action (cost 0) needs no credits and writes no debit", async () => {
      await reset();
      setUser(A);
      assert.equal((await authorize("image", 0)).ok, true);
      assert.equal(await ledgerRows(A.id), 0);
    });
    await t("an action costing 0.4 is charged 0.6 and the balance goes down by exactly that", async () => {
      await reset();
      setUser(A);
      assert.ok(await credit(A.id, 1, "topup", "momo-1"));
      const r = await authorize("voice", 0.4);
      assert.equal(r.ok, true);
      assert.equal(await balance(A.id), 0.4);
      const [row] = await q<{ delta: string; reason: string; ref: string }>(`SELECT delta, reason, ref FROM credit_ledger WHERE reason = 'debit'`);
      assert.deepEqual([Number(row.delta), row.ref], [-0.6, r.ok ? r.eventId : ""]);
    });
    await t("the next action is refused when the balance no longer covers its charged price (0.4 < 0.6)", async () => {
      setUser(A);
      assert.deepEqual(await authorize("voice", 0.4), { ok: false, error: "SOLDE_INSUFFISANT" });
      assert.equal(await balance(A.id), 0.4, "a refusal charges nothing");
    });
    await t("the exact balance is enough (charge == balance leaves 0), one cent more is not", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 0.6, "topup", "momo-2");
      assert.equal((await authorize("voice", 0.4)).ok, true);
      assert.equal(await balance(A.id), 0);
      await credit(A.id, 0.59, "topup", "momo-3");
      assert.deepEqual(await authorize("voice", 0.4), { ok: false, error: "SOLDE_INSUFFISANT" });
    });
    await t("quota reached with plenty of credits is QUOTA_ATTEINTE, not a balance problem", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 100, "topup", "momo-4");
      for (let i = 0; i < DAILY_LIMITS.video; i++) assert.equal((await authorize("video", 0.1)).ok, true);
      assert.deepEqual(await authorize("video", 0.1), { ok: false, error: "QUOTA_ATTEINTE" });
      await withEnv({ DAILY_COST_CAP_USD: "0.5" }, async () => assert.deepEqual(await authorize("refine", 0.5), { ok: false, error: "QUOTA_ATTEINTE" }, "the dollar cap still applies"));
    });
    await t("users cannot spend each other's credits", async () => {
      await reset();
      await credit(A.id, 10, "topup", "momo-5");
      setUser(B);
      assert.deepEqual(await authorize("voice", 0.4), { ok: false, error: "SOLDE_INSUFFISANT" });
      assert.equal(await balance(A.id), 10);
    });
    await t("NaN / Infinity / negative costs are refused or free, never a negative or NaN ledger row", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 5, "topup", "momo-6");
      for (const cost of [NaN, Infinity, -Infinity, -5]) {
        const r = await authorize("refine", cost);
        assert.ok(!r.ok || cost === -5 || cost === -Infinity, `cost ${cost}`);
      }
      const bad = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE delta = 'NaN'::numeric OR (reason = 'debit' AND delta >= 0)`);
      assert.equal(Number(bad[0].n), 0);
      assert.ok((await balance(A.id)) <= 5 && Number.isFinite(await balance(A.id)));
    });

    // ---------------------------------------------------------------- refunds
    console.log("billing on: refunds");
    await t("a refund returns exactly the charge, once — however often it is called", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 2, "topup", "momo-7");
      const r = await authorize("voice", 0.4);
      assert.ok(r.ok);
      assert.equal(await balance(A.id), 1.4);
      if (!r.ok) return;
      await refund(r.eventId);
      await refund(r.eventId);
      await Promise.all([refund(r.eventId), refund(r.eventId), refund(r.eventId)]);
      assert.equal(await balance(A.id), 2);
      assert.equal(await events(A.id), 0, "the event no longer counts against the quota");
      assert.equal(Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE reason = 'refund'`))[0].n), 1);
    });
    await t("refunding an unknown event, or a free one, changes nothing", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 1, "topup", "momo-8");
      await refund("999999");
      const free = await authorize("image", 0);
      if (free.ok) await refund(free.eventId);
      assert.equal(await balance(A.id), 1);
    });
    await t("refundByRef (a failed Replicate job) gives the charge back once, and only for that user", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 3, "topup", "momo-9");
      const r = await authorize("video", 0.5, "job-abc");
      assert.ok(r.ok);
      assert.equal(await balance(A.id), 2.25);
      await refundByRef(B.id, "job-abc");
      assert.equal(await balance(A.id), 2.25, "someone else's refund request does nothing");
      await refundByRef(A.id, "job-abc");
      await refundByRef(A.id, "job-abc");
      assert.equal(await balance(A.id), 3);
    });
    await t("billing OFF afterwards: refunds still work and write no ledger row", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 3, "topup", "momo-10");
      await withEnv({ BILLING_ENABLED: "false" }, async () => {
        const r = await authorize("voice", 0.4);
        assert.ok(r.ok);
        assert.equal(await balance(A.id), 3, "not charged while billing is off");
        if (r.ok) await refund(r.eventId);
      });
      assert.equal(await ledgerRows(A.id), 1);
    });

    // ---------------------------------------------------------------- credit_user
    console.log("billing on: adding credits");
    await t("credit_user is idempotent on (reason, ref): a mobile-money transaction id credits once", async () => {
      await reset();
      assert.ok(await credit(A.id, 5, "topup", "momo-TXN1"));
      assert.equal(await credit(A.id, 5, "topup", "momo-TXN1"), null);
      assert.equal(await balance(A.id), 5);
      assert.ok(await credit(A.id, 5, "bonus", "momo-TXN1"), "same ref, other reason: a different line");
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => credit(A.id, 1, "topup", "momo-RACE")));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await balance(A.id), 11);
    });
    await t("credit_user refuses zero, negative and NaN amounts and unknown or spending reasons", async () => {
      await reset();
      for (const amount of [0, -1, NaN]) await assert.rejects(() => credit(A.id, amount, "topup", `x${amount}`), String(amount));
      for (const reason of ["debit", "refund", "gift", ""]) await assert.rejects(() => credit(A.id, 1, reason, `r-${reason}`), reason);
      assert.equal(await ledgerRows(A.id), 0);
    });
    await t("a null ref is allowed for manual adjustments and is not deduplicated", async () => {
      await reset();
      await credit(A.id, 1, "adjustment");
      await credit(A.id, 1, "adjustment");
      assert.equal(await balance(A.id), 2);
    });
    await t("the ledger rejects a made-up reason at the table level too", async () => {
      await assert.rejects(() => db.query(`INSERT INTO credit_ledger (user_id, delta, reason) VALUES ($1::uuid, 1, 'gift')`, [A.id]));
    });

    // ---------------------------------------------------------------- bonus
    console.log("billing on: signup bonus and reading the balance");
    await t("the signup bonus is granted once, even when the balance is read in parallel", async () => {
      await reset();
      await withEnv({ SIGNUP_BONUS_USD: "2" }, async () => {
        const balances = await Promise.all([1, 2, 3, 4].map(() => getBalance(A.id)));
        assert.ok(balances.every((b) => b === 2), JSON.stringify(balances));
        assert.equal(await getBalance(A.id), 2);
        assert.equal(await ledgerRows(A.id), 1);
      });
      assert.equal(await getBalance(A.id), 2, "without the bonus configured the balance is just read");
    });
    await t("getBalance gives null when the database fails, never a made-up number", async () => {
      const real = db.query.bind(db);
      (db as unknown as { query: unknown }).query = () => Promise.reject(new Error("db down"));
      try {
        assert.equal(await getBalance(A.id), null);
        assert.deepEqual(await getLedger(A.id), []);
        assert.deepEqual(await authorize("voice", 0.4), { ok: false, error: "SERVICE_INDISPONIBLE" });
      } finally {
        (db as unknown as { query: unknown }).query = real;
      }
    });

    // ---------------------------------------------------------------- history
    console.log("billing on: history");
    await t("getLedger returns the newest rows first with French labels; refunds say so", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 5, "topup", "momo-H1");
      const v = await authorize("voice", 0.4);
      const video = await authorize("video", 0.5, "job-h");
      assert.ok(v.ok && video.ok);
      if (video.ok) await refund(video.eventId);
      const rows = await getLedger(A.id);
      assert.deepEqual(rows.map((r) => r.label), ["Plan vidéo (remboursé)", "Plan vidéo", "Voix", "Recharge"]);
      assert.deepEqual(rows.map((r) => r.delta), [0.75, -0.75, -0.6, 5]);
      assert.ok(rows.every((r) => /^\d{4}-\d\d-\d\dT/.test(r.at)));
      assert.deepEqual(await getLedger(B.id), [], "another user's history is empty, never mixed in");
      assert.equal((await getLedger(A.id, 2)).length, 2);
      assert.equal((await getLedger(A.id, 100000)).length, 4, "the limit is clamped, not trusted");
    });

    // ---------------------------------------------------------------- volume and reconciliation
    console.log("billing on: volume");
    await t("200 requests against credits that cover 37 of them: exactly 37 succeed and the balance is never negative", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 22.2, "topup", "momo-V1"); // 37 x 0.6
      const results = await Promise.all(Array.from({ length: 200 }, () => authorize("refine", 0.4)));
      // 'refine' is limited to DAILY_LIMITS.refine a day: the rest of the refusals are quota ones.
      const ok = results.filter((r) => r.ok).length;
      assert.equal(ok, Math.min(37, DAILY_LIMITS.refine));
      assert.ok((await balance(A.id)) >= 0);
      assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && (r.error === "SOLDE_INSUFFISANT" || r.error === "QUOTA_ATTEINTE")));
    });
    await t("RECONCILIATION: balance = top-ups - the charged price of every event that was not refunded", async () => {
      await reset();
      setUser(A);
      await credit(A.id, 50, "topup", "momo-R1");
      await credit(A.id, 3, "bonus", "signup");
      const kinds = ["voice", "refine", "image", "video"] as const;
      const placed: string[] = [];
      for (let i = 0; i < 30; i++) {
        const r = await authorize(kinds[i % 4], [0.05, 0.3, 0, 0.45][i % 4], i % 4 === 3 ? `job-${i}` : undefined);
        if (r.ok) placed.push(r.eventId);
      }
      for (const [i, id] of placed.entries()) if (i % 3 === 0) await refund(id);
      const [r] = await q<{ expected: string; actual: string }>(`
        SELECT (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE reason IN ('topup', 'bonus', 'adjustment')) -
               (SELECT COALESCE(SUM(-l.delta), 0) FROM credit_ledger l JOIN usage_events e ON e.id::text = l.ref
                  WHERE l.reason = 'debit' AND NOT e.refunded) AS expected,
               credit_balance($1::uuid) AS actual`, [A.id]);
      assert.equal(Number(r.actual), Number(r.expected));
      const [dup] = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM (SELECT reason, ref FROM credit_ledger WHERE ref IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1) d`);
      assert.equal(Number(dup.n), 0, "no (reason, ref) is applied twice");
    });
  });
}

// ============================================================================================ real PostgreSQL, opt-in
// PGlite runs one statement at a time. With TEST_PG_URL pointing at a scratch database (psql and pgbench installed),
// the same reservations come from 100 parallel connections.
async function parallelRequests() {
  console.log("\n=== parallel requests on a real PostgreSQL ===");
  const url = process.env.TEST_PG_URL;
  if (!url) {
    console.log("  skipped - set TEST_PG_URL to a scratch database (needs psql and pgbench)");
    return;
  }
  const psql = (sql: string) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", sql], { encoding: "utf8" }).trim();
  const bench = (script: string, clients = 100) => {
    const file = join(mkdtempSync(join(tmpdir(), "neuro-pgbench-")), "script.sql");
    writeFileSync(file, script);
    execFileSync("pgbench", ["-n", "-c", String(clients), "-j", "8", "-t", "1", "-f", file, url], { stdio: "ignore" });
  };
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", "db/schema.sql"], { stdio: "ignore" });
  const user = psql(`INSERT INTO users (email) VALUES ('bill-' || gen_random_uuid() || '@example.com') RETURNING id`).split("\n")[0];
  const reset = () => psql(`DELETE FROM credit_ledger WHERE user_id = '${user}'; DELETE FROM usage_events WHERE user_id = '${user}'`);
  const stats = () => psql(`SELECT (SELECT count(*) FROM usage_events WHERE user_id = '${user}' AND NOT refunded) || ' ' || credit_balance('${user}')::float`);

  await t("100 clients at once, credits for exactly 10 actions: 10 succeed, the balance ends at 0, round after round", () => {
    for (let round = 0; round < 3; round++) {
      reset();
      psql(`SELECT credit_user('${user}', 6, 'topup', 'race-${round}')`);
      bench(`SELECT * FROM reserve_charged('${user}'::uuid, 'refine', 0.4, 0.6, 1000, 1000, NULL);`);
      assert.equal(stats(), "10 0", `round ${round + 1}`);
    }
  });
  await t("100 clients at once, plenty of credits, a daily limit of 40: exactly 40 reservations and 40 debits", () => {
    reset();
    psql(`SELECT credit_user('${user}', 500, 'topup', 'race-limit')`);
    bench(`SELECT * FROM reserve_charged('${user}'::uuid, 'refine', 0.1, 0.15, 40, 1000, NULL);`);
    assert.equal(stats(), "40 494");
  });
  await t("100 clients refunding the same event give the charge back once", () => {
    reset();
    psql(`SELECT credit_user('${user}', 5, 'topup', 'race-refund')`);
    const id = psql(`SELECT out_event FROM reserve_charged('${user}'::uuid, 'refine', 0.4, 0.6, 1000, 1000, NULL)`);
    assert.equal(psql(`SELECT credit_balance('${user}')::float`), "4.4");
    bench(`SELECT refund_event(${id});`);
    assert.equal(psql(`SELECT credit_balance('${user}')::float`), "5");
  });
  await t("100 clients crediting the same transaction id credit it once", () => {
    reset();
    bench(`SELECT credit_user('${user}', 5, 'topup', 'same-txn');`);
    assert.equal(psql(`SELECT credit_balance('${user}')::float`), "5");
  });
  await t("100 clients mixing spends and refunds never push the balance below zero", () => {
    reset();
    psql(`SELECT credit_user('${user}', 3, 'topup', 'race-mix')`);
    bench(
      `\\set n random(1, 1000000)\nSELECT refund_event(out_event) FROM reserve_charged('${user}'::uuid, 'refine', 0.4, 0.6, 1000, 1000, NULL) WHERE :n % 2 = 0;\n` +
        `SELECT * FROM reserve_charged('${user}'::uuid, 'refine', 0.4, 0.6, 1000, 1000, NULL);`,
    );
    const balance = Number(psql(`SELECT credit_balance('${user}')::float`));
    assert.ok(balance >= 0, `balance ${balance}`);
    assert.equal(psql(`SELECT count(*) FROM credit_ledger WHERE user_id = '${user}' AND reason = 'refund' AND ref NOT IN (SELECT ref FROM credit_ledger WHERE reason = 'debit')`), "0", "a refund always has its debit");
  });
  psql(`DELETE FROM users WHERE id = '${user}'`);
}

(async () => {
  await pureHelpers();
  await scenario();
  await parallelRequests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
