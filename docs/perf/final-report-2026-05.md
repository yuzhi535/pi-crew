# pi-crew Performance Upgrade — Final Report (2026-05)

Date: 2026-05-14
Branches: `perf/baseline-bench` → `perf/sprint-1` → `perf/sprint-2` →
`perf/sprint-2.5` → `perf/sprint-3` → `perf/sprint-4` → `perf/sprint-5` →
`perf/sprint-6-cleanup` → `perf/sprint-7-scaffolding`
Status: 7 sprint cycles + cleanup + scaffolding completed. 32 items
shipped + 3 ADRs proposed. 4 caller-migration TODOs remain (Sprint 7
ships the producer-side APIs they need).

## Cumulative bench delta (Sprint 0 → final)

| Metric | Sprint 0 baseline | Final | Delta |
|---|---|---|---|
| register-startup.import.p95 | 655.39 ms | 536.57 ms | **−18.1 %** |
| register-startup.register.p95 | 27.51 ms | 25.77 ms | **−6.3 %** |
| render-flush.p95 | 0.36 ms | ~0.27 ms | **−25 %** |
| snapshot-cache.cold.p95 | 3.06 ms | ~2.60 ms | **−15 %** |
| snapshot-cache.warm.p95 | 3.06 ms | ~2.55 ms | **−16.7 %** |

Numbers are end-of-Sprint-6 with the same Node v24.10.0 / Windows
hardware. The bundled ESM artifact (`dist/index.mjs`, ADR 0006) is
ready and verified loading — flipping `pi.extensions[]` to it is
projected to bring `register-startup.import.p95` to ≤ 250 ms after a
3-OS smoke pass.

## Items shipped per sprint

### Sprint 0 — Baseline & gate

- Bench harness (`test/bench/{register-startup,render-flush,snapshot-cache}.bench.ts`)
- Profile script (`scripts/profile-startup.mjs`)
- Bench-check gate (`scripts/bench-check.mjs`) — 15 % regression floor;
  sub-ms metrics use absolute +0.5 ms cap to avoid noise
- Baseline JSON committed at `test/bench/baseline.json`
- Plan (`docs/perf/upgrade-plan-2026-05.md`) + baseline doc
- Bonus fix: pre-existing `// LAZY:` marker missing in
  `src/runtime/background-runner.ts`

### Sprint 1 — UI mượt rủi ro thấp (6 items)

- 1.4 events stamp via `.seq` sequence file
- 1.5 drop per-agent outputStamp from SnapshotStamps
- 1.8 per-segment powerbar dedup keying full payload
- 1.9 per-runId invalidate coalesce in RenderScheduler
- 1.1 renderTick zero-fs-IO
- 1.2 drop sync `refreshIfStale` fallback on hot render path
- 1.10 mascot pause idle — skipped (mascot is splash, not always-on)

### Sprint 2 — Cắt I/O sync hot path (4 items)

- 2.10 cache findRepoRoot lookups (TTL-LRU 30 s)
- 2.7 lazy-load OTLPExporter, LiveRunSidebar, crash-recovery
- 4.1 keep metric-sink fd open per UTC date
- 2.3 lower events.jsonl rotation threshold 5 MB → 4 MB
- 4.4 sample task.progress 1/10 — skipped (existing
  `shouldAppendProgressEventUpdate` is smarter than naive sampling)

### Sprint 2.5 — Deferred I/O items (1 item)

- 1.3 native fs.watch on `<crewRoot>/state` with poll fallback
- 2.1 atomic-write coalescer — deferred to durability sprint
- 2.2 events.jsonl buffer 20 ms — deferred to durability sprint

### Sprint 3 — Refactor & UI selectors (3 items)

- 5.1 test:unit `--test-concurrency=4 --test-isolation=process`
- 2.8 extract `src/runtime/adaptive-plan.ts` (team-runner.ts 57 KB → 43 KB)
- 2.9 extract `src/config/types.ts` (config.ts 38 KB → 34 KB)
- 1.6 dashboard pane independent rendering — deferred (UI selectors
  follow-up)
