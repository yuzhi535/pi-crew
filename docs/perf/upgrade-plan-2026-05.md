# pi-crew Performance Upgrade Plan — 2026-05

Date: 2026-05-14
Owner: pi-crew maintainers
Branch nền: `perf/baseline-bench`
Status: in-progress (Sprint 0 starting)

## Mục đích

Nâng cấp hiệu năng và UI mượt hơn mà vẫn giữ tính ổn định, tuân theo `AGENTS.md` task loop và 5 ADR hiện hành (durable state, child-process for async, depth guard, execFileSync, no parameter properties). Plan này tập hợp 30 item nâng cấp đã phân tích, chia thành 5 sprint + 1 đợt tổng kết.

Các trục:

1. **UI mượt hơn** — cắt sync I/O khỏi render path.
2. **Runtime/state** — giảm syscall, lazy import, warm pool, refactor file lớn.
3. **Ổn định** — backpressure, heartbeat, cancel sớm, mailbox archive, kill-tree Win.
4. **Telemetry chi phí thấp** — stream sink, OTLP gzip, sample progress, histogram bucket.
5. **Build/test feedback loop** — bench gate, test concurrency, watch mode, bundle.

## Quy trình áp dụng cho mọi PR

- Branch: `perf/<sprint>-<id>-<slug>` cắt từ `perf/baseline-bench`.
- Lane (theo `AGENTS.md`): tiny / normal / high-risk.
- Validation bắt buộc trước khi merge:
  - `npm run typecheck`
  - `npm run check:lazy-imports`
  - `npm test`
  - `npm run bench:check` — không regress > 15%
- Tài liệu:
  - Update `CHANGELOG.md` (nhóm theo sprint).
  - Update `docs/TEST_MATRIX.md` khi thêm test.
  - Viết ADR cho mọi thay đổi contract (`docs/decisions/`).
- Không gộp > 2 item vào 1 PR. Không refactor "tiện thể".
- Mỗi item rủi ro cao có flag tắt được ở config (`runtime.experimental.<feature>=false`).

## Sprint 0 — Baseline & gate (2 ngày)

Mục đích: đo trước khi tối ưu.

| ID | Task | Files | Lane |
|---|---|---|---|
| S0-1 | Profile script | `scripts/profile-startup.mjs` | tiny |
| S0-2 | Bench harness 3 file | `test/bench/{register-startup,render-flush,snapshot-cache}.bench.ts`, `test/bench/baseline.json` | normal |
| S0-3 | `npm run bench` + `bench:check` | `package.json`, `scripts/bench-check.mjs` | tiny |
| S0-4 | Branch nền `perf/baseline-bench` | — | — |
| S0-5 | Capture baseline | `docs/perf/baseline-2026-05.md` | tiny |

Exit criteria: `npm run bench` ổn định, baseline đã ghi.

## Sprint 1 — UI mượt rủi ro thấp (5 ngày)

| ID | Item | Lane | Acceptance |
|---|---|---|---|
| 1.1 | renderTick no-sync | tiny | Render skeleton khi preload chưa sẵn; test fs.statSync throw không crash. |
| 1.2 | Async snapshot stamps | normal | Sync version chỉ ở CLI handler; bench p95 -30%. |
| 1.4 | Stamp version counter | tiny | Dùng `events.jsonl.seq` thay `combineStamps(size)`. |
| 1.5 | Stamp agents O(1) | tiny | 1 stat/run thay vì N. |
| 1.8 | Powerbar dedup hash | tiny | 100 emit cùng payload → 1 event. |
| 1.9 | subagent.completed coalescer | tiny | 10 events trong 30 ms → 1 invalidate. |
| 1.10 | Mascot pause idle | tiny | Config `ui.mascotPauseIdleMs`. |

Exit: `render-flush.bench.ts` -30%, `snapshot-cache.bench.ts` -20%.

## Sprint 2 — Cắt I/O sync hot path (5 ngày)

| ID | Item | Lane | Acceptance |
|---|---|---|---|
| 2.7 | Lazy import phase 2 | tiny | `register` end-to-end -200 ms. |
| 2.10 | projectCrewRoot cache | tiny | 1000 lần gọi → 1 stat. |
| 4.1 | Metric-sink stream | tiny | 10k metric → 0 sync IO hot path. |
| 4.4 | Progress sample 1/10 + first/last | tiny | 100 progress → 12 trong jsonl. |
| 2.1 | Atomic-write coalescer | normal | Crash trong window không corrupt; test recovery. |
| 2.2 | Events.jsonl buffer 20 ms | normal | flushSync trên cleanupRuntime + session_before_switch. |
| 2.3 | Rotation threshold 4 MB | tiny | Append 4 MB → rotate. |
| 1.3 | FS watcher native | normal | Render < 100 ms từ FS event; fallback poll khi ENOSYS. |

