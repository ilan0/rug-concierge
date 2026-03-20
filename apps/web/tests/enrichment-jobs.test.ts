import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runInventoryEnrichmentWorker } from "../lib/inventory/enrichment-jobs";

type FakeRow = Record<string, unknown>;

type FakeDbState = {
  rugs: FakeRow[];
  rug_images: FakeRow[];
  inventory_enrichment_jobs: FakeRow[];
};

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };

class FakeQueryBuilder {
  private table: keyof FakeDbState;
  private db: FakeDbState;
  private mode: "select" | "update" | "delete" = "select";
  private updatePayload: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private _limit: number | null = null;

  constructor(table: keyof FakeDbState, db: FakeDbState) {
    this.table = table;
    this.db = db;
  }

  select(): this {
    this.mode = "select";
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  order(): this {
    return this;
  }

  limit(value: number): this {
    this._limit = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
    return this;
  }

  range(): this {
    return this;
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    const result = await this.execute();
    const data = Array.isArray(result.data) ? result.data[0] ?? null : null;
    return { data, error: null };
  }

  async single(): Promise<{ data: FakeRow | null; error: null }> {
    return this.maybeSingle();
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[] | null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.kind === "eq") {
        return actual === filter.value;
      }
      return filter.values.some((value) => value === actual);
    });
  }

  private async execute(): Promise<{ data: FakeRow[] | null; error: null }> {
    const rows = this.db[this.table];
    const matchingIndexes: number[] = [];

    rows.forEach((row, index) => {
      if (this.matches(row)) {
        matchingIndexes.push(index);
      }
    });

    if (this.mode === "select") {
      const selected = matchingIndexes.map((index) => rows[index]);
      const limited =
        typeof this._limit === "number" ? selected.slice(0, this._limit) : selected;
      return { data: limited, error: null };
    }

    if (this.mode === "update") {
      for (const index of matchingIndexes) {
        Object.assign(rows[index], this.updatePayload);
      }
      return { data: null, error: null };
    }

    for (const index of [...matchingIndexes].reverse()) {
      rows.splice(index, 1);
    }
    return { data: null, error: null };
  }
}

function createFakeSupabase(db: FakeDbState): SupabaseClient {
  const supabase = {
    from(table: keyof FakeDbState) {
      return new FakeQueryBuilder(table, db);
    },
    rpc(
      fnName: string,
      params: { claim_limit?: number; worker_id?: string }
    ): Promise<{ data: FakeRow[] | null; error: null }> {
      if (fnName !== "claim_inventory_enrichment_jobs") {
        return Promise.resolve({ data: [], error: null });
      }

      const limit = Math.max(1, Math.floor(params.claim_limit ?? 1));
      const workerId = typeof params.worker_id === "string" ? params.worker_id : "worker";
      const claimed: FakeRow[] = [];

      for (const job of db.inventory_enrichment_jobs) {
        if (claimed.length >= limit) break;
        const state = job.state;
        const nextAttemptAt = job.next_attempt_at;
        const readyToRetry =
          state === "retry_scheduled" &&
          (typeof nextAttemptAt !== "string" ||
            new Date(nextAttemptAt).getTime() <= Date.now());

        if (state === "queued" || readyToRetry || state === "processing") {
          job.state = "processing";
          job.lock_owner = workerId;
          job.locked_at = new Date().toISOString();
          job.updated_at = new Date().toISOString();
          claimed.push({ ...job });
        }
      }

      return Promise.resolve({ data: claimed, error: null });
    },
    storage: {
      from() {
        return {
          getPublicUrl(path: string) {
            return {
              data: {
                publicUrl: `https://example.test/${path}`,
              },
            };
          },
        };
      },
    },
  };

  return supabase as unknown as SupabaseClient;
}

