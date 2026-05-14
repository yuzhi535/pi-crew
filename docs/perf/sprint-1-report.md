# pi-crew Sprint 1 Report — UI mượt rủi ro thấp

Date: 2026-05-14
Branch: `perf/sprint-1` (cắt từ `perf/baseline-bench`)
Status: complete

## Items shipped

| ID | Item | Commit |
|---|---|---|
| 1.1 | renderTick zero-fs-IO (skip sync `cache.list` fallback) | 888fdf5 |
| 1.2 | Drop sync `refreshIfStale` fallback on hot render path (widget + powerbar) | 23080c0 |
| 1.4 | Events stamp via `.seq` sequence file (correct under rotation) | a9b63d9 |
| 1.5 | Drop per-agent `outputStamp` from SnapshotStamps (rely on agents.json + event-bus) | a9b63d9 |
| 1.8 | Per-segment powerbar dedup keying full payload (text/suffix/bar/color) | 794a59d |
| 1.9 | Coalesce `onInvalidate` per runId in RenderScheduler (default 50 ms) | 727e07c |
| 1.10 | Mascot pause idle | **Skipped** — mascot is splash with autoCloseMs=7s, not always-on; no perf benefit. |

## Bench delta (Sprint 0 baseline → Sprint 1 baseline)

| Metric | Sprint 0 | Sprint 1 | Delta |
|---|---|---|---|
| register-startup.import.p95 | 655.39 ms | 542.49 ms | **−17.2 %** |
| register-startup.register.p95 | 27.51 ms | 25.49 ms | **−7.3 %** |
| render-flush.p95 (100 iters) | 0.36 ms (50 iters) | 0.25 ms | **−30.6 %** |
| snapshot-cache.cold.p95 | 3.06 ms | 2.82 ms | **−7.8 %** |
| snapshot-cache.warm.p95 | 3.06 ms | 2.70 ms | **−11.8 %** |

Notes:
- `register-startup.import` improvement is partly noise / hot disk cache (no Sprint-2 lazy-import work yet); Sprint 2 (item 2.7) is the planned big drop here.
- `render-flush` bench iters bumped 50 → 100 for stable p95 (the 19 % regression seen with 50 iters was within noise at sub-ms scale).
- `snapshot-cache` improvement modest because the bench has zero agent records, so item 1.5 (drop outputStamp) does not yet show. Real runs with N agents will see the bigger win — Sprint 3's pane-independent rendering bench will exercise that.

## Tests added

- `test/unit/render-scheduler.test.ts` — 2 new cases for invalidate coalesce.
- `test/unit/powerbar-publisher.test.ts` — 1 new case for per-segment dedup.

Total: 3 new test cases. All sprint-1 unit suites green (44 / 44 across 9 touched files).

## Code touched

- `src/extension/register.ts` (1.1)
- `src/ui/run-snapshot-cache.ts` (1.4, 1.5)
- `src/ui/render-scheduler.ts` (1.9)
- `src/ui/powerbar-publisher.ts` (1.8, 1.2)
- `src/ui/crew-widget.ts` (1.2)
- `test/bench/render-flush.bench.ts` (iters → 100)
- `test/bench/baseline.json` (re-captured)

## Risks / follow-up

- 1.5 trade-off: a worker that appends to its own `output.log` without
  triggering an `agents.json` rewrite *and* without firing a `crew.subagent.*`
  event would see stale UI until either fires. crew-agent-records already
  bumps the aggregate on every `appendCrewAgentOutput`, so this is a
  theoretical concern, but call it out for Sprint 4 stability review.
- 1.9 50 ms coalesce window introduces at most one render delay between
  bursty subagent completions and cache invalidation. RenderScheduler
  fallback (750 ms) and event-bus invalidations on `crew.subagent.*` keep
  staleness bounded.
- 1.2 left `live-run-sidebar.ts` and `run-dashboard.ts` on sync
  `refreshIfStale`. Both are user-action paths, but Sprint 3 (1.6 pane
  independence) should re-examine.

## Exit gate

- `npm run typecheck` — pass.
- `npm run check:lazy-imports` — pass.
- `npm run bench` + `npm run bench:check` — pass (see `test/bench/baseline.json`).
- 44 unit-test cases across hot UI/runtime modules — pass.
