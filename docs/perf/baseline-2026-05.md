# pi-crew Performance Baseline — 2026-05

Date captured: 2026-05-14
Branch: `perf/baseline-bench`
Environment:
- OS: Windows (`win32`)
- Node: v24.10.0
- npm: 11.6.1
- Pi: installed at `C:\Users\baphu\AppData\Roaming\npm\pi.ps1`

## How to capture

```powershell
cd pi-crew
npm install                         # if node_modules missing
npm run typecheck
npm run bench:capture               # writes test/bench/baseline.json
npm run profile:startup             # writes .profile/summary.json
```

## How to verify against baseline (CI gate)

```powershell
npm run bench
npm run bench:check                 # fails if any p95 regresses > 15%
```

Override threshold or baseline path:

```powershell
$env:THRESHOLD_PCT = 10              # tighter
$env:BASELINE = "test/bench/baseline-2026-05.json"
```

## Bench results (commit 2026-05-14, end of Sprint 1)

> Sprint 0 captured the original baseline; Sprint 1 re-captured at the
> end of the sprint. Subsequent sprint:check gates compare against this
> table (the JSON in `test/bench/baseline.json`).

### register-startup (cold load via child process, 20 iters)

| Metric | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| import (ms) | 513.76 | 528.15 | 542.49 | 542.49 | 566.58 |
| register (ms) | 23.32 | 24.27 | 25.49 | 25.49 | 26.45 |

### render-flush (200 events / iter, 100 iters)

| Metric | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| ms | 0.07 | 0.10 | 0.25 | 1.02 | 1.12 |

### snapshot-cache (10 tasks, 200 events, 50 iters)

| Metric | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| cold (ms) | 2.14 | 2.42 | 2.82 | 2.92 | 3.01 |
| warm (ms) | 2.16 | 2.41 | 2.70 | 2.75 | 3.99 |

### Delta vs Sprint-0 baseline

| Metric | Sprint 0 | Sprint 1 | Delta |
|---|---|---|---|
| register-startup.import.p95 | 655.39 | 542.49 | **−17.2 %** |
| register-startup.register.p95 | 27.51 | 25.49 | **−7.3 %** |
| render-flush.p95 | 0.36 | 0.25 | **−30.6 %** |
| snapshot-cache.cold.p95 | 3.06 | 2.82 | **−7.8 %** |
| snapshot-cache.warm.p95 | 3.06 | 2.70 | **−11.8 %** |

## Profile-startup (5 iters)

| Metric | Value |
|---|---|
| importMs | 609.48 |
| registerMs.p50 | 6.40 |
| registerMs.p95 | 9.02 |
| registerMs.max | 30.98 |

CPU profile: `.profile/startup-2026-05-14T14-38-20-180Z.cpuprofile` (open in Chrome DevTools → Performance → Load profile).

> `registerMs` thấp hơn bench register-startup vì profile chạy 5 iter trong cùng một process (module cache nóng sau iter 1). Bench `register-startup` mới phản ánh cold-start thực.

## Sprint targets (so với baseline trên)

| Metric | Baseline | Target sau khi xong toàn bộ kế hoạch | Sprint kỳ vọng |
|---|---|---|---|
| register-startup.import.p95 | 655 ms | ≤ 400 ms (lazy) / ≤ 200 ms (bundled) | 2 / 5 |
| register-startup.register.p95 | 27.5 ms | ≤ 25 ms (giữ nguyên) | — |
| render-flush.p95 | 0.36 ms | ≤ 0.5 ms (giữ nguyên) | — |
| snapshot-cache.cold.p95 | 3.06 ms | ≤ 2.1 ms (-30%) | 1, 2 |
| snapshot-cache.warm.p95 | 3.06 ms | ≤ 1.5 ms (-50%) | 1, 2 |
| dashboard FPS khi run đang chạy | n/a | +50% | 3 |
| events.jsonl tail 32 KB parse p95 | n/a | < 5 ms | 2 |
| cancel round-trip | n/a | < 200 ms | 4 |

## Files committed for the gate

- `scripts/profile-startup.mjs` — CPU profile harness.
- `scripts/run-bench.mjs` — run all benches, collect to `results.json`.
- `scripts/bench-check.mjs` — gate; fails on > 15 % regression.
- `test/bench/register-startup.bench.ts`
- `test/bench/render-flush.bench.ts`
- `test/bench/snapshot-cache.bench.ts`
- `test/bench/baseline.json` — committed.
- `package.json` scripts: `bench`, `bench:check`, `bench:capture`, `profile:startup`.
- `.gitignore`: `.profile/`, `test/bench/results.json`, `*.cpuprofile`.

## Caveats

- Baseline được ghi trên 1 máy Windows duy nhất. Các máy khác có CPU/disk khác nhau sẽ ra số khác. Khi cần re-baseline (Node major bump, OS upgrade, máy CI khác), copy `results.json → baseline.json` và viết file mới `baseline-<date>.md`.
- `register-startup` bench tốn ~13 s (20 iter × 600 ms); CI nên giữ. Local có thể `BENCH_ITERS=5` để debug nhanh.
- Bench không chạy trong `npm test` để giữ test suite nhanh; trigger riêng qua `npm run bench` hoặc CI step riêng.