- 1.7 memoized snapshot slice — deferred (depends on 1.6)

### Sprint 4 — Stability & telemetry (6 items)

- 3.4 atomic-write rename: jitter ±20 %, cap 8 retries
- 3.6 HeartbeatWatcher deadletter cooldown (default 60 s)
- 3.2 HeartbeatWatcher poll backoff: stale → 1 s, healthy → 5 s
- 4.3 pre-tuned histogram buckets for run/task duration + tokens
- 4.2 OTLP exporter gzips body
- 3.7 idempotent resume — already preserved by path-keyed artifact map
- 3.1, 3.5, 3.3, 3.8 — deferred (medium-risk, need stress harness)

### Sprint 5 — High-risk + ADRs (1 item + 3 ADRs)

- 5.2 npm run test:watch script
- ADR 0006 publish-bundled-esm (5.5) — Proposed
- ADR 0007 active-run-binary-index (2.4) — Proposed
- ADR 0008 child-pi-warm-pool (2.6) — Proposed
- 2.5 lazy materialize crew-agent-records — deferred (depends on 2.2)

### Sprint 6 — Cleanup of deferred items (7 items)

- 3.8 Windows taskkill verification + retry once if stuck
- 3.5 Fast-escalate to SIGKILL within 200 ms on explicit cancel
- 3.3 Mailbox auto-archive at 10 MB (jsonl rotation + reader walks
  archives)
- 3.1 Soft backpressure watermark on child stdout (256 KB / 50 ms pause)
- 1.6 + 1.7 Per-slice signatures on `RunUiSnapshot.sliceSignatures` so
  panes can short-circuit when their slice hasn't moved
- 5.5 esbuild bundle dual-ship — `scripts/build-bundle.mjs` produces
  `dist/index.mjs` (~1.4 MB) + sourcemap; `pi.extensions[]` keeps
  pointing at `index.ts` until 3-OS smoke; ready to flip
- 2.4 active-run-registry binary mirror via `node:v8` serialize/deserialize
  with JSON dual-ship for legacy readers

### Sprint 7 — Scaffolding for last 4 deferred items (4 items)

- 2.2 `appendEventBuffered` + `flushEventLogBuffer` — refactors
  appendEvent into appendEventInsideLock; buffered queue flushes a
  whole batch under a single withEventLogLockSync acquire while
  preserving the monotonic seq invariant.
- 2.1 `atomicWriteJsonCoalesced` + `flushPendingAtomicWrites` —
  per-path 50 ms coalesce window with last-value-wins; auto-flush
  on process.on(exit/SIGTERM/SIGINT).
- 2.5 `saveCrewAgentsCoalesced` + `writeCrewAgentStatusCoalesced` +
  `flushPendingAgentWrites` — wraps 2.1 for crew-agent-records.
- 2.6 `src/runtime/child-pi-pool.ts` skeleton — flag + interface
  (`acquirePooledChild` / `releasePooledChild` / `disposeWarmPool` +
  `resolveWarmPoolSize`). Returns null until Pi runtime gains
  wait-for-prompt handshake (ADR 0008).

## Caller-migration TODOs (after Sprint 7)

The producer-side APIs are now in place. The 4 remaining "make the
default path use them" tasks each require their own integration test
harness so they ride out on follow-up branches:

| ID | Migration | Producer API ready in |
|---|---|---|
| 2.1 caller | switch `saveRunTasks` mergeTaskUpdates loop to `atomicWriteJsonCoalesced` | Sprint 7 (b8fe5d9) |
| 2.2 caller | switch `task.progress` events in team-runner / task-runner to `appendEventBuffered` | Sprint 7 (34d8652) |
| 2.5 caller | switch progress hook to `writeCrewAgentStatusCoalesced` and aggregate to `saveCrewAgentsCoalesced` | Sprint 7 (ddb77f7) |
| 2.6 impl | flip `acquirePooledChild` from null-stub to actual pool once Pi supports the `PI_CREW_POOL_HEALTH=1` handshake | Sprint 7 (69d135d) |
| 1.6 / 1.7 panes | dashboard panes read `snapshot.sliceSignatures.<slice>` and short-circuit | Sprint 6 (d2d76cb) |
| 5.5 entry-flip | `pi.extensions[]` → `./dist/index.mjs` after 3-OS smoke | Sprint 6 (2ef4012) |