Exit: 0 sync IO trong `RenderScheduler.flush`, register start ≤ 400 ms.

## Sprint 3 — Refactor & UI selectors (5 ngày)

| ID | Item | Lane | Acceptance |
|---|---|---|---|
| 2.8 | Tách adaptive-plan | normal | `team-runner.ts` < 45 KB; lazy import khi workflow ≠ implementation. |
| 2.9 | Tách config.ts | normal | `config.ts` < 20 KB; hot path không import drift/suggestions. |
| 1.6 | Dashboard pane independent | normal | 1 task đổi → chỉ agents-pane render. |
| 1.7 | Memoized snapshot slice | normal | 2 lần get cùng cache → cùng reference. |
| 5.1 | Test concurrency 4 | tiny | mỗi test mkdtemp riêng PI_TEAMS_HOME. |

Exit: dashboard FPS +50% khi run đang chạy.

## Sprint 4 — Ổn định & telemetry (4 ngày)

| ID | Item | Lane | Acceptance |
|---|---|---|---|
| 3.1 | Backpressure stdout | normal | Stress 50 MB output → memory không vượt cap. |
| 3.2 | Heartbeat backoff | tiny | Stale → poll 1 s; khoẻ → 5 s. |
| 3.5 | Cancel propagate < 200 ms | normal | Stream-parse JSONL + signal check. |
| 3.6 | Deadletter cooldown | tiny | Config `reliability.deadletterCooldownMs`. |
| 3.7 | Idempotent resume theo attemptId | tiny | Resume 3 lần → artifact không nhân đôi. |
| 3.8 | Kill-tree Win | normal | SIGKILL fail → `taskkill /F /T`. |
| 3.4 | Atomic-write jitter | tiny | Jitter ±20%, max 8 attempts. |
| 3.3 | Mailbox auto-archive | normal | 11 MB → rotate vào blob-store. |
| 4.2 | OTLP gzip + delta | tiny | Content-Encoding: gzip; counter delta. |
| 4.3 | Histogram buckets pre-tuned | tiny | `crew.task.duration_ms` buckets `[50,200,500,1k,5k,30k,120k]`. |

Exit: cancel < 200 ms, no OOM trên stress, deadletter không lặp.

## Sprint 5 — Backlog rủi ro cao + ADR (1 tuần)

| ID | Item | Lane | ADR |
|---|---|---|---|
| 5.5 | Bundle ESM (esbuild) | high-risk | `0006-publish-bundled-esm.md` |
| 2.4 | Active-run-registry binary | high-risk | `0007-active-run-binary-index.md` |
| 2.6 | Child-pi warm pool | high-risk | `0008-child-pi-warm-pool.md` |
| 2.5 | Lazy materialize agent records | normal | — |
| 5.2 | Watch mode test | tiny | — |

Mỗi item: ADR + flag tắt được + dual-ship migration nếu cần.

## Tổng kết

- `docs/perf/sprint-<n>-report.md` cuối mỗi sprint.
- `docs/perf/final-report-2026-05.md` so sánh baseline vs final.
- Update `docs/next-upgrade-roadmap.md` đánh dấu các item đã xong.

## Risk register

| Risk | Sprint | Mitigation |
|---|---|---|
| Coalescer mất event lúc crash | 2 | flushSync ở exit hook; integration test crash recovery. |
| FS watcher fail trên FS mạng | 2 | Detect ENOSYS/EPERM → fallback poll. |
| Bundle phá Pi extension load | 5 | Prototype + smoke trước; dual-ship 1 release. |
| Warm pool leak state | 5 | Pool process khởi động fresh, có nonce; reuse fail → discard. |
| Binary index migration | 5 | Read both binary + JSONL trong 2 release. |
| Concurrency=4 unit test flaky | 3 | Audit test dùng shared HOME; mỗi test mkdtemp riêng. |

## Mục tiêu đo lường

| Metric | Baseline (Sprint 0) | Target | Sprint kỳ vọng cải thiện |
|---|---|---|---|
| `register.ts` end-to-end | TBD | < 400 ms | 2 |
| Widget first frame sau session_start | TBD | < 150 ms | 1 |
| `runTeamTask` cold | TBD | -2 đến -4 s (warm pool) | 5 |
| Dashboard FPS khi run đang chạy | TBD | +50% | 3 |
| events.jsonl tail 32 KB parse | TBD | < 5 ms | 2 |
| CPU idle khi run completed | TBD | < 1% | 1 |
| Cancel round-trip | TBD | < 200 ms | 4 |
