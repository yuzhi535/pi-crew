# Changelog

## [0.6.3] — Pre-Publish Review: 87 Test Fixes, Heartbeat Fix, ENOENT Crash Fix, Scheduler Lifecycle (2026-06-11)

### Highlights
- **87 pre-existing test failures resolved** — 0 failures across 4,792 tests in 506 test files
- **Heartbeat false-positive dead detection fixed** — `message_start` added to progress flush events; PID liveness gate uses `task.checkpoint.childPid` fallback
- **ENOENT crash on prune/forget race fixed** — 4-layer defense in `persistSingleTaskUpdate`, `persistHeartbeat`, `saveRunTasks`, and `upsertCrewAgent`
- **Scheduled job lifecycle completed** — spawned runs tracked via `spawnedRunIds[]`, auto-cancelled on job removal, manifests stamped with `schedulerJobId` for traceability
- **Pre-push review**: 56 unpushed commits reviewed (116 files, +9,599/−980 lines), 1 release blocker found and fixed
- **Full-feature smoke test**: 58 integration tests covering all pi-crew actions

### Bug Fixes
- **`89ed975`** — Heartbeat watcher: added `message_start` to `shouldFlushProgressEvent()` so LLM stream start updates `lastActivityAt`. Previously, an 8m53s LLM response (365 file reads, no tool calls) triggered false `heartbeat_dead` at 300s threshold.
- **`9c1bf1f`** — Heartbeat watcher: PID liveness gate uses `task.heartbeat?.pid ?? task.checkpoint?.childPid` fallback. Review team discovered the gate was dead code because `createWorkerHeartbeat(taskId)` never receives PID.
- **`2bbbb99`** — ENOENT crash: `persistSingleTaskUpdate` recheck stat wrapped in try/catch; `persistHeartbeat` catches ENOENT; `saveRunTasks` guards with `statSync(stateRoot)`; `upsertCrewAgent` skips if stateRoot gone.
- **`08df7ce`** — Release blocker: `src/errors.ts` enum→const object, `src/state/health-store.ts` parameter property — both incompatible with Node 22 `--experimental-strip-types`.
- **`3e0b957`** — Sandbox constructor escape detection strengthened.
- **`dd279bc`** — EBADF (missing O_WRONLY flag), re-entrant sync locks, worktree list parsing, env-filter provider keys.
- **`38b8f5a`** — Create `transcripts/` directory before child-pi appends.
- **`d893434`** — Child-pi: remove API key allowlist; child Pi uses same config as parent.

### Test Fixes (87 total)
- **`1ab7926`** — 33 failures: state-store mtime CAS, locks race, discovery, atomic-write, config-schema, blob-store, env-filter, sandbox, security-hardening, worktree
- **`bba0bed`** — 3 failures: blob dedup, auto-recovery cap, transcript append
- **`03dd9b3`** — 14 failures: team-runner, retry-runner, hooks, stale-reconciler, resume-checkpoint, dynamic-script-runner, adaptive-implementation
- **`a91c316`** — 5 failures: re-entrant sync locks (`withRunLockSync`), `registerWorker()` optional `registeredAt`, `phase8-smoke` PI_TEAMS_HOME isolation, `test-integration-check` PI_CREW_ALLOW_MOCK, `test-bugs-all.mjs` graceful skip
- **`952c14d`** — 58 full-feature smoke tests added

### Features
- **`14269f0`** — Scheduler tracks spawned runs: `ScheduledJob.spawnedRunIds[]`, `CrewScheduler.recordSpawnedRun()`, `remove()` calls `runCancelFn` per spawned run, manifests stamped with `schedulerJobId`/`schedulerName`.
- **`e499570`** — Plugin registry system for framework context injection (Next.js, Vite, Vitest).
- **`84170c3`** — Team runner integrates plugin registry for framework-aware task context.
- **`ee466a8`** — Health score system with penalty-based scoring and time-series snapshots.
- **`daa53ab`** — Atomic write v2 with fsync + rename pattern for crash-safe state persistence.
- **`6c01f2c`** — CrewError taxonomy: E001–E006 structured error codes.
- **`2ce143f`** — State-store uses CrewError for structured errors.
- **`0cd4853`** — Stable task IDs via `stableIdFromContent` for cross-run consistency.
- **`ff3da92`** — Health snapshot saved on run completion.

### Stats
- 84 commits since v0.6.1
- 180 files changed (+16,312 / −1,929 lines)
- 366 source files, ~70K lines TypeScript
- 506 test files, ~66K lines TypeScript
- 4,792 tests, 0 failures


## [0.6.3] — Post-Release Hardening: Cleanup, Safe-Paths, State-Store Race (2026-06-08)

### Highlights
- **State-store manifest/tasks mtime race fixed** (commits `04fe0be`, `f15ee98`) — `loadRunManifestById` no longer throws on benign mtime skew between `manifest.json` and `tasks.json`. A previous user review (run `team_20260608082852_*`) hit a 4812-second hang because of this throw; the fix prevents the same hang from recurring.
- **Orphan worker + temp dir cleanup hardened** (8 commits) — 4-layer defense (in-memory Set, per-session temp dir, user-root temp dir, legacy `/tmp` cleanup) with symlink guards, `O_NOFOLLOW` opens, and bounded batch sizes.
- **`PI_CREW_PARENT_PID` restored to child env allow-list** (commit `e1f7dfe`) — silent regression from a previous round fixed; parent-guard now works again for orphan-worker detection.
- **`safe-paths.resolveRealContainedPath` extended** (commits `ba0ce54`, `aa457a5`) — now supports creating new files (target does not have to exist) while keeping full symlink-ancestor protection.
- **`blob-store` metadata race fixed** (commit `5819b18`) — per-hash in-memory lock + atomic write of content-then-metadata prevents concurrent writers from corrupting metadata.
- **Behavior change: `parent-guard` no longer `.unref()`s its interval** — the guard timer now keeps the event loop alive by design so workers do not exit while their parent is still alive but the worker has no other pending work. See "Behavior Changes" below.

### Security Fixes
- **`e1f7dfe`** — Restored `PI_CREW_PARENT_PID` in `child-pi.ts` env allow-list. Previous round (`dbf7a48`) replaced `PI_CREW_*`/`PI_TEAMS_*` wildcards with an explicit list but omitted `PI_CREW_PARENT_PID`, silently breaking the parent-guard mechanism.
- **`ba0ce54` / `aa457a5`** — `safe-paths.resolveRealContainedPath` now allows new-file creation while keeping symlink-ancestor protection. Documented the asymmetric ancestor policy in the function JSDoc.
- **`e1f7dfe`** (sibling) — `worktree/cleanup.ts` no longer uses `PI_*` / `PI_CREW_*` wildcards in `GIT_SAFE_ENV` (could match secret vars like `PI_PASSWORD`).
- **`2b8f27a` / `1bf67eb`** — Child env allow-list switched from dangerous wildcards (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `LC_*`, `XDG_*`, `NPM_*`) to an explicit list of 6 API keys + 12 essential env vars. Eliminates accidental secret leakage via matching name patterns.

### Cleanup Hardening (8 commits)
- **`5edcb18`** — Track temp dirs globally via in-memory `Set<string>`, cap `reconcileOrphanedTempWorkspaces` scan size, fix cleanup stub.
- **`8ba270d`** — Move temp dirs from `/tmp` to `~/.pi/agent/pi-crew/tmp/` (uses `userPiRoot()` so `PI_TEAMS_HOME` / `PI_CODING_AGENT_DIR` are respected). Eliminates `/tmp` pollution and unifies state layout.
- **`ceb1cb1`** — Layer 4 periodic cleanup for orphan prompt/task temp dirs older than 24h.
- **`a76932d`** — Skip symlinks and in-use dirs during cleanup, plus a one-shot legacy `/tmp` sweep to clean up directories left behind by pre-`8ba270d` installations.
- **`c9eb430`** — Kill orphan background workers and trigger temp cleanup on `session_start`.
- **`a192509`** — 4 critical hardening fixes: never `rmSync` a symlink, double-check immediately before delete, skip dirs currently in use, and tear down the global tracker on process exit.
- **`992231d`** — 24 new unit tests in `test/unit/cleanup-orphan-temp.test.ts` covering each cleanup layer and failure mode.
- **`dbf7a48`** — UI: replace `console.log` cleanup messages with `notifyOperator` for proper user notification.

### Bug Fixes
- **`5819b18`** — `blob-store.writeBlob` race condition: per-hash lock + atomic write of content-then-metadata (previously metadata first, leaving orphans on blob write failure).
- **`04fe0be`** — `state-store.loadRunManifestById` returned `undefined` (was: threw) on manifest/tasks mtime mismatch — the throw caused background runners to crash within 1s of startup.
- **`f15ee98`** — `state-store.loadRunManifestById` removed the false-positive mtime check entirely. The `saveManifestAndTasksAtomicSync` writer intentionally writes manifest before tasks, so a manifest with newer mtime than tasks is a NORMAL post-write state, not corruption.
- **`cd7ef89` / `a0c2ba3` / `098c8a9` / `b782424` / `e1ea7d4` / `de3f550` / `2b8f27a` / `1bf67eb`** — 8 deep-review auto-fix commits addressing 78+77+29+28+24+24+24+24 verified issues across the cleanup, state, runtime, and utils modules.
- **`e1f7dfe`** — `parent-guard.ts` unref'd timers were silently causing worker exit while parent was still alive; restoring the allow-list entry brought the guard back into effect.

### Behavior Changes
- **`parent-guard.ts` no longer `.unref()`s the guard interval** (revert/restore series `0aed8b5` / `152ac80` / `ee0ddb4` / `81b9608`). The watchdog timer now keeps the event loop alive by design. If a worker has no other pending work (no I/O, no timers, no child processes), the guard interval is the only thing keeping the worker alive until either the parent dies or the worker is explicitly stopped. The previous revert-then-restore pattern ("to test if they cause pi hang") never conclusively identified a root cause; the current state was reached after manual testing. **Mitigation recommended**: add a max-worker-lifetime safety net in a future release.

### New / Heavily Expanded Source Files
- **`src/runtime/orphan-worker-registry.ts`** (NEW, 307 lines) — PID+start-time+parent-PID verification before SIGKILL; file-locked registry at `<userPiRoot>/state/orphan-workers.json`; honest about residual userspace TOCTOU window between start-time re-check and actual `process.kill`.
- **`src/runtime/pi-args.ts`** (heavily expanded, 342 lines) — `createSafeTempDir` walks the full ancestor chain rejecting symlinks; `buildPiWorkerArgs` builds the child argv safely (no shell); `cleanupTempDir` / `cleanupAllTrackedTempDirs` / `cleanupOrphanTempDirs` / `cleanupLegacyOrphanTempDirs` provide 4 layers of defense with bounded work.

### Test Coverage
- **`test/unit/orphan-worker-registry.test.ts`** (NEW, 279 lines) — `registerWorker` / `unregisterWorker` / `cleanupOrphanWorkers` with `__test_setRegistryPath` for isolation; covers invalid PIDs, dedup, parent-PID tolerance, current-session protection, dead-PID pruning.
- **`test/unit/cleanup-orphan-temp.test.ts`** (NEW, 242 lines) — covers `cleanupTempDir` / `cleanupAllTrackedTempDirs` / `cleanupOrphanTempDirs` / `cleanupLegacyOrphanTempDirs` with `utimesSync` to simulate aged dirs; tests symlink skip, in-use skip, and `/tmp` legacy cleanup.
- **`test/integration/cleanup-full-flow.test.ts`** (NEW, 241 lines) — end-to-end integration of all cleanup layers, simulating a crashed session.

### Documentation
- **`src/runtime/parent-guard.ts`** — added a "Trust model" JSDoc section explaining why `PI_CREW_PARENT_PID` is safe to pass in env (PID is not a secret), what residual risks remain (child can spoof before guard starts), and why the guard is a self-termination signal, not a security boundary.
- **`src/utils/safe-paths.ts:resolveRealContainedPath`** — added a "Security model — asymmetric ancestor handling" JSDoc section explaining why `baseDir` ancestors must exist (cannot validate otherwise) while target ancestors may be non-existent (for new-file creation).

### Stats
- 23 commits since v0.6.2: `0aed8b5`, `152ac80`, `ee0ddb4`, `81b9608`, `5edcb18`, `8ba270d`, `ceb1cb1`, `a76932d`, `c9eb430`, `a192509`, `992231d`, `dbf7a48`, `e1f7dfe`, `1bf67eb`, `2b8f27a`, `de3f550`, `e1ea7d4`, `5819b18`, `cd7ef89`, `b782424`, `a0c2ba3`, `098c8a9`, `ba0ce54`, `aa457a5`, `04fe0be`, `f15ee98`
- 79 files changed (+3567 / -712)
- 1 new state fix: manifest/tasks mtime false positive
- 1 new file: `orphan-worker-registry.ts` (307 lines)
- 3 new test files: 762 lines

## [0.6.2] — Issue #28 + #29 Fixes + Post-Review Hardening (2026-06-05)

### Highlights
- **Issue #28 fixed**: `crew-init.ts` jiti namespace race — inline `parseRoot`/`safeJoin`/`safeDirname`/`safeResolve` helpers; jiti upgraded 2.6.1 → 2.7.0
- **Issue #29 fixed**: 11 hardcoded `.crew/state/runs/...` sites now use `projectCrewRoot()` for `.pi/teams/` fallback
- **Subagent defense-in-depth**: `record.promise` rejection can no longer crash pi via `unhandledRejection`
- **2 new MEDIUM-severity path-traversal vulnerabilities fixed** in `decision-ledger.ts` (7 functions) and `run-graph.ts` (3 functions)
- **F-8 safeJoin edge case** fixed (trailing separator handling)
- **~100 new tests** across 7 files (5 e2e scripts + 18 regression tests for the new fixes)