function makeDb(input: {
  jobAttemptCount: number;
  includeImage: boolean;
  includeRug?: boolean;
}): FakeDbState {
  const now = new Date().toISOString();
  return {
    rugs: input.includeRug === false
      ? []
      : [
          {
            id: "rug-1",
            tenant_id: "tenant-1",
            intake_label: null,
            ai_description: null,
            ai_structured_fields: null,
            staff_overrides: null,
            stock_id: "AUTO-RUG1",
            status: "available",
            enrichment_status: "processing",
            review_reason_code: null,
            width_total_in: 96,
            length_total_in: 120,
            created_at: now,
          },
        ],
    rug_images: input.includeImage
      ? [
          {
            tenant_id: "tenant-1",
            rug_id: "rug-1",
            path: "tenant-1/rug-1/primary.jpg",
          },
        ]
      : [],
    inventory_enrichment_jobs: [
      {
        id: "job-1",
        tenant_id: "tenant-1",
        rug_id: "rug-1",
        state: "queued",
        attempt_count: input.jobAttemptCount,
        max_attempts: 3,
        next_attempt_at: null,
        last_error: null,
        locked_at: null,
        lock_owner: null,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

async function runWithNoOpenAiKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await fn();
  } finally {
    if (typeof previous === "string") {
      process.env.OPENAI_API_KEY = previous;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
}

test("worker schedules retry when enrichment call is unavailable", async () => {
  const db = makeDb({ jobAttemptCount: 0, includeImage: true });
  const supabase = createFakeSupabase(db);

  const summary = await runWithNoOpenAiKey(() =>
    runInventoryEnrichmentWorker({
      workerId: "worker-1",
      supabase,
    })
  );

  assert.equal(summary.outcomes.retry_scheduled, 1);
  assert.equal(summary.outcomes.needs_review_failed, 0);
  assert.equal(db.inventory_enrichment_jobs[0].state, "retry_scheduled");
  assert.equal(db.inventory_enrichment_jobs[0].attempt_count, 1);
  assert.equal(typeof db.inventory_enrichment_jobs[0].next_attempt_at, "string");
  const nextAttemptMs = new Date(
    String(db.inventory_enrichment_jobs[0].next_attempt_at)
  ).getTime();
  const nowMs = Date.now();
  const deltaMs = nextAttemptMs - nowMs;
  assert.ok(
    deltaMs >= 30_000 && deltaMs <= 90_000,
    `expected retry delay around 1 minute, got ${deltaMs}ms`
  );
});

test("worker marks rug needs_review after max retries are exhausted", async () => {
  const db = makeDb({ jobAttemptCount: 2, includeImage: true });
  const supabase = createFakeSupabase(db);

  const summary = await runWithNoOpenAiKey(() =>
    runInventoryEnrichmentWorker({
      workerId: "worker-2",
      supabase,
    })
  );

  assert.equal(summary.outcomes.needs_review_failed, 1);
  assert.equal(db.inventory_enrichment_jobs[0].state, "needs_review");
  assert.equal(db.inventory_enrichment_jobs[0].attempt_count, 3);
  assert.equal(db.rugs[0].enrichment_status, "needs_review");
  assert.equal(db.rugs[0].review_reason_code, "ANALYSIS_FAILED");
});

test("worker marks rug needs_review when primary image is missing", async () => {
  const db = makeDb({ jobAttemptCount: 0, includeImage: false });
  const supabase = createFakeSupabase(db);

  const summary = await runWithNoOpenAiKey(() =>
    runInventoryEnrichmentWorker({
      workerId: "worker-3",
      supabase,
    })
  );

  assert.equal(summary.outcomes.needs_review_failed, 1);
  assert.equal(db.inventory_enrichment_jobs[0].state, "needs_review");
  assert.equal(db.rugs[0].review_reason_code, "ANALYSIS_FAILED");
});

test("worker skips missing rugs gracefully", async () => {
  const db = makeDb({
    jobAttemptCount: 0,
    includeImage: false,
    includeRug: false,
  });
  const supabase = createFakeSupabase(db);

  const summary = await runWithNoOpenAiKey(() =>
    runInventoryEnrichmentWorker({
      workerId: "worker-4",
      supabase,
    })
  );

  assert.equal(summary.outcomes.skipped_missing_rug, 1);
  assert.equal(db.inventory_enrichment_jobs[0].state, "completed");
});