## Test surface

- 1578 / 1580 unit test cases pass (2 skipped, 0 fail) under
  concurrency=4 isolation=process.
- Wall time `npm run test:unit`: ~63 s on Windows.
- New tests added across sprints:
  - `render-scheduler.test.ts`: +2 invalidate-coalesce cases (1.9)
  - `powerbar-publisher.test.ts`: +1 dedup case (1.8)
  - `paths.test.ts`: +1 cache case (2.10)
  - `fs-watch.test.ts`: +2 cases for native watcher (1.3)

## Tooling delta

- `package.json`: +5 scripts (`bench`, `bench:check`, `bench:capture`,
  `profile:startup`, `test:watch`).
- `scripts/`: +3 mjs files for bench harness + profile.
- `test/bench/`: +3 .bench.ts files + `baseline.json`.
- `.gitignore`: ignore `.profile/`, `test/bench/results.json`,
  `*.cpuprofile`.

## Files (new)

- `docs/perf/upgrade-plan-2026-05.md`
- `docs/perf/baseline-2026-05.md`
- `docs/perf/sprint-{1,2,2.5,3,4,5}-report.md`
- `docs/perf/final-report-2026-05.md` (this file)
- `docs/decisions/0006-publish-bundled-esm.md`
- `docs/decisions/0007-active-run-binary-index.md`
- `docs/decisions/0008-child-pi-warm-pool.md`
- `src/runtime/adaptive-plan.ts`
- `src/config/types.ts`
- `scripts/profile-startup.mjs`, `scripts/run-bench.mjs`,
  `scripts/bench-check.mjs`
- `test/bench/{register-startup,render-flush,snapshot-cache}.bench.ts`
- `test/bench/baseline.json`

## Files (modified)

- `src/extension/register.ts` — 2.7 (lazy phase 2), 1.1, 1.3, 2.10
- `src/ui/run-snapshot-cache.ts` — 1.4, 1.5
- `src/ui/render-scheduler.ts` — 1.9
- `src/ui/powerbar-publisher.ts` — 1.8, 1.2
- `src/ui/crew-widget.ts` — 1.2
- `src/utils/paths.ts` — 2.10
- `src/utils/fs-watch.ts` — 1.3
- `src/observability/metric-sink.ts` — 4.1
- `src/observability/event-to-metric.ts` — 4.3
- `src/observability/exporters/otlp-exporter.ts` — 4.2
- `src/state/atomic-write.ts` — 3.4
- `src/state/event-log-rotation.ts` — 2.3
- `src/runtime/heartbeat-watcher.ts` — 3.2, 3.6
- `src/runtime/team-runner.ts` — 2.8 (extracted adaptive-plan)
- `src/runtime/background-runner.ts` — fix LAZY marker
- `src/config/config.ts` — 2.9 (extracted types)
- `package.json` — bench scripts + test concurrency
- `.gitignore` — bench artifacts
- `scripts/bench-check.mjs` — sub-ms gate

## Recommended follow-ups (in priority order)

1. **Flip `pi.extensions[]` to `./dist/index.mjs` after 3-OS smoke** —
   ADR 0006 is shipped and verified; flipping the entrypoint is the
   biggest remaining lever for cold start (projected p95 ≤ 250 ms).
2. **Migrate dashboard panes to consume `snapshot.sliceSignatures.<slice>`** —
   per-pane refactor; framework is in place from Sprint 6.
3. **Durability coalescers (2.1 + 2.2)** — own branch with crash-recovery
   integration test harness.
4. **Lazy materialize crew-agent-records (2.5)** — once 2.2 lands.
5. **Child-pi warm pool (2.6)** — ADR 0008; needs soak harness.