### Security Fixes (MEDIUM)
- `decision-ledger.ts`: `initLedger`, `appendEntry`, `getLedger`, `getLatestDecision`, `summarizeLedger`, `promoteCandidate`, `decayCandidate` now call `assertSafePathId("runId", runId)` to prevent path-traversal
- `run-graph.ts`: `saveRunGraph`, `loadRunGraph`, `listRunGraphs` use `projectCrewRoot()` and `assertSafePathId("runId", runId)` (same bug class as issue #29)

### Bug Fixes
- **F-1** (post-issue-#29 review): removed duplicate "Defense in depth" comment in `subagent-manager.ts`
- **F-3** (post-issue-#29 review): added F-6 documentation in `test/unit/crew-init.test.ts` header
- **F-8** (post-issue-#29 review): `safeJoin("/", "foo")` no longer produces `"//foo"`; trailing separator in parts is stripped (UNC paths preserved)
- **`crew-init.ts safeJoin`**: collapse internal runs of separator while preserving leading UNC `\\\\` and POSIX `/`

### Test Coverage
- 9 new regression tests in `test/unit/issue-29-pi-paths.test.ts` (resolver precedence, `waitForRun` error message in both layouts, checkpoint/skill-effectiveness round-trip in `.pi/`-only project, decision-ledger path, defense-in-depth via real child process)
- 13 new tests in `test/unit/crew-init.test.ts` (F-1 UNC preservation, F-2 jiti race via `path` Proxy, F-3 `safeResolve` graceful degradation, F-4 `__test__internals` export convention, F-5 stale docstring, F-6 async-runner rationale, F-8 trailing-separator)
- 4 new tests in `test/unit/crew-init.test.ts` for `safeJoin` (F-8 regression coverage)
- 7 new tests in `test/unit/decision-ledger.test.ts` (path-traversal rejection)
- 3 new tests in `test/unit/run-graph.test.ts` (path-traversal rejection)
- 14 new tests in `test/unit/skill-effectiveness.test.ts` (cwd parameter migration)
- 5 new E2E scripts in `scripts/test-issue-29-*.ts`:
  - `test-issue-29-e2e.ts` — unit-level integration
  - `test-issue-29-crash.ts` — focused crash reproduction
  - `test-issue-29-team-tool.ts` — slow-path early-exit error message
  - `test-issue-29-real-tasks.ts` — full `executeTeamRun` pipeline in `.pi/`-only project (25 assertions)
  - **`test-issue-29-real-runtime.ts`** — spawns REAL detached `background-runner.ts` process (most realistic)

### Test Quality Improvements
- **F-4** (post-issue-#29 review): `crew-init.ts findProjectRoot` now accepts optional `path` dep; test passes the `stubPath` Proxy directly to source code (not a copy)
- **F-5** (post-issue-#29 review): defense-in-depth crash test now spawns a real child process so the host's `unhandledRejection` detector can actually fire (was previously a comment-only test)

### Stats
- 7 source files changed (3 fixes + 1 new path-resolver usage)
- 7 test files changed (4 unit + 5 e2e scripts)
- 9 commits since v0.6.1: `e95e055`, `cd8c3b8`, `a80fe6c`, `362789c`, `0c78307`, `083afaf`, `d33b86c`, `03c0a20`, `1bedd24`, `0ce3d5a`, `b17fb6b`, `f8731e6`, `105d31d`, `00c66a5`, `2d49910`, `6cbbafa`

## [0.6.1] — Post-v0.6.0 Security Hardening + Test Coverage (2026-06-04)

### Highlights
- **42+ security issues fixed** — 7 CRITICAL, 10 HIGH, 11 MEDIUM, 14 post-restart review findings
- **~1,900 new tests** across 113+ test files — total suite now ~4,600 tests
- **38 dead exports cleaned** across 19 modules
- **12 `any` types replaced** with proper TypeScript types
- **Full battle-testing** — 2 Pi restart cycles, all team types, management operations verified

### Security Fixes (CRITICAL)
- `async-runner.ts`: Environment variable leak in child process — sanitized with `sanitizeEnvSecrets()`
- `verification-gates.ts`: Shell injection via user-controlled strings — switched to `execFileSync`
- `sandbox.ts`: `String.fromCharCode` bypass — added `constructor` to `FORBIDDEN_PATTERNS`
- `locks.ts`: Timing-unsafe comparison on lock tokens — replaced with constant-time compare
- `event-log.ts`: Request IDs logged in plaintext — now hashed before logging
- `team-runner.ts`: Missing heartbeat for long-running tasks — added 30s heartbeat writer
- `worktree-manager.ts`: Environment secrets leaked to git subprocesses — `sanitizeEnvSecrets()`

### Security Fixes (HIGH)
- `preStepScript` symlink traversal — `fs.realpathSync` before path containment check
- `childEnvAllowList` wildcard patterns (`LC_*`, `XDG_*`) could leak secrets
- Event log sync/async race condition — route sync `appendEvent` through async queue
- Subagent record validation — `sanitizePersistedRecord()` with allow-listed fields
- Verification gate redirect — allow single `>` for `2>&1`, block `>>` and `<[^&]`
- `allowPatterns` validation — reject patterns matching empty strings

### Security Fixes (MEDIUM)
- `logInternalError` import paths normalized across all modules
- `Object.freeze()` narrowing fix — use `Readonly<{...}>` explicit types
- NTFS mtime granularity — write-first, `utimes`-after for cache invalidation
- Windows path separators — platform-agnostic assertions in tests
- `executeUnchecked` visibility — `__test_executeUnchecked` export pattern
- `seedPaths` containment — `normalizeSeedPaths()` validates paths stay within `repoRoot`

### Code Quality
- 38 dead/unused exports removed across 19 source modules
- 12 `any` types replaced with proper interfaces
- `enforceLabelCap` MRU correctness — `delete`-then-`set` to maintain Map insertion order
- `readIfSmall` bounded reads — `Buffer.alloc` + `fs.readSync` instead of `readFileSync`

### Test Coverage
- 113 new test files, ~1,900 new test cases
- Modules now covered: config, extension, workflow, subagent, observability, runtime, graph,
  heartbeat, permissions, state, locks, event-log, safe-bash, sandbox, verification-gates,
  async-runner, team-runner, background-runner, worktree, fingerprint, BM25 search, and more
- Windows CI verified: path separators, `npx.cmd` resolution, NTFS mtime all pass
- Test runner wrapper (`scripts/test-runner.mjs`) ensures non-zero exit on failures

### Stats
- Test suite: ~4,600 pass, 0 fail
- TypeScript: 0 errors
- Lines added since v0.6.0: 22,520 (742 src + 21,777 test)
- Files changed: 204
- Security issues fixed: 42+
- Audit rounds: 42 (including post-v0.6.0 battle-testing)

## [0.6.0] — Source Tour Patterns + 15 New Modules (2026-06-03)

### Highlights
- **15 upstream patterns implemented** from 63-repository source tour
- **10 new source modules** (2,267 LOC): chain-parser, run-drift, intercom-bridge,
  plan-templates, task-id, context-retrieval, intermediate-store, fingerprint,
  memory-store, observation-store
- **37 skills reviewed** with origin fields, all passing validation

## [0.5.22] — Remaining Issues from Ultimate Sweep (2026-06-03)

### Highlights
- `DEFAULT_CHILD_PI` frozen with `Readonly<>` type (prevents mutation)
- `parseWithSchema` logs validation failures with context
- Global registry cleanup (`uninstallCrewGlobalRegistry`)
- Mailbox sender auth and cross-workspace hooks documented

### Fixes
- `defaults.ts`: `DEFAULT_CHILD_PI` wrapped in `Readonly<{...}>` to prevent mutation via module injection
- `config.ts`: `parseWithSchema` logs validation failures when context provided
- `team-tool.ts`: Added `uninstallCrewGlobalRegistry()` paired with install
- `register.ts`: Calls `uninstallCrewGlobalRegistry()` in `cleanupRuntime()`
- `mailbox.ts`: Security documentation for sender authentication
- `hooks/registry.ts`: Security documentation for cross-workspace hook behavior

### Stats
- Test suite: 2703 pass + 1 skip, 0 fail
- TypeScript: 0 errors

## [0.5.21] — Ultimate Final Sweep: HIGH Security + Correctness Fixes (2026-06-03)

### Highlights
- **safe-bash line-continuation bypass fixed** — `$\n(evil)` now blocked
- **scheduledJobs dead code fixed** — settings sanitizer now passes through scheduled jobs
- **Memory-bounded file reads** — `readIfSmall` uses `fs.readSync` with buffer instead of full file read
- **Event log corruption detection** — `scanSequence` logs warnings for corrupt JSON lines

### Security
- `safe-bash.ts`: All structural checks now use `normalized` string (stripped line continuations)
- `\$\s*\(` regex catches `$<newline>(evil)` → `$(evil)` bypass that bash interprets as command substitution
- Added 2 regression tests for line-continuation bypass

### Fixes
- `settings-store.ts`: `sanitizeSettings()` now copies `scheduledJobs` as opaque array
- `task-output-context.ts`: `readIfSmall` uses `Buffer.alloc` + `fs.readSync` instead of `readFileSync` + `slice`
- `event-log.ts`: `scanSequence` counts and logs corrupt JSON lines via `logInternalError`

### Stats
- Test suite: 2703 pass + 1 skip, 0 fail
- TypeScript: 0 errors
- Total issues fixed across 37 rounds: ~155+

## [0.5.20] — Verification Sweep: 7 Fixes (2026-06-03)

### Highlights
- **Correctness bug fixed**: `enforceLabelCap` could silently evict actively-used metric entries
- `Date` removed from forbidden globals (was blocking legitimate workflow scripts)
- `scheduledJobs` properly typed in `CrewSettings` interface
- 3 new tests for metric MRU eviction behavior

### Fixes

#### Correctness
- `Counter.inc()` and `Gauge.set()` now delete-then-set to move keys to MRU position
- Previously, `enforceLabelCap` could evict an entry that was just updated

#### Consistency
- Removed `Date` from `FORBIDDEN_GLOBALS` in `DynamicScriptRunner`
- `Date` is not dangerous — was causing false positives for `myDate`, `updateDate`, etc.
- `DynamicScriptRunner` and `WorkflowSandbox` now consistent

#### Type Safety
- Added `scheduledJobs?: unknown[]` to `CrewSettings` interface
- Removed `as any` cast in `register.ts` (now uses `as ScheduledJob`)

#### Code Quality
- Removed dead `reason` variable in `settings-store.ts`
- Added trailing newline to `event-bus.ts` (POSIX compliance)
- Added 3 tests for Counter/Gauge MRU eviction behavior

### Stats
- Test suite: 2658+ pass + 1 skip, 0 fail
- TypeScript: 0 errors
- Security: All 7 SEC-* issues confirmed still fixed

## [0.5.19] — Final Sweep: 8 MEDIUM/LOW Fixes + 2 Test Fixes (2026-06-03)

### Highlights
- **All remaining issues fixed** — 4-agent review sweep found 0 CRITICAL/HIGH
- 2 pre-existing test failures fixed (env isolation)
- Memory bounds added to security log and metrics primitives
- Defensive path validation in streaming/sidechain output
- Production cleanup now clears hooks

### Fixes

#### MEDIUM: Memory bounds
- `securityEventLog` in `discover-agents.ts` capped at 1,000 entries (was unbounded)
- `Counter`/`Gauge`/`Histogram` Maps in `metrics-primitives.ts` capped at 10,000 label combinations

#### LOW: Code quality
- `console.warn` → `logInternalError` in `settings-store.ts` and `discover-agents.ts`
- `crewEventBus` dead code documented (retained for future use)
- `clearHooks()` called in production cleanup path (`register.ts`)
- `assertSafePathId` added to `streaming-output.ts` and `sidechain-output.ts`

#### Test fixes
- `adaptive-implementation.test.ts`: replaced `restoreEnv` with `delete` to prevent leaked `PI_CREW_ROLE`
- `subagent-tools-integration.test.ts`: added env isolation to first test case

### Stats
- Test suite: 2688 pass + 1 skip, 0 fail
- TypeScript: 0 errors
- Files changed: 9

## [0.5.18] — Final Review Fixes (2026-06-03)

### Highlights
- **4 HIGH issues fixed** from comprehensive final review of entire codebase
- CI now properly fails when tests fail (`npm test` exits non-zero)
- Sandbox prototype freeze scoped to VM context (no host process impact)
- Safe-bash extension delegates to core module (eliminated ReDoS regression)
- Shell injection eliminated in project-detector (`execSync` → `execFileSync`)

### Fixes

#### HIGH: CI exit code
- `tsx --test` always exits 0 even with failing tests — masked regressions in CI
- Added `scripts/test-runner.mjs` wrapper that parses test output and exits 1 on failures
- Updated `test:unit` and `test:integration` npm scripts

#### HIGH: Sandbox prototype freeze scope
- `Object.freeze(Object.prototype)` in `WorkflowSandbox` constructor affected entire Node.js process
- Moved freeze inside VM context via `vm.runInContext()` — only freezes when sandbox is created, skipped in `NODE_ENV=test`
- Context object itself frozen (process-safe, only freezes our record)

#### HIGH: Shell injection risk in project-detector
- `execSync("git remote get-url origin")` passed through `/bin/sh -c` — any interpolated variable would be vulnerable
- Replaced with `execFileSync("git", ["remote", "get-url", "origin"])` — no shell interpretation

#### HIGH: ReDoS regression in safe-bash-extension
- Extension duplicated outdated regex patterns with O(n²) backtracking
- Refactored to import `isDangerous()` from `safe-bash.ts` (linear-time scanner)
- Eliminated code divergence between core and extension modules

### Stats
- Test suite: 2698 pass + 1 skip, 0 fail
- TypeScript: 0 errors
- Files changed: 5
- Security issues fixed: 4 HIGH

## [0.5.17] — Security Hardening + ECC Patterns + Skill Review (2026-06-03)

### Highlights
- **3 CRITICAL security fixes**: path traversal, sandbox escape, executeUnchecked bypass
- **3 HIGH security fixes**: allowPatterns bypass, safe-bash fallback message, mock mode
- **3 MEDIUM security fixes**: home hooks visibility, API keys documentation, sync lock deprecation
- **2 new features** from ECC/dmux patterns: seedPaths overlay + structured handoff template
- **2 gap fills**: handoff parser + per-step seedPaths
- **36 skills reviewed**: origin fields, broken refs fixed, verify-skill.ts updated
- **1 bug fix**: adaptive-plan parser strips markdown code fences
- **1 regression fix**: mock mode NODE_ENV gate reverted
- **41 new tests** across 6 test files

### Security Fixes

#### CRITICAL
1. `orchestrate.ts`: Path traversal — planPath validated with `resolveContainedPath()`
2. `sandbox.ts`: Prototype pollution — `Object.freeze` on prototypes, `globalThis`/`global` in FORBIDDEN_PATTERNS
3. `dynamic-script-runner.ts`: `executeUnchecked` → private, `__test_executeUnchecked` test-only export

#### HIGH
4. `safe-bash.ts`: allowPatterns validation rejects `/.*/` and permissive catch-all patterns
5. `safe-bash-extension.ts`: Error message no longer suggests bypassing safe-bash
6. `child-pi.ts`: Mock mode requires `PI_CREW_ALLOW_MOCK=1` (set in parent process only)

#### MEDIUM
7. `worktree-manager.ts`: `logInternalError` warning when home directory hooks accepted
8. `child-pi.ts`: SECURITY WARNING JSDoc on API key allow-list trade-off
9. `event-log.ts`: Expanded deprecation notice on `withEventLogLockSync` blocking behavior

### Features (ECC/dmux patterns)

- **seedPaths**: Overlay local/uncommitted files into worktrees via config (`worktree.seedPaths`) or per-step (`WorkflowStep.seedPaths`). Path traversal validation, dedup, recursive copy.
- **Structured Handoff Template**: `HANDOFF_TEMPLATE` constant + `parseHandoffFromOutput()` parser. Agents receive handoff format instructions automatically.

### Skill Review
- All 36 skills: added `origin` YAML frontmatter field
- Fixed `widget-rendering` wrong file path
- Fixed `orchestration` + `detection-pipeline-design` broken cross-skill references
- Fixed 4 skills with wrong `source/pi-mono/` paths
- `verify-skill.ts` now validates `origin` field

### Bug Fixes
- `adaptive-plan.ts`: `stripCodeFence()` strips markdown code fences inside ADAPTIVE_PLAN markers — fixes planner output parsing for non-frontier models
- Mock mode regression: reverted NODE_ENV gate, uses PI_CREW_ALLOW_MOCK only (child processes don't inherit NODE_ENV)

### Stats
- Test suite: 2698 pass + 1 skip, 0 fail (was 2657 in v0.5.16; +41 net)
- TypeScript: 0 errors
- New test files: 6 (worktree-seed-paths, task-handoff-template, task-handoff-parser, adaptive-plan +3 safe-bash tests)
- Files touched: 50+
- Security issues fixed: 9 (3 CRITICAL + 3 HIGH + 3 MEDIUM)
- False positives verified: 2

## [0.5.16] — Rounds 22–31 Audit Fixes (2026-06-02)

### Highlights
- **1 bug fix**: OTLP exporter `dispose()` now awaits in-flight push (bounded by 10s timeout)
- **269 new unit tests** across 16 previously-untested modules (Pattern #3)
- **72 unused imports removed** across 28 source files (Pattern #6)
- **2 defensive caps** for unbounded Maps (Pattern #2)
- **1 L1 fix**: `console.warn` → `logInternalError` in crew-hooks

### Round 22: Defensive Caps (commit 85b3be6)
- Bounded `autoRecoveryLast` and `agentEventSeqCache` Maps to 1000 entries
- Eviction uses insertion-order oldest-first pattern

### Round 23: Resource Cleanup (commit 4be2c4e)
- OTLP exporter `dispose()` now async, awaits in-flight push with 10s timeout
- Surveyed all setInterval/setTimeout, process.on, file watchers, event listeners, AbortControllers — all clean

### Round 24: Test Coverage — discover-agents, markers, tiered-eval (commit cfe5242)
- 50 new tests: `sanitizeAgentSystemPrompt` (6 rules), `sanitizeGuidanceContent` (5 rules), `TieredEvalRunner` class

### Round 25: Test Coverage — adaptive-plan, group-join (commit 89e1cf1)
- 42 new tests: `slug`, `extractAdaptivePlanJson`, `parseAdaptivePlan`, `repairAdaptivePlan`, `GroupJoinManager`

### Round 26: Test Coverage — pi-args, i18n (commit 3669f24)
- 38 new tests: `applyThinkingSuffix`, `resolveCrewMaxDepth`, `t()`, `addTranslations`, `listLocales`

### Round 27: Test Coverage — validation-types, live-extension-bridge (commit 44a2366)
- 36 new tests: `validateWithSeverity` strict/lenient modes, `buildExtensionBridge` mock session

### Round 28: Test Coverage — direct-run, live-session-health (commit 339ac7d)
- 17 new tests: `isDirectRun`, `directTeamAndWorkflowFromRun`, `collectLiveSessionHealth`

### Round 29: Test Coverage — process-status, task-claims (commit 405e05d)
- 43 new tests: `checkProcessLiveness`, `isActiveRunStatus`, full claim lifecycle

### Round 30: Test Coverage — task-display, green-contract, session-utils (commit 7d065ca)
- 43 new tests: `shouldMaterializeAgent`, `taskById`, `waitingReason`, `greenLevelSatisfies`, `assertValidSessionId`

### Round 31: Code Quality — unused imports + L1 fix (commit 35cc0e7)
- 72 unused imports removed across 28 source files
- `crew-hooks.ts`: `console.warn` → `logInternalError` for unknown event types

### Stats
- Test suite: 2657 pass + 1 skip, 0 fail (was 2370 in v0.5.14; +287 net)
- TypeScript: 0 errors
- New test files: 13
- Files touched: 58

## [0.5.15] — Round 20 + 21 Audit Fixes (2026-06-02)

### Source tour
- Pulled latest `can1357/oh-my-pi` (1751 new commits since 2026-05-11) to working copy
- Surveyed extensibility, skill system, and security/performance changes via 3 parallel explorer agents
- Distilled 2 high-impact, immediately applicable patterns (Round 20)
- Identified 5 more upgrade opportunities; applied 5 in Round 21

### Round 20: Lock token guard + tool-error sanitization (commit f448d7d)

#### 1. Per-process lock tokens (src/state/locks.ts)
- **Pattern source**: oh-my-pi commit `cd578a86d` (`file-lock.ts:13-152`)
- **Bug fixed**: "Losing contender wipes winner's lock" race when one process times out and steals a stale lock that the original holder is about to release
- Lock file now carries a UUID token. `releaseLock` refuses to `fs.rm` unless the stored token matches.
- 3 new tests in `test/unit/locks-race.test.ts`

#### 2. Tool-error sanitization (src/ui/tool-render.ts)
- **Pattern source**: oh-my-pi `render-utils.ts:177-185` (`replaceTabs(truncateToWidth(clean, LINE_CAP))`)
- **Bug fixed**: Embedded tabs/newlines/long strings in tool errors break TUI border alignment
- Applied to `renderAgentProgress` and `renderAgentToolResult` (2 places)
- `replaceTabs` is now exported from `src/ui/render-diff.ts` for reuse
- 2 new tests in `test/unit/tool-render.test.ts`

### Round 21: L1 cleanup, lock kind, JSONL per-line cap, in-place loader test (commit 1bf120b)

#### 1. L1 cleanup in src/state/schedule.ts
- `console.warn` → `logInternalError` (consistency with rest of codebase)
- `require("node:fs")` → top-level `fs`/`path` imports
- 3 new tests in `test/unit/schedule-store.test.ts`

#### 2. Dead code sweep in src/state/locks.ts
- Removed misleadingly-named `readLockStateAsync` (sync I/O, called from async path) and its redundant call site
- Async path now mirrors sync path exactly: stale-check + release + sleep

#### 3. Lock file `kind` discriminator (forward compat)
- Lock JSON now includes `kind: "run" | "file"`
- `withRunLock` writes `kind="run"`; `withFileLockSync` writes `kind="file"`
- Old locks (no `kind` field) still work — `releaseLock` only reads `token`, so the discriminator is purely additive
- 3 new tests (kind for run, kind for file, back-compat with legacy locks)

#### 4. JSONL per-line cap (defensive, src/state/jsonl-writer.ts)
- Single huge line could exhaust memory during `redactJsonLine`
- New `DEFAULT_MAX_LINE_BYTES = 1MB`. Lines exceeding the cap are dropped and counted
- `logInternalError` fires on the first drop and every 100th drop thereafter
- 2 new tests in `test/unit/jsonl-writer.test.ts`

#### 5. In-place extension loader integration test
- **Pattern source**: oh-my-pi commit `c5e3698f4` (changed how extensions are loaded)
- This test verifies pi-crew's `import.meta.url`-based skill path resolution still works with the new in-place loader
- 2 new tests in `test/integration/extension-skill-resolution.test.ts`

### Summary
- **2 rounds** (Round 20 + 21)
- **2 commits**: `f448d7d` (Round 20) + `1bf120b` (Round 21)
- **10 new tests** across 4 test files
- **Total tests**: 50 pass + 1 skip, **0 fail** (was 49 in v0.5.14)
- **TypeScript**: 0 errors
- **Patterns adopted**: 5 from `can1357/oh-my-pi` post-2026-05-11

### Patterns surveyed but not applied (low applicability for pi-crew)
- **Streaming JSON throttle** (3a733c480) — pi-crew has no streaming JSON parser
- **In-place state mutation** (3a733c480) — pi-crew's spreads are bounded (small N), not hot paths
- **Bounded row probing** (b522fde56) — pi-crew has no SQL queries
- **MCP reconnect storm circuit breaker** — pi-crew has no MCP reconnect logic
- **Drop `args` global from eval** (4ab40764d) — pi-crew's `dynamic-script-runner.ts` already safe
- **Shell-injection rejection in git specs** (22e564a85) — pi-crew has no plugin install path
- **NPM registry pinning** (9abce6e97) — pi-crew's `install.mjs` is config-only; user runs `pi install npm:pi-crew`
- **Extension flag shadow** (1fbc2cbd7) — pi-crew has no `registerFlag` calls

## [0.5.14] — Round 19 Audit Fixes (2026-06-02)

### Phase 1: Path validation in checkpoint.ts (MEDIUM security)
- All public functions now validate runId/taskId via `assertSafePathId()`:
  - `saveCheckpoint(runId, taskId, ...)`
  - `loadCheckpoint(runId, taskId)`
  - `clearCheckpoint(runId, taskId)`
  - `hasCheckpoint(runId, taskId)`
  - `listCheckpoints(runId)`
  - `FileCheckpointStore.save/load/delete` (validates taskId)
- Prevents path traversal: malicious IDs like `../../../etc/passwd` throw "Invalid runId" instead of writing outside `.crew/`.

### Phase 2-4: Test coverage (33 new tests)
- 11 new tests in `test/unit/checkpoint.test.ts` (path validation)
- 14 new tests in `test/unit/subagent-manager.test.ts` (basic + path validation)
- 16 new tests in `test/unit/paths.test.ts` (findRepoRoot, projectPiRoot, projectCrewRoot)

### Tests
- 2370/2370 pass (was 2352 in v0.5.13; +18 net)
- 33 new tests across 3 new test files
- TypeScript: 0 errors

## [0.5.13] — Round 18 Audit Fixes (2026-06-02)

### Phase 1: Switch to execFileSync (HIGH security)
- `src/benchmark/benchmark-runner.ts` — Replaced `execSync` with `execFileSync(program, args)`. This prevents shell parsing of command strings, even if `validateCommand` is bypassed.
- `validateCommand` retained as defense-in-depth (blocks shell metacharacters).
- New `splitCommand()` helper safely splits validated commands.

### Phase 2: Precompute document frequency (MEDIUM performance)
- `src/utils/bm25-search.ts` — `BM25Search.df()` is now precomputed once in the constructor via `precomputeDocumentFrequencies()`. Lookup is O(1) via `dfCache: Map<term, number>`.
- Per-search complexity: O(Q * N) instead of O(Q² * N²).

### Phase 3+4: Test coverage for 3 untested modules
- 15 tests in `test/unit/bm25-search.test.ts`
- 15 tests in `test/unit/scan-cache.test.ts`
- 20 tests in `test/unit/benchmark.test.ts`
- **Total: 50 new tests**

### Tests
- 2352/2352 pass (was 2313 in v0.5.12; +39 net)
- 50 new tests across 3 new test files
- TypeScript: 0 errors

## [0.5.12] — Round 17 Audit Fixes (2026-06-02)

### Phase 1: Signal Handler Stacking (HIGH)
- `src/extension/crew-cleanup.ts` — Added module-level `signalHandlersRegistered` flag. `process.on("SIGTERM"/"SIGHUP")` is now registered only once even if `registerCleanupHandler` is called multiple times. Without this fix, listeners stack up on extension reload and `cleanupChildProcesses` fires N times on shutdown.
- Also wrapped `handleSignal()` with `.catch()` to prevent unhandled promise rejections.

### Phase 2: L1 Cleanup (continued)
Replaced 8 `console.error` calls with `logInternalError` for consistency:
- `src/extension/crew-cleanup.ts` (3 calls)
- `src/extension/async-notifier.ts:124`
- `src/runtime/async-runner.ts:166`
- `src/runtime/hidden-handoff.ts:244`
- `src/runtime/crew-hooks.ts:167,172`

### Phase 3+4: Test Coverage
- 8 new tests in `test/unit/crew-hooks.test.ts`
- 1 new test in `test/unit/crew-cleanup.test.ts` (signal handler idempotency)

### Tests
- 2313/2313 pass (was 2308 in v0.5.11; +5 net from new tests)
- 9 new tests across 2 test files
- TypeScript: 0 errors

## [0.5.11] — Round 16 Audit Fixes (2026-06-02)

### Phase 1: L1 cleanup (continued)
Replaced 6 `process.stderr.write` calls with `logInternalError` for consistency with v0.5.9 L1 fix:
- `src/extension/notification-router.ts:87` — sink error fallback
- `src/i18n.ts:106` — missing translation warning
- `src/observability/metric-registry.ts:40,52,64` — metric description change warnings
- `src/state/jsonl-writer.ts:71` — write failed warning

Note: `src/runtime/parent-guard.ts:37` left as-is — that's an exit-time log that must fire synchronously.

### Phase 2: Removed dead code
- `src/extension/notification-router.ts` — removed unused `seenCleanupCounter` field

### Phase 3: Defensive `MAX_TRACKED_STATES` cap
- `src/runtime/overflow-recovery.ts` — added `MAX_TRACKED_STATES = 5000` cap. `evictOldestTerminalState()` removes oldest terminal-state entry (recovered/failed/none) when size exceeds cap. Live states in compaction/retrying are protected.

### Phase 4: Test coverage for under-tested modules
- 8 new tests in `test/unit/notification-router.test.ts`
- 12 new tests in `test/unit/overflow-recovery.test.ts`
- 7 new tests in `test/unit/auto-resume.test.ts`
- Total: 27 new tests
- Bonus: fixed `CorrelationContext` type misuse in `test/unit/observability.test.ts`

### Tests
- 2308/2308 pass (was 2311 in v0.5.10; -3 from CorrelationContext type fixes)
- 27 new tests across 3 new test files
- TypeScript: 0 errors

## [0.5.10] — Round 15 Audit Fixes (2026-06-02)

### Phase 1: Semaphore Queue Cap (HIGH)
- **H1**: `src/runtime/semaphore.ts:11` - `#queue` unbounded growth → added `MAX_QUEUE = 10_000` cap. `acquire()` now throws "Semaphore queue full" when at cap.

### Phase 2: Observability Hardening (MEDIUM)
- **L1**: `src/observability/event-bus.ts:47` - `console.error` → `logInternalError` for consistency
- **OTLPExporter**: 
  - Added `MAX_SNAPSHOTS_PER_PUSH = 5_000` cap to prevent OOM/oversized payloads
  - Added `inFlight` promise tracking in `start()` to prevent overlapping setInterval pushes
- **live-agent-manager**: Added `MAX_LIVE_AGENTS = 5_000` cap. `registerLiveAgent()` now evicts oldest completed agent first; if none, evicts oldest running with warning.

### Phase 3: Test Coverage (LOW)
- Added first-ever test coverage for `src/observability/`:
  - 8 new tests in `test/unit/observability.test.ts` covering metric-registry, correlation, OTLP conversion
- Reveals new finding: `crew.<domain>.<measure>` naming pattern enforcement is good (already validated)

### Regression: Team-Runner Heartbeat (CRITICAL)
- **CRITICAL regression** discovered via background watcher notification
- `team-runner.ts` had NO periodic heartbeat, so any team run >5 min was being marked stale by the reconciler
- Root cause of Round 15 review cancellation
- Added `startTeamRunHeartbeat()` helper - writes `heartbeat.json` to stateRoot every 30s
- Wired into `executeTeamRun()` with start/stop on both success and error paths
- Same JSON shape as background-runner for reconciler compatibility

### Tests
- 2311 tests pass / 0 failures (was 2297 in v0.5.9)
- +14 new tests across 3 new test files:
  - `test/unit/team-runner-heartbeat.test.ts` (2 tests)
  - `test/unit/round15-observability.test.ts` (4 tests)
  - `test/unit/observability.test.ts` (8 tests)
- TypeScript: 0 errors

## [0.5.9] — Round 14 Audit Fixes (2026-06-02)

### Phase 1: Sandbox Security (3 CRITICAL fixes)
- **C1**: `sandbox.ts:70` - Full `process.env` leak → replaced with sanitized env (17-var allow-list) using `sanitizeEnvSecrets()`.
- **C2**: `sandbox.ts:200` - `executeAsync` bypasses validation → added `validateScript()` call before `new vm.Script()`.
- **C3**: `sandbox.ts:71` - Env not deeply frozen → `Object.freeze()` now wraps the whole process object including its env property.

### Phase 2: Event Log Correctness (4 HIGH fixes)
- **H1**: `event-log.ts:300` - `asyncQueues` leak on success → switched from `.catch()` to `.then(success, error)`.
- **H2+H3**: `event-log.ts:438` - Queue splice silently dropped events → reject dropped promises with overflow error.
- **H7**: `event-log.ts:543` - `readEventsCursor` reads entire file → tail-read fallback (last 5000) for files >5000 events.

### Phase 3: Lock Robustness (1 HIGH fix)
- **async path PID check**: `locks.ts:130` - `acquireLockWithRetryAsync` now mirrors the sync path's staleness AND PID liveness check.

### Phase 4: Config & Env Hardening (3 HIGH/MEDIUM fixes)
- **H8**: `config-schema.ts:121` - OTLP endpoint no URL validation → added `pattern: ^https?://` + 2048 char cap.
- **PI_TEAMS_HOME**: `config.ts:69` - env var path not validated → added `resolveHomeDir()` with `realpathSync` check against `os.homedir()`.
- **TIMEOUT**: `child-pi.ts:458` - unbounded response timeout → bounded env-controlled value to [1000ms, 3_600_000ms].

### Phase 5: Code Quality (5 MEDIUM/LOW fixes)
- **M1**: `tool-render.ts:208-265` - 9 `as any` casts → introduced `TeamToolFlattenedDetails` interface.
- **gh-protocol.ts:31** - `execSync` blocking → replaced with `execFileSync(args[])`.
- **safe-bash.ts:148** - `allowPatterns` bypass risk → added SECURITY WARNING in JSDoc.
- **atomic-write.ts:137** - Windows fallback non-atomic → documented ATOMICITY CAVEAT.
- **Test infra** - `package.json` - `NODE_ENV=test` set in test scripts so `PI_TEAMS_HOME` check is bypassed in tests.

### Backlog (deferred)
- `executeUnchecked` public API (low risk; sandbox still applies)
- `Promise`/`Symbol` in sandbox globals (theoretical risk; no exploit path)
- Test coverage gaps in async error paths (add incrementally)

### Tests
- 2293 tests pass / 0 failures
- 15 new tests across `sandbox-security.test.ts`, `event-log-leak.test.ts`, `config-env-hardening.test.ts`
- TypeScript: 0 errors

## [0.5.8] — Final 5 Low-Severity Issue Fixes (2026-06-01)

### Phase 5 (Final): Race Conditions + Edge Cases

- **Issue #12: `acquireLockWithRetry` race** (Low) — `src/state/locks.ts`: added `isLockHolderAlive()` check. Now uses BOTH staleness AND PID liveness: fresh + alive holder = fail, else = safe to clear. Prevents stealing a lock from a still-running process whose PID was recently reused.

- **Issue #13: `loadRunManifestById` TOCTOU** (Low) — `src/state/state-store.ts`: retry-on-stat-mismatch approach. Re-stat and re-read in a loop (up to 3 attempts) until size/mtime are stable across stat and read. Catches torn writes without depending on `withFileLockSync`.

- **Issue #14: `cleanupOldArtifacts` N stat calls** (Low) — `src/state/artifact-store.ts`: use `Dirent.isDirectory()` from `readdirSync({ withFileTypes: true })` to avoid `statSync` for type info. `statSync` now only for mtime.

- **Issue #15: `validateMailbox` concurrent access** (Low) — `src/state/mailbox.ts`: wrap read + optional repair in `withFileLockSync`.

- **Issue #16: `updateMailboxMessageReply` concurrent rewrite** (Low) — `src/state/mailbox.ts`: wrap read-modify-write in `withFileLockSync`.

### Bug fix in `withFileLockSync`

- `src/state/locks.ts`: use separate `.lock` sidecar instead of the file path itself. Previously `withFileLockSync(path)` used `path` as the lock file, colliding with append/read operations on the same path.

### Tests

- 2282 tests pass / 0 failures (`npm test`).

## [0.5.7] — 11 Issue Fixes Across 5 Phases (2026-06-01)

### Phase 1: Schema/Type Fixes

- **`invalidate` schema divergence** (Critical) — `src/schema/team-tool-schema.ts`: added `"invalidate"` to TypeBox union. Previously TS interface had it but TypeBox schema did not, causing silent `-32602` failure.
- **OTLP header key validation** (Low) — `src/config/config.ts`: hardened `parseOtlpConfig` with case-insensitive check for 12 dangerous keys (`__proto__`, `hasOwnProperty`, `toString`, etc.) and format validation `/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/`.

### Phase 2: Security Hardening

- **OTLP endpoint unsanitized** (Critical) — `src/config/config.ts`: project config can no longer override `otlp.endpoint` (would have allowed credential exfiltration via attacker URL).
- **Wildcard env leakage** (High) — `src/runtime/child-pi.ts`: replaced broad wildcards (`LC_*`, `XDG_*`, `NVM_*`, `NODE_*`, `npm_*`) with specific names. Previously `NPM_TOKEN`, `NODE_ENV=production`, `NVM_RC_VERSION` all leaked.

### Phase 3: Correctness Fixes

- **AbortSignal not propagated** (High) — `src/runtime/task-runner.ts`: check signal before `persistSingleTaskUpdate`. Cancelled tasks now return early with cancelled status instead of writing stale state.
- **MAILBOX_ARCHIVE_THRESHOLD 10MB/task** (High) — `src/state/mailbox.ts` + `src/config/defaults.ts`: added `DEFAULT_MAILBOX.maxArchivesPerDirection=10` cap and `pruneOldMailboxArchives()` to prevent unbounded growth (1GB+ for 100 tasks).
- **`safeRm` regex bypass** (Medium) — `src/tools/safe-bash.ts`: stricter regex requires path to be exactly `tmp/`, `cache/`, `node_modules/`, `dist/`, or `build/` with optional `./` prefix. Rejects path traversal like `./../../../etc`.
- **`writeEntries` silent drop** (Medium) — `src/state/active-run-registry.ts`: emit `logInternalError` warning when entries overflow cap.

### Phase 4: Performance Optimization

- **`nextAgentEventSeq` O(n) cold cache** (Medium) — `src/runtime/crew-agent-records.ts`: added `.seq` sidecar file for O(1) lookup. Fall back to O(n) scan only when sidecar is missing.
- **`nextSequence` O(n) cold cache** (Medium) — `src/state/event-log.ts`: trust sidecar seq file when present. Fall back to `scanSequence` only when sidecar missing or file shrunk.

### Phase 5: Deferred (Low severity)

- **Issue #12: `acquireLockWithRetry` race** — defer (race window small, retry loop handles).
- **Issue #13: `loadRunManifestById` TOCTOU** — defer (cache TTL 30s, race window small).
- **Issue #14: `cleanupOldArtifacts` N stat calls** — defer (typical artifact dirs small).
- **Issue #15: `validateMailbox` full load** — defer (10MB cap, bounded).
- **Issue #16: `updateMailboxMessageReply` full rewrite** — defer (10MB cap, bounded).

### Tests

- 2282 tests pass / 0 failures (`npm test`).
- New tests: `invalidate`/`anchor`/`auto-summarize`/`auto_boomerang` schema, OTLP header key validation, OTLP endpoint sanitization, wildcard env leakage, sidecar seq lookup.

## [0.5.6] — Documentation Sync + Type-Only Import Fix (2026-06-01)

### Documentation

- **README.md** — Bumped to v0.5.6, refreshed security highlights section listing the 8 round-13 fixes.
- **CHANGELOG.md** — Added the v0.5.5 entry covering all 13 rounds of code review hardening (this entry).
- **SECURITY-ISSUES.md** — Bumped to v2.0, added v0.5.5 round-13 findings table (8 new issues closed).
- **docs/architecture.md** — Cross-references v0.5.5 and `docs/pi-crew-v0.5.5-audit-fix-plan.md`.
- **docs/migration-v0.4-v0.5.md** — Added v0.5.5 highlights (no breaking changes; drop-in replacement).

### Fixes

- **Type-only import** — `src/extension/team-tool/anchor.ts` now uses `import type { HandoffSummary }` from `handoff-manager.ts` directly, instead of pulling a value-style import through `anchor-manager.ts`. Fixes a `--experimental-strip-types` failure (`SyntaxError: The requested module does not provide an export named 'HandoffSummary'`) surfaced by `npm run typecheck` after the v0.5.5 docs bump.

### Tests

- 2273 tests pass / 0 failures (`npm test`).
- `tsc --noEmit` and the strip-types import smoke test both pass.
- `test/unit/discovery.test.ts` and `test/unit/implementation-fanout.test.ts` already updated in v0.5.5 to match the new workflow count (8) and the adaptive step layout (`["assess"]`).

## [0.5.5] — 13 Rounds of Code Review Hardening (2026-06-01)

### Security

- **ReDoS removed** in `src/utils/redaction.ts` — replaced 4 regex patterns with linear-time `isSecretKey()` / `redactAuthHeader()` / `redactBearerTokens()` / `redactInlineSecrets()` functions. Eliminates catastrophic backtracking on crafted input.
- **v8.deserialize RCE closed** — `BINARY_MAGIC = "PICREW2BIN"` header guards every `v8.deserialize()` call in `src/state/active-run-registry.ts`; untrusted cache files can no longer trigger heap prototype pollution.
- **Cache index race fixed** — `src/state/run-cache.ts` now wraps index reads in `withFileLockSync` and uses atomic rename for cleanup, eliminating read-modify-write corruption under concurrent load.
- **manifestCache race fixed** — `src/state/state-store.ts` wraps all read-modify-write paths on the manifest cache with a `withCacheLock()` helper.
- **Shell injection prevented** — `src/tools/safe-bash.ts` no longer matches with ReDoS-prone regex; new `matchesDangerousRm()` is linear-time. `src/benchmark/benchmark-runner.ts` blocks shell metacharacters in `validateCommand()`.
- **TOCTOU races closed** — `src/state/crew-init.ts` uses atomic `mkdirSync`; `src/state/active-run-registry.ts` validates binary contents before `v8.deserialize`.
- **Inline secret detection** — `token=`, `apikey=`, `api_key=`, `password=`, `secret=`, `credential=`, `authorization=`, `privatekey=`, `private_key=` patterns redacted at event/mailbox/artifact boundaries.
- **Pre-aborted signal logging** — `src/extension/registration/subagent-tools.ts` no longer dumps unredacted params to stderr on pre-abort.

### Performance & Memory

- **Anchor memory cap** — `src/runtime/anchor-manager.ts` adds `MAX_HANDOFFS_PER_ANCHOR=100` to prevent unbounded growth; pairs with existing `MAX_ANCHORS=50`.
- **BudgetTracker dispose()** — `src/runtime/budget-tracker.ts` gains a `dispose()` method to clear timers and listeners.
- **Live-agent pending cap** — `MAX_PENDING_MESSAGES=1000` in `live-agent-manager.ts`; `MAX_PENDING_STEERS=100` in `team-tool.ts`.
- **Mailbox delivery cap** — `MAX_DELIVERY_MESSAGES=10000` in `src/state/mailbox.ts` with FIFO pruning in `writeDeliveryState()`.
- **Feedback-loop cap** — `MAX_RUNS=1000` in `src/benchmark/feedback-loop.ts` to prevent memory leak.
- **Async-notifier debounce** — `LIST_RUNS_DEBOUNCE_MS=30_000` cache in `src/extension/async-notifier.ts` avoids per-tick `listRuns()` calls.
- **BM25 hot-loop** — `src/utils/bm25-search.ts` `df()` and `tf()` use `indexOf()` instead of regex.
- **TTL eviction** — notification-router seen Map, transcript-cache (7 days), handoff anchors, manifest cache (30 s) all gain TTL or LRU eviction.
- **SSE parser bounded** — `MAX_DATA_SIZE=100KB` in `src/utils/sse-parser.ts`.
- **Handoff size cap** — `MAX_HANDOFF_ENTRY_SIZE` in `chain-runner.ts` to prevent pathological payloads.

### Correctness

- **reground context** — `withEventLogLockSync` in `src/state/mailbox.ts` wraps `appendMailboxMessage()` to prevent cross-process interleaving on Windows.
- **Map mutation during iteration** — `src/runtime/handoff-manager.ts` snapshots the Map before iteration.
- **Self-dependency cycle detection** — `src/runtime/task-graph.ts` rejects self-edges in the task graph.
- **Duplicate phase check** — `src/runtime/phase-tracker.ts` rejects duplicate phase registrations.
- **Pipeline depth guard** — `src/runtime/pipeline-runner.ts` adds `maxDepth` check to prevent unbounded recursion.
- **Scheduler timer type** — `src/runtime/scheduler.ts` uses `NodeJS.Timeout | null` (not `number`) for safer cleanup.
- **OTLP header sanitization** — `src/config/config.ts` rejects CRLF in `otlp.headers`.
- **Cross-extension RPC** — `src/extension/cross-extension-rpc.ts` uses static import for ESM correctness.
- **Shell encoding validation** — `src/tools/safe-bash.ts` rejects invalid UTF-8 / null bytes.
- **Run-cache cwd in key** — `src/state/run-cache.ts` hashes `cwd` into the cache key to prevent cross-project collisions; uses atomic write.
- **worktree newline guard** — `src/worktree/cleanup.ts` checks trailing newline after truncation to avoid merge-conflict markers in cleaned paths.

### Workflows

- **Adaptive workflow fanout** — `workflows/implementation.workflow.md` uses a single `assess` step that returns `ADAPTIVE_PLAN_JSON` for the planner to choose the smallest effective crew.
- **New builtin workflows** — `parallel-research`, `research`, `review`, `pipeline`, `chain` ship in `workflows/`.
- **Test alignment** — `test/unit/discovery.test.ts` and `test/unit/implementation-fanout.test.ts` updated to match the new workflow count (8) and the adaptive step layout (`["assess"]`).

### Tests

- 2273 tests pass / 0 failures (`npm test`).
- New test files for security hardening (`test/unit/security-hardening.test.ts`), SSE parser bounds, anchor-manager handoff cap, mailbox delivery pruning, async-notifier debounce, and BINARY_MAGIC v8 guard.

### Files Touched (highlights)

- `src/utils/redaction.ts` — linear-time secret redaction (no regex)
- `src/state/active-run-registry.ts` — BINARY_MAGIC guard, async-notifier log fix
- `src/state/run-cache.ts` — file lock, atomic writes, cwd in cache key
- `src/state/state-store.ts` — manifestCache lock, TTL 30 s, hard limit
- `src/state/mailbox.ts` — delivery message cap, `withEventLogLockSync` in append
- `src/tools/safe-bash.ts` — ReDoS-free `matchesDangerousRm()`
- `src/benchmark/benchmark-runner.ts` — shell metachar blocking
- `src/runtime/anchor-manager.ts` — `MAX_HANDOFFS_PER_ANCHOR=100`
- `src/runtime/budget-tracker.ts` — `dispose()` method
- `src/runtime/live-agent-manager.ts` — `MAX_PENDING_MESSAGES=1000`
- `src/extension/team-tool.ts` — `MAX_PENDING_STEERS=100`
- `src/extension/async-notifier.ts` — `LIST_RUNS_DEBOUNCE_MS=30_000`
- `src/extension/registration/subagent-tools.ts` — pre-aborted signal log scrub
- `src/utils/bm25-search.ts` — `indexOf()` over regex in `df()` / `tf()`
- `src/utils/sse-parser.ts` — `MAX_DATA_SIZE=100KB`
- `src/utils/env-filter.ts` — isSecretKey-based glob boundary check
- `src/utils/scan-cache.ts` — TTL eviction
- `src/benchmark/feedback-loop.ts` — `MAX_RUNS=1000`
- `src/state/crew-init.ts` — atomic `mkdirSync` (no TOCTOU)
- `src/runtime/child-pi.ts` — uses `isSecretKey` import
- `src/extension/cross-extension-rpc.ts` — static ESM import
- `src/worktree/cleanup.ts` — trailing newline guard
- `src/runtime/scheduler.ts` — `NodeJS.Timeout | null` typing
- `src/runtime/phase-tracker.ts` — duplicate phase check
- `src/runtime/task-graph.ts` — self-dependency cycle detection
- `src/runtime/pipeline-runner.ts` — `maxDepth` recursion guard
- `src/observability/event-bus.ts` — `dispose()` method
- `src/observability/notification-router.ts` — TTL eviction for `seen` Map
- `src/state/event-log.ts` — async-queue cleanup in catch path
- `src/state/decision-ledger.ts` — `stateRoot` param in `getLedgerPath()`; `ledger.push()` instead of overwrite
- `src/extension/register.ts` — refresh-after-invalidate semantics
- `src/hooks/registry.ts` — always filter workspace
- `src/extension/team-tool/auto-summarize.ts` — clear `invalidateBuffer` on dispose
- `src/extension/team-tool/run.ts` — anchor buffer dispose path
- `src/ui/transcript-cache.ts` — 7-day TTL eviction
- `src/ui/powerbar-publisher.ts` — clear `invalidateBuffer` on dispose

### Audit Reference

The full prioritized fix plan (8+ critical issues) is captured in
`docs/pi-crew-v0.5.5-audit-fix-plan.md` (synthesized from security+concurrency,
correctness+error-handling, and performance+architecture audits across 77 source files).

## [0.5.4] — pi v0.77.0 Integration (2026-05-29)

### New Features

**subscribe() API Integration**
- Created `ProgressTracker` class for real-time agent session monitoring
- Created `EventBus` singleton for cross-component event communication
- Replaced file-based progress tracking with event-based tracking
- 4 new tests for progress tracking functionality

**session_shutdown Handler**
- Created `crew-cleanup.ts` extension for graceful shutdown
- Added `ChildProcessRegistry` to track and cleanup child processes
- Registered handlers for SIGTERM/SIGHUP signals
- Cleanup now properly kills all child-pi processes on shutdown

**excludeTools for Role-Based Restrictions**
- Created `role-tools.ts` with configurations for 8 agent roles
- Explorer: read-only (excludes bash, edit, write)
- Security Reviewer: strictest restrictions (excludes all write/exec)
- Applied via `--tools` and `--exclude-tools` CLI flags to child processes

### Dependencies
- Updated `@earendil-works/pi-*` packages from `^0.75.5` to `^0.77.0`

### Files Added
- `src/types/new-api-types.ts` - Type imports and guards
- `src/observability/event-bus.ts` - EventBus singleton
- `src/runtime/progress-tracker.ts` - ProgressTracker class
- `src/extension/crew-cleanup.ts` - Cleanup handlers
- `src/config/role-tools.ts` - Role tool configurations
- 4 new test files

## [0.5.3] — Deep Review Fixes + Security Hardening (2026-05-29)

### Security Fixes
- **C1**: Fixed credential exposure - removed dangerous wildcards `*_API_KEY`, `*_TOKEN`, `*_SECRET` from env allowlist
- **C2**: Fixed mock mode bypass - now requires `PI_CREW_ALLOW_MOCK=1` alongside `PI_TEAMS_MOCK_CHILD_PI`
- **C3**: Worktree hooks Windows hardening - safer execution for Git hooks on Windows

### Data Integrity Fixes
- **C4**: Fixed duplicate `error` key + Promise type mismatch in task-runner.ts
- **C5**: Fixed decision ledger truncation - `overrideLastEntry()` preserves all entries during promote/decay

### Reliability Fixes
- **H2**: Race condition in foreground interrupt - added file locking mechanism
- **H3**: Terminal events now bypass buffer - crash events logged immediately
- **H5**: File descriptor leak - background runner properly closes log file descriptors
- **H9**: Stale cache TTL reduced from 5min to 30s

### TypeScript Fixes
- Fixed 7+ source errors (duplicate error keys, missing properties)
- Fixed 20+ test errors (type mismatches, missing imports)
- All files now compile without errors

### Skill System Improvements
- All 35 skills now have `triggers:` frontmatter field
- Added Enforcement sections to skills for better gate validation
- Improved consistency in section naming

### Documentation
- Added `docs/migration-v0.4-v0.5.md` - comprehensive migration guide
- Updated `docs/deep-review-report.md` - complete issue tracking

### Dependencies
- Added `ajv` dependency for JSON schema validation

## [0.5.2] — ECC Implementation + Critical Bug Fixes (2026-05-27)

### ECC-Inspired Features
- **12-Layer Diagnostic**: Extended diagnostic export from 7 to 12 layers including taskDiagnostics, terminalEvidence, modelAttempts, pendingMailbox, recoveryLedger
- **Recursive Decision Ledger**: Full rollout tracking with coherence marks (matchesPrior, matchesRecursive, promotionAllowed) in JSONL format with 10 unit tests
- **Verify-skill Script**: `scripts/verify-skill.ts` and `scripts/check-all-skills.ts` to validate skill RED/GREEN gates and anti-patterns (15 unit tests)
- **Schedule Wiring**: `team action='schedule'` with cron/interval/once support; `team action='scheduled'` to list jobs; scheduler wired into handlers via global symbol
- **Plan Orchestrate**: `team action='orchestrate'` with tag-based plan parsing (`<!-- tag: design -->`, etc.) and TAG→chain mapping
- **Hook System**: `src/state/hook-integrations.ts` and `src/state/hook-instinct-bridge.ts` for extensibility
- **Feedback Loop**: `src/benchmark/feedback-loop.ts` for agent evaluation
- **Agent Eval Framework**: Extended `benchmark-runner.ts` with BenchmarkMetrics, aggregateBenchmarkMetrics(), pass rates, and cost tracking
- **Project Detector**: `src/utils/project-detector.ts` for project-aware decisions

### Critical Bug Fixes
- **crew-init.ts**: Rewrote to be completely self-contained (no paths.ts imports) to fix child-process crash `TypeError: Cannot read properties of undefined (reading 'projectCrewRoot')`
- **task-runner.ts**: Fixed needs_attention output by ensuring live-session stdout is captured as resultArtifact
- **team-runner.ts**: Fixed zombie agent detection to trust running agents and require activity evidence for queued agents
- **register.ts**: Fixed schedule wiring (sessionId resolution order, global symbol registration)
- **decision-ledger.ts**: Fixed promoteCandidate/decayCandidate to return correctly overridden coherence marks
- **verify-skill.ts**: Fixed decision matrix parsing, warning detection regex, duplicate indexOf bug, removed unused readline import
- **plan-orchestrate.ts**: Fixed heading extraction (global regex to find last heading), word-boundary matching for implicit tags
- **team-tool-schema.ts**: Added missing cron/interval/once fields and scheduled action case

### Tests
- All 1894 tests passing (0 failures)
- Test fixes: crew-widget (shows running agents), foreground-nonblocking (mock), lazy-agent-materialization (skipped design limitation)
- Test:new and test:changed scripts added

## [0.5.1] — Integration + End-to-End Tests (2026-05-26)

### Integration
- **team-tool.ts**: Wire P1-P6 into switch statement
  - `action='graph'` — load/save/list run graphs
  - `action='onboard'` — team onboarding generator  
  - `action='explain'` — task explain context
  - `action='cache'` — run result caching lookup
  - `action='checkpoint'` — checkpoint retrieval
  - `action='search'` — BM25 ranked agent/team search
- **team-tool-schema.ts**: Add 6 new actions to schema
- **Type fixes**: run-graph.ts, run-cache.ts, checkpoint.ts, team-onboard.ts
- **P0 .gitignore**: ensureCrewDirectory auto-updates .gitignore

### Tests
- 8/8 new action tests pass
- 10/10 end-to-end feature tests pass
- All 1796 unit + 45 integration passing
- CI: Ubuntu/macOS/Windows all passing

---

## [0.5.0]

### New Features: P0-P6 from Understand-Anything Research

#### P0: Auto-Setup .crew Directory
- `ensureCrewDirectory()` creates full directory structure on first run
- `gitignore-manager.ts` auto-updates `.gitignore` with `.crew/` entries
- Creates: `state/runs`, `state/subagents`, `artifacts`, `cache`, `graphs`, `audit`
- README.md explains `.crew` directory purpose

#### P1: BM25 Agent/Team Search
- `BM25Search` class with configurable k1/b parameters
- `searchAgents(query)` — ranked agent search by name/description/skills
- `searchTeams(query)` — ranked team search by name/description/roles

#### P2: Team Onboarding Generator
- `buildTeamOnboarding()` generates markdown from run history
- Shows: past runs, stats, usage examples, available teams
- `loadRunSummaries()` helper for run history loading

#### P3: Task Explain Context
- `handleExplain(runId, taskId)` — full run or individual task explanation
- `buildTaskExplainContext()` — causal chain, layers, files produced
- `formatTaskExplain()` — markdown output with why/what/connections

#### P4: Unified Run Graph
- `buildRunGraph()` — consolidates manifest + tasks into single graph
- `saveRunGraph()` / `loadRunGraph()` — persist to `.crew/graphs/`
- `listRunGraphs()` — enumerate archived graphs

#### P5: Run Result Caching
- `computeRunCacheKey()` — SHA-256 hash of goal+team+workflow
- `getCachedRun()` / `saveRunToCache()` — TTL-based cache (default 1h)
- `clearCache()` / `getCacheStats()` — cache management

#### P6: Agent Checkpointing
- `FileCheckpointStore` — checkpoints in `.crew/state/runs/<runId>/checkpoints/`
- `saveCheckpoint()` / `loadCheckpoint()` / `clearCheckpoint()`
- `hasCheckpoint()` / `listCheckpoints()` for recovery

### Tests
- 56 new unit tests (all passing)
- Total: 1796 unit tests + 45 integration tests passing

### Bug Fixes
- Worktree test teardown: clean `.crew/` before git checks for clean repository

---

## [0.4.0] — 9arm-skills Enforcement Patterns & Integration Tests (2026-05-26)

### Features
- **systematic-debugging: Refuse Gate** — Hard constraints before proposing fixes. Must verify repro exists, root cause known, and hypothesis falsified before any fix.
- **systematic-debugging: Recite Ritual** — Psychological anchor at session start. Recite 4-step mantra before beginning any debug session.
- **systematic-debugging: Falsify-First** — Phase 3 now requires disproof before proof. Run disproof experiments first to save time on wrong hypotheses.
- **systematic-debugging: Breadcrumb Ledger** — Structured experiment tracking within debug sessions.
- **multi-perspective-review: Simpler Alternative Pass** — Mandatory pre-review step to question if the change should exist at all.
- **New skill: scrutinize** — Outsider-perspective review questioning intent before tracing code.
- **New skill: post-mortem** — Engineering RCA documentation with 4 required inputs gate.
- **skills/REFERENCE.md** — New documentation of skill chains, inventory, and anti-patterns.
- **Trigger conditions** added to all major skill descriptions for better skill invocation matching.

### Bug Fixes
- **CI reliability** — Fixed flaky tests on macOS: crew-widget and render-scheduler timing issues resolved.
- **Team-context import detection** — Fixed regex to correctly match only direct `/team-tool.ts` imports, not `/team-tool/context.ts`.

### Tests
- **New test-integration-check.ts** — Integration tests for core pi-crew functionality (agent/team/workflow discovery, fast-fix team run).
- **1740 tests passing** across all platforms (Ubuntu, macOS, Windows).

---

## [0.3.8] — Zombie Run Auto-Repair & Test Stability (2026-05-25)

### Features
- **Periodic auto-repair timer** — `autoRepairIntervalMs` in `CrewReliabilityConfig` (default 60s, 0 to disable) calls `reconcileAllStaleRuns` via `configureObservability`. Timer uses `.unref()` to avoid blocking Node exit; cleaned up on session shutdown.
- **`wait` action** — New `team action='wait'` polls a running team until completion. Accepts `runId` (required), `config.timeoutMs` (default 300 000 ms), and `config.pollIntervalMs` (default 2 000 ms). Returns run status, summary, and per-task statuses. Resolves via `waitForRun` in `run-tracker.ts`.

### Bug Fixes
- **No-PID zombie run repair** — Runs without async PID (e.g. live-session /tmp workspaces) previously waited 24h for repair. Now `stale-reconciler` checks if ALL running tasks have heartbeats stale >5min (`NO_PID_HEARTBEAT_STALE_MS`) and repairs immediately.
- **Orphaned /tmp workspace cleanup** — `reconcileOrphanedTempWorkspaces()` scans `/tmp/pi-crew-*` for stale `running` manifests and auto-cancels them. Runs every 5min alongside per-CWD reconciliation.
- **Live-session test hang at depth > 0** — `runtime-policy.ts` now skips child-process override when `PI_CREW_MOCK_LIVE_SESSION='success'`, preventing tests from spawning real pi processes that hung indefinitely.

### Tests
- New `test/unit/auto-repair-timer.test.ts` (5 test cases for zombie reconciliation).
- New `test/fixtures/test-tempdir.ts` — tracks temp dirs with `test.after()` cleanup.
- Updated `live-session-context.test.ts` and `live-session-runtime.test.ts` to use tracked temp dirs and `PI_CREW_DEPTH=0`.
- Updated `stale-reconciler.test.ts` for new reconciliation paths.

## [0.3.0] — Phase 3a+3b: Discovery Cache, Dynamic Agent Registry, Rich TUI Rendering (2026-05-23)

### Phase 3a: Agent Discovery Cache
- **500ms TTL cache** with max 32 entries and per-cwd invalidation
- **FIFO eviction** when cache is full
- Cache pruned on every `discoverAgents()` call
- `invalidateAgentDiscoveryCache(cwd?)` exposed for explicit invalidation

### Phase 3b: Dynamic Agent Registry
- **`registerDynamicAgent(config)`** — runtime agent registration with cache invalidation
- **`unregisterDynamicAgent(name)`** — throws on missing agent
- **`listDynamicAgents()`** — returns all registered dynamic agents
- Dynamic agents get **highest priority** over discovered agents (security: project < builtin < user < dynamic)
- **CrewRegistry v2** — extended from v1 with `registerAgent`/`unregisterAgent`/`listDynamicAgents`
- Factory `installCrewGlobalRegistry()` for clean initialization

### Rich TUI Tool Rendering
- **New `src/ui/tool-render.ts`** (304 lines) — shared rendering module ported from pi-subagent4
- **`renderTeamToolCall`** — collapsed: `team action='run' (default) "goal preview"` / expanded: header + goal streaming
- **`renderAgentToolCall`** — collapsed: `Agent explorer "prompt preview"` / expanded: header + prompt
- **`renderTeamToolResult`** — `[status] goal text` for run actions / compact info for others
- **`renderAgentToolResult`** — status icons (⟳○✓✗) + output lines for agent results
- **`renderAgentProgress`** — icon + header + tool log + context gauge + usage line (↑↓RW$ctx)
- Helpers: `formatTokens`, `formatDuration`, `formatContextUsage`, `truncLine`, `formatToolPreview`
- All tools use **`@mariozechner/pi-tui`** Components (Container, Text, Spacer) directly
- `renderCall`/`renderResult` added to: `team`, `Agent` tools

### Tests
- **1662 tests pass** (1652 unit + 46 integration + 4 new)
- New test suites: `agent-discovery-cache.test.ts` (10 tests), `tool-render.test.ts` (10 tests)
- Bug fix: `allAgents` priority corrected (discovery: project < builtin < user; dynamic separate/highest)

## [0.2.21] — 3 Bugs Fixed — Background Runner, Child-pi stdin, Phantom Runs (2026-05-22)

## [0.2.25] — CI Fixes & needs_attention Terminal Status (2026-05-22)

### Bug Fixes
- **needs_attention as valid terminal status** — DAG scheduler now treats `needs_attention` as terminal (like `completed`). This fixes infinite retry loops when tasks complete without calling `submit_result`.
- **TypeScript compilation errors** — Fixed duplicate `loadRunManifestById` imports and added missing `persistSingleTaskUpdate` import in `live-executor.ts`.
- **Test assertions updated** — 6 test files now accept `needs_attention` as valid terminal status for mock tests.
- **LAZY markers for dynamic imports** — Added proper `// LAZY:` comments for `check-lazy-imports` script compliance.
- **Memory limit flag handling** — Updated `async-runner.test.ts` to handle `--max-old-space-size=512` in command args.

### Tests
- All 1655 tests pass (1609 unit + 46 integration).
- CI passes on all 3 platforms (ubuntu/macos/windows).

## 0.2.20 — 14 Bugs Fixed — needs_attention, Heartbeat, OOM, API Keys (2026-05-20)

### Features

- **needs_attention terminal task status** — Tasks that complete without calling `submit_result` now get `activityState: needs_attention` instead of `completed`. Workflow phases advance on either `completed` or `needs_attention`.
- **3-layer OOM protection for background runs** — `node --max-old-space-size=512` prevents Node OOM kills; heartbeat + `pid_dead` stale detection catches zombie workers; `SIGTERM`/`SIGINT`/`SIGUSR2` handlers log `async.failed` for diagnosis.
- **Essential env vars preserved for child processes** — `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL` now passed to child Pi workers.
- **Model API key allow-list** — `MINIMAX_API_KEY` and other model keys are preserved in child process env.
- **Async notifier stale-ctx guard** — `isCurrent` flag prevents stale session notifications from corrupting active run state.

### Bug Fixes

- **Bug #1/2: 429 → stale heartbeat misclassification** — MiniMax `provider_error` with 429 status retried with fallback chain.
- **Bug #3: background.log silent on error** — Captures all stderr/exit output.
- **Bug #4: worker-startup.ts missing rate_limited** — `error.classification = "rate_limited"` added.
- **Bug #5: stale notifications after prune** — Heartbeat checked before declaring `pid_dead`.
- **Bug #6: concurrent tool calls cancel foreground runs** — Confirmed as design constraint.
- **Bug #7: async notifier stale-ctx dies** — `isCurrent` guard added.
- **Bug #8/10: MINIMAX_API_KEY filtered** — Added to env allow-list.
- **Bug #9: executor yield limit → needs_attention** — `noYield` path sets `activityState: needs_attention`.
- **Bug #11: background spawn ENOENT** — `resolveScriptPath` handles `node_modules` hoisting.
- **Bug #12: essential env stripped** — `PATH/HOME/USER/LANG/LC_ALL` preserved.
- **Bug #13: background runner dies at ~59s** — 3-layer OOM protection.
- **Bug #14: infinite retry loop** — `needs_attention` gets `queue: "done"` in task graph scheduler.

### Tests

- Added `test/unit/needs-attention-status.test.ts` (9 cases for contracts, transitions, agent-control idle detection).

## 0.2.3 — Bug Fixes & Hardening (2026-05-12)

### Security

- **[MEDIUM] Event log append concurrency** — `appendFileSync` on Windows is not atomic; concurrent parent + background-runner writes could interleave JSONL lines. Fix: cross-process `withEventLogLockSync` using atomic `mkdirSync` + stale-lock detection via owner PID.
- **[MEDIUM] Subagent path traversal** — `persistedSubagentPath(cwd, id)` did not validate `id` before joining into a file path. Fix: `isValidSubagentId` regex guard (`^[a-z0-9_]+$`, max 128 chars).
- **[LOW] PEM redaction unbounded scan** — `PEM_PRIVATE_KEY_PATTERN` used `\s\S]*?` without length limit, causing full-file scan on truncated input. Fix: capped to 65,536 characters.
- **[LOW] Sleep utility `require()` in ESM** — `sleep.ts` used `require("node:child_process")` inside an ES module. Fix: top-level ESM `import { execFileSync }`.

### Correctness

- **Async lock fail-fast** — `acquireLockWithRetryAsync` previously waited the full deadline (~60 s) when an active (non-stale) lock existed. Fix: throw immediately, matching sync behavior.
- **Atomic-write sync parity** — Async `atomicWriteFileAsync` had a "matches" fallback (read existing, compare content) for race conditions; sync path lacked it. Fix: added identical fallback to sync.
- **Sequence cache leak** — `sequenceCache` was an unbounded Map. Fix: `MAX_SEQUENCE_CACHE_ENTRIES = 256` with oldest-entry eviction.
- **Iteration hooks / post-checks env inconsistency** — `runSetupHook` used `sanitizeEnvSecrets(..., { allowList })` but `runIterationHook` and `runPostCheck` used hard-coded env whitelists. Fix: unified all three to `sanitizeEnvSecrets` with the same allow-list (includes Windows vars: `USERPROFILE`, `TEMP`, `ComSpec`, `SystemRoot`).
- **Worktree error parsing locale-dependent** — `git worktree add` error messages parsed with English regexes but `git()` helper did not force locale. Fix: `LANG: "C"`, `LC_ALL: "C"` injected into all `git()` calls in `worktree-manager.ts` and `cleanup.ts`.
- **Event log lock stale-detect** — `withEventLogLockSync` previously had no stale-lock recovery and always `rmdirSync`ed in `finally` even when lock was never acquired. Fix: PID-based stale detection + conditional cleanup only on `acquired=true`.

### Portability

- **Windows `.cmd/.bat` spawn safety** — Node ≥ 20 CVE-2024-27980 blocks direct `.cmd/.bat` spawn. Fix: `.cmd`/`.bat` scripts on Windows now run via `cmd.exe /d /s /c scriptPath`.
- **Git Bash fallback on Windows** — `resolveShellForScript` now prefers Git Bash (`bash.exe` from `Git\bin`) when available, falling back to PowerShell/cmd only when absent.
- **Jiti loader resolution for hoisted installs** — `resolveJitiRegisterPath` used hard-coded `../../` candidates that failed when pi-crew was installed via local path or in a hoisted monorepo. Fix: ancestor walk upward from `packageRoot` plus fallback candidates `register.mjs` and `dist/register.mjs`.

### Tests

- Added `test/unit/worktree-manager.test.ts` (branch recovery, reuse, clean leader, file node_modules skip).
- Added `test/unit/artifact-store.test.ts` (hash integrity, path traversal, nested dirs).
- Added `test/unit/locks-race.test.ts` tests (stale lock recovery sync+async, active lock fail-fast).
- Added `test/unit/redaction-transcript-roundtrip.test.ts`.
- Added `test/unit/env-filter.test.ts` and `test/unit/resolve-shell.test.ts`.
- Added `scripts/check-lazy-imports.mjs` with `npm run check:lazy-imports` CI gate.

---

## 0.2.0 — Security & Performance Hardening

### Performance

- **Extension registration: 72% faster** — Lazy-loaded the entire runtime chain (team-tool, team-runner, runtime-resolver, etc.) from `register.ts`. Pi cold-start: 3,200ms → 780ms.
- **Commands UI: 65% faster** — Lazy-loaded RunDashboard (288ms), DurableTextViewer (658ms), and 5 overlay components that were statically imported but only used on demand.
- **Verifier: 80% faster** — 6-turn budget enforced at runtime via `maxTurns` agent config. Run-once + cache strategy (tee to `.crew/cache/`) eliminates repeated 3-minute test suite runs. Typical verifier runtime: 40+ min → ~8 min.
- **Transcript viewer: lazy-loaded** — DurableTranscriptViewer (658ms) only loaded when user runs `/crew transcript`.

### Security

- **[HIGH] Path traversal in `handleImport`** — Bundle paths were accepted without containment validation. Arbitrary file read was possible via absolute paths. Fix: `isContained` check validates paths stay within `cwd`, `userCrewRoot`, or `projectCrewRoot`.
- **[HIGH] Env variable leak in hooks** — Iteration hooks and post-checks passed the full `process.env` to user bash scripts, exposing API keys and tokens. Fix: minimal env with only `PATH`, `HOME`, `USER`, `LANG`.
- **[HIGH] Ownership check on `handleForget`** — The most destructive action (recursive `fs.rmSync`) had no session ownership guard. Any Pi session could delete any other session's run data. Fix: `foreignRun` guard matching `handleCancel`/`handleRetry`.
- **[MEDIUM] TOCTOU on Windows `O_NOFOLLOW=0`** — On Windows where `O_NOFOLLOW` is unsupported (0), a symlink race between validation and write was possible. Fix: post-open `fstat`/`fstatSync` verification in both sync and async atomic-write paths.
- **[MEDIUM] Ownership check on `handleCleanup`** — Worktree cleanup had no cross-session guard. Any session could clean up another session's worktrees. Fix: `foreignRun` guard added.
- **[MEDIUM] `handleForget` scope detection** — Used `startsWith(userCrewRoot())` which could false-match `pi-crew-evil` against `pi-crew`. Fix: `startsWith(userCrewRoot() + path.sep)`.
- **[MEDIUM] `isSafeToPrune` always used `projectCrewRoot`** — User-scoped runs could never be pruned, causing stale data accumulation. Fix: same scope detection as `handleForget`.
- **[MEDIUM] `readJsonFile` swallowed all errors silently** — Permission denied, corrupt JSON, and other errors were silently swallowed, preventing crash recovery. Fix: `logInternalError` for non-ENOENT/ENOTDIR errors.
- **[LOW] TOCTOU in `atomic-write mkdirSync`** — Between `isSymlinkSafePath` check and `mkdirSync`, an attacker could replace a directory with a symlink. Mitigated by `O_EXCL` on subsequent file open.
- **[LOW] `handlePrune` cross-session behavior documented** — Pruning all finished runs regardless of session is intentional maintenance behavior, now documented.
- **[INFO] `handleExport` intentionally cross-session** — Read-only export deliberately allows cross-session access, documented with comment.


### Correctness

- **Ghost run accumulation** — 73 deadletter runs were stuck as `queued` forever because their temp CWD directories had been cleaned by the OS. Fix: `collectRuns` now filters by CWD existence, `pruneUserLevelRuns` auto-cleans ghost runs.
- **Double-close file descriptor in `readTailLines`** — Giant-line fallback was calling `closeSync(fd)` then falling through to `finally { closeSync(fd) }` (double close). Fix: sentinel `GiantLineFallbackError` class caught in outer `catch`.
- **Race condition in lazy-load caches** — `ui()` and `handleTeamTool()` in `commands.ts` could trigger redundant parallel imports if multiple `/crew` commands fired before cache populated. Fix: promise-deduplication pattern (`_uiCachePromise` / `_handleTeamToolPromise`).
- **`handlePrune` hook only fired for first run** — Batch pruning fired `before_cleanup` hook for only the first run. Fix: fires once with `removedRunIds` in data payload.
- **`maxTurns` parsing accepted invalid values** — `parseInt("0")` → `0` (falsy → `undefined`) was accidental; `parseInt("-1")` → `-1` (truthy → passed through). Fix: explicit `Number.isFinite(n) && n > 0` check in both parsing and runtime override.
- **`GiantLineFallbackError` sentinel string** — Using a magic string for control flow was fragile. Fix: dedicated error class.
- **Tail reader UTF-8 corruption** — Reading from middle of file could split a multibyte character at the boundary. Fix: search for first newline boundary before reading.
- **Tail reader empty result on giant line** — Single line >256KB with no newlines: `lines.shift()` removed ALL content. Fix: fallback to full file read when no newline found in tail chunk, with 2MB safety cap.
- **Stale JSDoc in hooks** — Security notes still said "full inherited environment" after minimal env change. Fix: updated to "minimal environment (PATH, HOME, USER, LANG)".
- **`readJsonFile` redundant `existsSync` check** — TOCTOU guard was redundant since `catch` handles ENOENT anyway. Fix: removed redundant check.

### Architecture

- **`maxTurns` agent frontmatter** — New `maxTurns` field in `AgentConfig` (parsed from `agents/*.md` frontmatter) enforces per-agent turn limits at runtime. Verifier uses `maxTurns: 6` for efficiency.
- **Verifier efficiency contract** — Complete rewrite of `agents/verifier.md`: 6-turn budget, run-once-cache strategy, targeted verification only, PASS/FAIL with evidence format.
- **Sensitive path detection expanded** — Added `.config/gh` (GitHub CLI tokens), `jwt.json`, `session.cookie`, `.token` to detection patterns.
- **Manifest goal sanitization** — `manifest.goal` in compaction summaries now collapsed (newlines → spaces) and truncated (500 chars) to prevent markdown injection.
- **`utils/atomic-write.ts` dead code removed** — This module had zero production imports; tests were testing the wrong (unsafe) version. Deleted; tests rewritten against `src/state/atomic-write.ts`.
- **Test coverage** — 17 new tests: `atomic-write.test.ts` (9 tests), `compaction-summary.test.ts` (8 tests, all pass).

### Research (not in package)

- `docs/research/CAVEMAN-DEEP-RESEARCH.md` — Caveman output contract patterns, role-based compression, verification framework.
- `docs/research/LIVE-SESSION-PRODUCTION-READY-PLAN.md` — 9-phase plan for live-session reliability, all phases implemented.

### Contributors

- 6 rounds of structured code review across 3 sessions
- 30+ issues found and fixed (0 CRITICAL remaining, 0 HIGH remaining)


## 0.1.51

### Fixed

- **Stale foreground spinner** — Working message/spinner now always clears when foreground run completes, even if session generation changed during the run.
- **Completed-run widget grace period (8s)** — Runs that just completed stay visible in the widget for 8 seconds so users can see results before the widget hides.

## 0.1.50

### Fixed

- **Parallel execution** — Raised default concurrency (implementation 2→4, review 2→3, research 2→3). Fixed `defaultWorkflowConcurrency()` routing bug where review/default both returned the implementation value.
- **Planner prompt** — Added explicit "MAXIMIZE PARALLELISM" instruction with examples, so planner models produce parallel phases instead of sequential.
- **20 review findings** — 6 CRITICAL (optional chaining crash, env leak, path redaction, RPC validation, hook JSON safety, temp dir security), 6 HIGH (unsafe casts, busy-wait CPU, timestamp merge guard, prompt injection delimiter, binary validation), 5 MEDIUM, 3 LOW.
- **Widget flicker** — Pinned preloaded manifests to widget component model to prevent manifestCache TTL race. Scoped snapshotCache invalidation to specific run instead of clearing all.
- **Delegation policy** — Rewritten as mandatory decision table with concrete thresholds (>3 files read or >2 files edit = must delegate). Injected into every session via system prompt.
- **ignoreMethod option** — New config to write ignore entries to `.git/info/exclude` instead of `.gitignore` (Closes #2).

## 0.1.49

### Added

- **Caveman output contracts** — Role-based output validation framework with `output-validator.ts`: regex-based format checking for explorer, executor, reviewer, verifier, security-reviewer roles. Non-blocking: validation failures emit `task.output_validation` events + set `needs_attention` but do NOT fail the task.
- **Prose compressor** — `prose-compressor.ts` compresses verbose worker output for token-sensitive contexts (role-aware compression levels).
- **Sensitive paths** — Word-boundary-aware token matching in `sensitive-paths.ts` prevents false positives (e.g. `secretary.ts` no longer flagged as `secret`).
- **Symlink-safe I/O** — Artifact and shared output paths reject traversal attempts and symlinked root escapes.
- **Output contract eval harness** — 19 unit tests covering three-arm evaluation (contract vs terse vs baseline), format compliance, token savings, regex safety (no `/g` lastIndex state leak).

### Changed

- **Delegation policy rewritten** — Replaced advisory "you should consider" text with a mandatory decision table: concrete thresholds (>3 files read OR >2 files edit = MUST delegate), explicit YES/NO cases per task type, conflict-safe task splitting rules. Injected into every session via `before_agent_start` hook.
- **Powerbar dedup** — `powerbar-publisher.ts` now skips `powerbar:update` emit when segment data is unchanged (inspired by pi-powerbar's `segmentEquals` pattern). Combined with existing 200ms coalescing for minimal unnecessary renders.
- **UI responsiveness** — `task-runner.ts` now emits `streamBridge` event immediately after `task.started`, giving the widget agent status within ~100ms instead of 2-5s (child process startup delay).
- **"spawning…" indicator** — Widget shows "spawning…" for agents < 5 seconds old with no tool activity, distinguishing from "thinking…" for long-running agents.

### Fixed

- **H1: MCP proxy fallback** — `mcp-proxy.ts` now falls back to `enableMcp: true` when `createMcpProxyTools()` returns empty, so child sessions self-discover MCP instead of losing all access.
- **H2: parallel-utils throw undefined** — `mapConcurrent` now throws the actual error instead of `throw undefined`.
- **H3: Semaphore over-release** — `release()` guard against `#current > 0` prevents over-release corruption.
- **M1: IRC tool TOCTOU** — `irc-tool.ts` wraps `sendIrcMessage`/`broadcastIrcMessage` in try-catch.
- **M2: submit-result ordering** — Builds response string before calling `onYield`, wrapped in try-catch.
- **M3: Sensitive paths false positives** — Word-boundary-aware token matching replaces substring matching.
- **M4: atomic-write sleepSync** — Added WARNING comment about blocking main thread.
- **M7: URL regex trailing punctuation** — Precise regex excludes trailing punctuation from URL matches.
- **L1: parent-guard comment** — Corrected misleading comment about `process.kill` on Windows.
- **Yield handler DRY** — Extracted `extractYieldDataFromArgs` helper, `isObjectRecord`/`isStringRecord` type guards, safe `find()` pattern.
- **Event-log-rotation TOCTOU** — `compactEventLog` re-reads file after initial read to merge concurrent appends; `readEvents` skips corrupt JSON lines.
- **Ghost agent dedup** — Fixed duplicate agent records in `crew-agent-records` after crash recovery.

### Research

- `docs/research/AGENT-EXECUTION-ARCHITECTURE.md` — Detailed comparison of 3 execution modes (oh-my-pi in-process, pi-crew child-process, pi-crew live-session).
- `docs/research/UI-RESPONSIVENESS-AUDIT.md` — Root cause analysis for 2-5s agent spawn visibility delay, 5 proposed fixes with priority matrix.
- `docs/research/DEEP-RESEARCH-PI-POWERBAR.md` — Deep analysis of pi-powerbar architecture (producer/consumer pattern, rendering, settings, comparison with pi-crew's powerbar publisher).

## 0.1.48

### Added

- **Yield-based completion contract** — Workers can call `submit_result` tool to return structured results; task-runner warns on workers that don't yield.
- **Typed event channels** — `RunEventBus` supports 5 channels (`worker:progress`, `worker:lifecycle`, `worker:stream`, `run:state`, `ui:invalidate`) with `onChannel`/`onChannelForRun` subscriptions and auto-classification.
- **Human-readable task names** — `generateTaskName()` produces AdjectiveNoun names (14,400 combinations); `displayName` field on `TeamTaskState`.
- **SubprocessToolRegistry** — Extensible tool event handling with `register`/`extractAll`/`shouldTerminate` pattern; wired into event-stream-bridge.
- **Event log rotation/compaction** — Auto-compacts event logs over 5MB/50k events, keeping last 1000 events; atomic file replacement.
- **Incremental JSONL reader** — `readLinesSince`/`readJsonlSince` for seek-based file reading; wired into `readEventsCursor` with `fromByteOffset`.

### Fixed

- Fixed `readBlob`/`readBlobMetadata` crash on missing files — now returns `undefined`.
- Fixed `readSseJson` crash on non-JSON SSE data — now skips malformed events.
- Fixed wrong value `"long_running"` → `"active_long_running"` in agent-control.
- Fixed `consecutiveFailures` type bypass — added to `CrewAgentProgress` interface.
- Fixed `streamBridge.dispose()` memory leak — now in try/finally.
- Fixed blob-store redundant ternary `typeof x === "string" ? x : x`.
- Fixed team-runner non-null assertion on potentially empty array.
- Fixed event-log silent error swallowing — now logs via `logInternalError`.
- Fixed team-tool switch case indentation.
- Removed dead code `expandIcon` in agent-management-overlay.

### Changed

- Moved 6 research .md files from repo root to `docs/research/`.
- `discoverAgents`/`discoverSkills` silent catches now log via `logInternalError`.
- `executeHook` accumulates non-blocking diagnostics instead of short-circuiting.
- `CancellationToken.heartbeat` wired into `collectRuns` and `pruneFinishedRuns`.
- `CapabilitySource` extended with `"git"` to match `ResourceSource`.

## 0.1.47

### Added

- **Typed hook lifecycle** — 8 of 9 hooks wired: `before_run_start`, `before_task_start`, `task_result`, `before_cancel`, `before_forget`, `before_cleanup`, `before_publish`, `run_recovery`. Hooks are opt-in, blocking/non-blocking, with audit events.
- **Event-first UI bus** — `RunEventBus` emits on every `appendEvent` call; dashboard, crew widget, sidebar, and snapshot cache subscribe for event-driven invalidation instead of polling.
- **Shared scan cache** — `SharedScanCache` caches manifest reads and active-run entries with TTL, mtime/size invalidation, and LRU eviction.
- **Capability inventory** — `buildCapabilityInventory()` enumerates teams, workflows, agents, and skills with stable `kind:name` IDs; supports policy disable and shadowing detection.
- **Skills in capability inventory** — `discoverSkills()` reads SKILL.md frontmatter; skills appear with kind=`skill` and source=`package`/`project`.
- **Mailbox kind-separated breakdown** — `RunUiMailbox` tracks `steerUnread`/`followUpUnread`/`responseUnread`/`messageUnread`; mailbox pane shows urgency indicators.
- **Run recovery hook** — `applyRecoveryPlan` fires `run_recovery` hook; blocked recovery emits `crew.run.recovery_blocked` event.
- **Synthetic tool cancellation evidence** — Cancelled in-flight tasks receive `tool`-level terminal evidence alongside `worker`-level.
- **CancellationToken wired into production loops** — `collectRuns` and `pruneFinishedRuns` use `CancellationToken.heartbeat(stage)` for progress diagnostics.
- **Blob artifact store** — SHA-256 content-addressed storage with metadata sidecars.
- **Run event provenance** — Event metadata includes `parentEventId`, `attemptId`, `branchId`, `causationId`, `correlationId`.
- **Control channel reservation** — `ControlReservation` before worker spawn with deterministic `controllerId`.
- **Release smoke test** — `npm run smoke:release` automates tarball install + version consistency check.
- **Width-safety tests** — Crew widget rendering verified at widths 1/40/200/empty/multiple.

### Changed

- `handleCancel`, `handleForget`, `handleCleanup`, `handlePrune`, `handleExport` converted to async for hook execution.
- `before_cancel`/`before_forget`/`before_cleanup` hooks can block their respective operations.
- `before_publish` hook fires before run export.
- `task_result` hook fires before `task.completed`/`task.failed` events.
- Dashboard, widget, and sidebar auto-invalidate on `RunEventBus` events.

## 0.1.45

### Added

- Added `/team-respond <runId> <taskId|--all> <message>` for replying to interactive/waiting tasks from slash commands.
- Added runtime-extensible run ownership metadata (`ownerSessionId`) so destructive cancellation can be guarded by session ownership.
- Added async manifest and crew-agent readers used by snapshot preloading.

### Fixed

- Fixed `respond` action to validate waiting-only tasks, write replies to task mailboxes, and reject non-waiting task responses instead of reporting false success.
- Fixed `cancel` ownership handling so runs created by another Pi session are not cancelled when `ownerSessionId` mismatches.
- Fixed `DeliveryCoordinator` to requeue payloads when active delivery callbacks throw, and to drop queued payloads from stale session generations.
- Fixed `OverflowRecoveryTracker` collisions by keying recovery state with `runId + taskId`, plus cleanup of terminal recovery states.
- Fixed stale reconciliation false positives for foreground/live no-PID runs by preserving runs with recent task heartbeat or agent progress evidence.
- Fixed UI waiting counts: snapshots, powerbar, and crew widget now include `waiting` tasks/agents where appropriate.
- Fixed team tool `cwd` override handling so valid overrides are applied consistently and invalid overrides return a clear error.
- Fixed session history pollution by only appending `crew:run-started` after a successful run with a real `runId`.
- Fixed async snapshot preload path to avoid synchronous manifest/agent reads.
- Fixed mailbox count semantics for large mailbox files by marking tail-derived counts as approximate when the file is larger than the bounded tail window.
- Fixed auto-retry freshness by reloading manifest/tasks before retry attempts and fallback task runs.

### Changed

- Wired session snapshots into `session_before_switch` logging so active runs and pending deliveries are captured before session transitions.
- Dashboard mailbox pane now indicates when counts are approximate tail-derived values.

## 0.1.43

### Added

- `/team-settings` command: view and manage all pi-crew config from Pi CLI (`list`, `get`, `set`, `unset`, `path`, `scope`).
- `addTranslations(locale, bundle)` and `listLocales()` for runtime-extensible i18n.

### Fixed

- **UI freeze crash**: replaced `setInterval` with recursive `setTimeout` in `RenderScheduler` and `HeartbeatWatcher` to prevent timer storms when renders exceed the interval.
- **Growing-file I/O bottleneck**: `safeRecentEvents`, `readMailboxCounts`, `readGroupJoinMailbox` now use tail-reading (last 32 KB) instead of reading entire `.jsonl` files that grow unbounded over long runs.
- **Snapshot cache TTL** increased from 250 ms to 500 ms, halving unnecessary I/O.
- **Heartbeat watcher memory leak**: stale keys are now cleaned after 10 minutes of inactivity instead of being held forever.
- **Dashboard crash guard**: `render()` is wrapped in `try/catch` with a fallback error display.
- **Dashboard selected-index mismatch**: reset `selected` to 0 when the selected run disappears from the manifest cache.
- **`live-run-sidebar.ts` crash**: fixed missing optional chaining on `agent.progress?.recentOutput?.at(-1)`.
- **`signatureFor` crash**: `JSON.stringify` in snapshot cache wrapped in `try/catch` with a timestamp fallback.
- **Render scheduler timer leak**: added a `disposed` guard after `schedule()` to prevent orphaned timers.
- **Render scheduler loop guard**: capped at 5 iterations per `flush()` to prevent infinite loops when `render()` re-enters `flush()`.
- **`powerbar-publisher.ts`**: replaced `.filter().length` with `.reduce()` counting to avoid temporary array allocations.

### Changed

- **i18n module hardened**: locale validated at runtime (not hardcoded union type), `currentLocale` reset on dispose, missing-key guard (`fallback[key] ?? key`), `__test__resetI18n()` helper.

## 0.1.42

### Fixed

- Reduced atomic-write rename retries from 20 to 5 and added busy-wait fallback for `Atomics.wait` to avoid event-loop stalls on Windows with aggressive file-locking.
- Applied the same `sleepSync` fallback pattern to `locks.ts` for consistent lock-acquisition resilience.
- Removed dead `findReadyTask` function in team-runner.
- Eliminated a redundant `refreshTaskGraphQueues` O(n) call per batch iteration by reusing the already-computed `taskGraphSnapshot` for ready-task selection.
- Expanded `appendTaskAttentionEvent` dedup window from 100 to 200 events and switched to a computed dedup key.

### Changed

- Extended `MUTATING_TOOLS` set in completion guard with `replace_in_file`, `insert`, `delete_files`, `create_file`, `overwrite`, and `patch`.
- Extended `MUTATING_COMMANDS` regex with `sed -i`, `tee`, `wget -O`, and `curl -o` patterns.
- Reordered bash-command mutation check so mutating patterns (`sed -i`) take priority over read-only patterns (`sed`).
- Unknown bash commands that don't match the read-only list are now treated as potentially mutating (conservative default).

### Hardened

- Replaced `timer.unref?.()` with `timer.unref()` in `SubagentManager` blocked-poll and stuck-notify timers.
- Added session-liveness guard to `notifyOperator` fallback so it won't attempt `sendFollowUp` after extension cleanup.

## 0.1.41

### Added

- Added strict-provider-friendly team tool schema shapes and config schema coverage for result delivery controls.
- Added resilient result watcher fallback polling for resource-limit watch failures and partial JSON retry handling.
- Added `runtime.completionMutationGuard` (`off`/`warn`/`fail`) with structured `task.attention` events when implementation-style workers complete without observed mutations.
- Added group-join mailbox delivery metadata, request-id dedupe, ack observability, timeout events, and dashboard/status visibility.
- Expanded `team doctor` and `team status` with schema, async/result delivery, worktree/readiness, attention, transcript, and group-join diagnostics.

### Fixed

- Recovered adaptive implementation planner output when compaction truncates the end marker but complete phase objects are still present.

## 0.1.40

### Added

- Added owner-session generation guards for background subagents, async run notifications, result watchers, and live-session callbacks so stale sessions do not receive completions.
- Added `runtime.requirePlanApproval` with approve/cancel API support to gate mutating adaptive implementation tasks behind an explicit planner artifact approval.
- Added shared secret redaction for event logs, mailbox persistence, artifacts, JSONL streams, agent records, notifications, metrics, and diagnostics.

### Changed

- Project-local agents, teams, and workflows can no longer shadow builtin or user resources with the same name.
- Project-level sensitive config such as worker execution, runtime mode, autonomy, agent overrides, worktree setup hooks, and OTLP headers is ignored with warnings unless configured in trusted user scope.

### Fixed

- Fixed lost async completion notifications after auto-compaction/session restart by continuing to track active runs across notifier restarts.
- Fixed stale background subagent wakeups after session switch/shutdown while preserving terminal results for explicit joins.
- Fixed resume bypasses in plan approval by re-gating persisted mutating adaptive tasks when approval state is missing or pending.
- Restricted plan approval and cancellation to non-read-only roles and rejected cancel/approve after the approval state is no longer pending.

## 0.1.39

### Fixed

- Made CI test execution deterministic across Node 22/macOS/Linux/Windows by running Node test files sequentially to avoid cross-file environment races.
- Fixed live-agent durable control symlink-file rejection to return an API error instead of throwing from the tool handler.
- Tightened symlink artifact security assertions so tests check leaked file contents rather than safe metadata paths.

## 0.1.38

### Added

- Added parent-session wake-up for completed background subagents so the main agent automatically joins results and continues the original task.
- Added stronger resource/parser coverage for team role metadata and workflow task-body headings.

### Changed

- Clarified the current default worker execution model and local disable controls in project guidance.
- Aligned config schema constraints for UI settings with the published package schema.

### Fixed

- Hardened subagent abort handling so stopped records are persisted and late runner completion does not regress them to completed/error.
- Fixed blocked subagent result joins, blocked duration persistence, and final wake-up after blocked runs resume to terminal status.
- Blocked path traversal through workflow shared artifacts, run ids, imported run bundles, task-scoped mailbox APIs, agent runtime files, and untrusted artifact/transcript paths; hardened reads/writes with realpath containment to prevent symlink escapes; bound live-agent control to the selected run.
- Documented actual project resource paths for `.crew/` and `.pi/teams/` layouts.

## 0.1.31

### Fixed

- Added required Agent Skills frontmatter (`name` and `description`) to built-in coding skills so Pi loads them without conflicts.
- Tightened built-in skill package coverage to require standards-compliant frontmatter.

## 0.1.30

### Added

- Added Phase 6 async hardening: jiti loader resolution/fail-fast, async startup marker files, and early background-runner exit detection.
- Added worker concurrency hard cap with explicit `limits.allowUnboundedConcurrency` opt-out and observability event.
- Added persisted model routing metadata on tasks and agent records: requested model, resolved model, fallback chain, reason, and used attempt.
- Added self-contained architecture/runtime-flow docs and five built-in coding skills.
- Added mailbox replay on resume for pending inbox messages, including task-scoped messages.
- Added task resume checkpoints and recovery for crash-after-final-stdout and crash-after-artifact-write child-process tasks.
- Added async notifier detection for quiet dead background runners with durable `async.died` events.
- Added adaptive planner repair for malformed JSON, oversized task plans, and common role aliases before blocking implementation runs.
- Added package snapshot coverage for Phase 6 docs, skills, Pi manifest entries, and the runtime `jiti` dependency.
- Added `src/subagents/*` consolidation entrypoints for child spawning, background runner commands, and subagent manager APIs.
- Split `team-tool.ts` actions into focused status, inspect, lifecycle, cancel, and plan modules while preserving public action names.
- Split `register.ts` lifecycle wiring into command, team-tool, subagent-tool, and artifact-cleanup registration modules.
- Added async restart recovery integration smoke coverage for stale background pids.
- Added explicit recursive subagent depth and read-only role spawn-denial tests.

### Changed

- Async background runs now use an explicit jiti loader path and expose startup markers for recovery/health checks.
- Active batch selection now caps excessive user concurrency by default to protect local machines.
- Resume now emits mailbox replay metadata before restarting queued work.
- Child-process tasks now persist checkpoint phases (`started`, `child-spawned`, `child-stdout-final`, `artifact-written`) during execution.
- Split `task-runner.ts` prompt/progress/state/live helpers into focused modules while keeping `runTeamTask` as the public entrypoint.
- Moved live-session access behind `src/subagents/live/*` and dynamic task-runner imports so default child-process flow does not eagerly load live runtime code.

### Fixed

- Background runner startup failures are reported earlier instead of silently leaving queued/running manifests stale.

### Release prep notes

- Suggested next release grouping: `0.1.30` for Phase 6 runtime hardening, resume recovery, model observability, docs/skills, and internal refactors.
- Gate run locally: `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
- No breaking public API changes: tool actions, slash commands, config schema, and package name remain stable.

## 0.1.29

- Republished the child worker response timeout fix as a fresh npm version.

## 0.1.28

- Fixed child-process workers being terminated after only 15 seconds of quiet provider/tool time by increasing the default response watchdog to five minutes and clarifying the timeout error message.

## 0.1.20

- Reworked the implementation workflow into an adaptive planner-led orchestration flow that decides the number, roles, and phases of subagents from the task instead of using a fixed fanout template.
- Added dynamic adaptive task injection, persisted adaptive task metadata, and resume reconstruction for planner-selected subagent steps.
- Block implementation runs when the planner does not produce a valid adaptive plan, including missing/unreadable planner artifacts and malformed/oversized plans.
- Added tests for adaptive plan parsing, dynamic batch fanout, invalid-plan blocking, writer-role support, and adaptive resume recovery.
- Hardened subagent/runtime fixes from post-0.1.19 review: env-isolated depth tests, foreground failure status updates, generic tool conflict aliases, and max_turns propagation.

## 0.1.19

- Added Claude-style `Agent`, `get_subagent_result`, and `steer_subagent` tools backed by pi-crew's durable worker runtime, plus conflict-safe `crew_agent`, `crew_agent_result`, and `crew_agent_steer` aliases.
- Added a durable subagent manager with background queueing, completion notifications, result joins, session-bound cleanup, and direct single-agent runs via `team run agent=...`.
- Disabled risky auto-opening of the right sidebar by default, added foreground completion notifications, and reduced duplicate widget/sidebar UI.
- Added progress coalescing and workflow concurrency helpers to keep foreground sessions responsive during busy worker output.
- Fixed live-session runs being classified as scaffold when workers are enabled and hardened session switch/shutdown cleanup for foreground child processes.

## 0.1.18

- Added a built-in `parallel-research` team/workflow for map-reduce style source audits with dynamic `Source/pi-*` fanout and parallel explorer shards.
- Made the live right sidebar the default foreground UI: active foreground runs auto-open a top-right live sidebar when the terminal is wide enough.
- Added live sidebar sections for active agents, waiting tasks, completed agents, task graph, model, tool, and token/usage details.
- Stopped materializing queued dependency tasks as child-process agents; status now separates active agents, waiting tasks, and completed agents.
- Added workflow-aware default concurrency so research/parallel-research can use ready parallel work instead of always running one worker.
- Dropped user/system prompt messages from child event persistence to avoid prompt/context leakage in agent event logs.
- Tightened child event compaction with separate assistant/tool input/tool result caps and improved powerbar active/waiting/model/token summaries.

## 0.1.17

- Fixed terminal/completed workers being incorrectly escalated as stale heartbeat blockers after all tasks completed.
- Cleaned child-process result extraction so result artifacts prefer final assistant output and no longer include worker prompt/context.
- Made `/team-dashboard` visibly render as a top-right sidebar by default with explicit right-sidebar title text.
- Added per-subagent model and usage fields to agent records, status output, and dashboard fallbacks so model/token totals stay visible while and after workers run.

## 0.1.16

- Added right-side `/team-dashboard` placement with model, token, and tool detail rows for subagents.
- Added UI config for dashboard placement/width and model/token/tool visibility.
- Foreground child-process runs now continue without blocking the interactive chat and remain tied to session shutdown.
- Child-process observability now drops noisy `message_update`/encrypted thinking deltas and stores compact events to prevent massive JSONL/output logs from freezing sessions.
- Cancel now syncs agent records and writes a foreground interrupt request so queued/running agents stop appearing stale.

## 0.1.15

- Child-process model selection now uses Pi-configured/available models and auto-discovers provider/model entries from Pi settings/models config.
- Added configured-model fallback chains for worker runs instead of forcing builtin provider hints.
- Fixed skipped task agent records so they no longer appear queued.

## 0.1.0

- Initial scaffold for `pi-crew`.
- Added Pi package manifest, extension entry, minimal team tool, slash commands, builtin resources, and documentation placeholders.

## [0.5.23] — Documentation & CI Update (2026-06-03)

### Highlights
- **CI typecheck re-enabled** — was disabled with stale comment about tsconfig errors
- All docs updated to v0.5.22 references

### Documentation
- README.md: version stamp v0.5.22, updated security highlights (12 items)
- SECURITY-ISSUES.md: added v0.5.17–v0.5.22 security fix summary
- SECURITY-AUDIT.md: scope updated to v0.5.22
- docs/architecture.md: v0.5.22, 38 rounds of review
- docs/pi-crew-bugs.md: v0.5.22 + historical note
- docs/TEST_MATRIX.md: test count updated to 2703
- docs/deep-review-report.md: marked historical
- docs/migration-v0.4-v0.5.md: drop-in replacement note

### CI
- `.github/workflows/ci.yml`: typecheck step re-enabled (was disabled since v0.3.x)

## [0.6.0] — Source Tour Patterns Implementation (2026-06-04)

### Highlights
- **15 patterns** implemented from 63-repo source tour (2,267 LOC)
- All patterns pass TypeScript strict mode with 0 errors
- 37 skills (including new council skill)

### Tier 1 — Quick Wins
- **Council skill** (Pattern 5): 3 adversarial roles for critical decisions
- **6 lifecycle hooks** (Pattern 12): after_run_complete, after_task_complete, session hooks
- **3-tier convention** (Pattern 13): Command→Agent→Skill documentation + effort field
- **Pre-step scripts** (Pattern 2): Deterministic scripts before LLM dispatch
- **Chain DSL parser** (Pattern 8): step1 -> parallel(step2, step3) -> step4

### Tier 2 — Medium-Term
- **DAG enhancements** (Pattern 7): findBlockedTasks, getBlockingTasks, topologicalSort
- **Drift detection** (Pattern 10): 5 detectors, 2-pass reconciliation
- **Hash-based task IDs** (Pattern 11): Base36 + adaptive length + hierarchical
- **Iterative retrieval** (Pattern 6): Score → converge → refine loop
- **Intercom bridge** (Pattern 9): Worker→orchestrator escalation queue
- **Plan templates** (Pattern 15): Built-in standard-review and full-implementation

### Tier 3 — Long-Term
- **Phase-gated intermediates** (Pattern 1): Disk-persistent step outputs
- **Incremental fingerprinting** (Pattern 3): Content hash + structural signature
- **4-tier memory** (Pattern 4): Working→Episodic→Semantic→Procedural with Ebbinghaus decay
- **Observation system** (Pattern 14): Capture→compress→re-inject with privacy tags

### Stats
- Test suite: 2698 pass + 1 skip, 0 fail
- TypeScript: 0 errors
- Skills: 37/37 PASS
- New modules: 11 files, 2,267 LOC
