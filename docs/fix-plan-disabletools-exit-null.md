# Fix Plan — HB-003a: `ctx.agent({disableTools:true})` returns `exit null`

> **Status:** PROPOSED (planning only — not yet implemented)
> **Discovered:** 2026-06-24 real-world smoke testing (see `CHANGELOG.md` "Known issues")
> **Severity:** medium (blocks the `disableTools:true` verdict-judge pattern; workaround exists)
> **Owner:** TBD
> **Related:** HB-004 (smoke-test harness), commits `c55d3e2` + `ab481e6` (sibling bugs already fixed)

## 1. Problem statement (confirmed evidence)

`ctx.agent({disableTools: true})` (and the equivalent direct `runChildPi({agent:{disableTools:true}})`)
returns `exitCode: null` (process killed by signal) instead of `0`, **only when the
calling process exits promptly after the promise resolves.** If the caller stays alive
~10s after `runChildPi` resolves, `exitCode` comes back `0` correctly.

### Repro matrix (all verified 2026-06-24)

| Scenario | disableTools | Caller keep-alive | Result |
|---|---|---|---|
| `pi --no-tools ...` standalone | yes | n/a | ✅ exit 0, correct answer |
| `runChildPi` + keep-alive 10s | yes | yes | ✅ exitCode=0, finalDrain=true |
| `runChildPi` + exit immediately | yes | no | ❌ exitCode=null |
| `runChildPi` (has tools) | no | either | ✅ exitCode=0 |
| DWF `ctx.agent({disableTools:true})` | yes | (workflow) | ❌ exit null |

### What the lifecycle events show (failing case)

```
spawned → exit(code=null) → close(code=null)
```

**Notably ABSENT:** `final_drain`, `hard_kill`, `response_timeout` lifecycle events.
So the signal did NOT come from `child-pi.ts`'s own timers. `stdout` *does* contain
the model's answer — pi produced output, then died via signal.

## 2. Root-cause hypotheses (to confirm in Phase 0)

The killer is currently unidentified because the `signal` arg of the `exit` event is
**discarded** after building the error string (it never reaches `exitStatus` or logs).
The leading hypotheses, in priority order:

- **H1 (most likely): the final-drain timer fires SIGTERM during a race window, but
  `forcedFinalDrain` is set AFTER `child.kill()` is called — so if `exit`/`close`
  races ahead of the `forcedFinalDrain = true` assignment, the close handler sees
  `forcedFinalDrain=false` and does NOT override `null → 0`.** With `--no-tools`, pi
  emits `message_end`/`agent_end` very fast, so the 5s finalDrainTimer and the natural
  close land close together, widening the race. (The keep-alive case works because
  something about the longer-lived event loop changes the ordering — to be confirmed.)
- **H2: the child pi process self-terminates via signal** (uncaught exception → SIGABRT,
  or an extension-load crash under `--no-tools`). The presence of stdout answer argues
  against a total crash, but a late shutdown crash is possible.
- **H3: an external signal** (parent-guard, abort). Already ruled out:
  `startParentGuard` is never called in `src/` (only docstring refs); abort would set
  `abortRequested` and emit a different lifecycle event.

## 3. Phased plan

### Phase 0 — Diagnostic (READ-ONLY, no behavior change)  [~0.5 day]

Goal: identify the exact signal and the code path that sent it. **No fix yet.**

1. **Capture the signal.** In `child.on("exit", (code, signal) => ...)`, add `signal`
   to the `exitStatus` record and to the `exit` lifecycle event payload. Also capture
   `forcedFinalDrain`, `hardKilled`, `finalDrainTimer` truthiness, and a timestamp
   relative to spawn. This is the single highest-value change — it turns the bug from
   "exit null, cause unknown" into "exit null via SIGTERM at T+Xms while timer armed".
2. **Add a focused repro workflow** `.crew/workflows/debug/dwf-disabletools.dwf.ts`
   already exists — extend it to log `exitStatus` (signal, forcedFinalDrain, timing).
   Re-run until the captured data distinguishes H1 vs H2.
3. **Confirm H1 with a log-only check:** temporarily log the wall-clock time of
   `forcedFinalDrain = true` vs the `exit` event. If `exit` precedes the assignment,
   H1 is confirmed.
4. **Exit Phase 0** with a written finding (append to this file's §2): which signal,
   which path, deterministic repro steps.

**Deliverable:** amended §2 with the confirmed root cause; no commit to `main`
beyond the read-only instrumentation (kept behind a debug flag or reverted).

### Phase 1 — Fix  [~1 day]

The fix depends on Phase 0's finding. The two most likely fixes:

**Fix A (if H1 confirmed): close the `forcedFinalDrain` race.**

Today the close handler derives:
```ts
const finalExitCode = forcedFinalDrain && !timeoutError ? 0 : exitCode;
```
The race: `forcedFinalDrain` is assigned inside the timer callback *just before*
`child.kill(SIGTERM)`, but the SIGTERM can land and trigger `exit`/`close` on a
different tick before the assignment is observed (or the assignment is gated on
conditions that the race skips). 

Proposed change: **treat a signal-death (`code === null`) that occurs while the
final-drain timer is armed (or was armed and not yet cleared) as a forced final
drain.** Concretely, track `finalDrainArmed` (set true when the timer is created,
false when cleared) and in the close handler:
```ts
const treatedAsFinalDrain = forcedFinalDrain || (exitCode === null && finalDrainArmed && !responseTimeoutHit && !abortRequested);
const finalExitCode = treatedAsFinalDrain && !timeoutError ? 0 : exitCode;
```
This is surgical, localized to the close handler, and preserves the existing
override semantics. Add a `logInternalError` telemetry line (mirroring the existing
M6 "final-drain-zero-exit" log) so a *real* crash isn't silently hidden — the
distinction is "we had an armed final-drain timer and stdout has content" vs "no
timer, no stdout".

**Fix B (if H2 confirmed — pi self-crashes under --no-tools):** the fix is NOT in
pi-crew; escalate upstream (pi binary) and add a `child-pi` workaround that retries
once if stdout is non-empty and exit is signal-death with an armed final-drain timer.
Less likely; defer unless Phase 0 proves H1 wrong.

**Verification gate:** the repro matrix in §1 must go all-green (every ❌ row → ✅)
with `exitCode=0` and the model answer present in stdout. No regression in the
existing `test/unit/child-pi-*.test.ts` suites (5 files, ~85 tests).

### Phase 2 — Regression prevention (HB-004)  [~1 day]

Land the smoke-test harness proposed in `HB-004` so this class of bug is caught by
CI, not only by live runs. Gate behind `PI_CREW_SMOKE=1` (token cost). Minimum:
one workflow per feature family that actually shells out to real `pi`
(`agent` plain, `agent`+schema, `agent`+disableTools, `pipeline`, `phase`/`log`).
Add a CI job (manual-dispatch workflow) that runs the smoke suite on
ubuntu/windows/macos × Node 22.

## 4. Files touched (estimate)

| Phase | File | Change |
|---|---|---|
| 0 | `src/runtime/child-pi.ts` | capture `signal` + timing in `exit`/`exitStatus` (log-only) |
| 0 | `.crew/workflows/debug/dwf-disabletools.dwf.ts` | extend logging |
| 1 | `src/runtime/child-pi.ts` | Fix A: `finalDrainArmed` + close-handler override |
| 1 | `test/unit/child-pi-*.test.ts` | add race-simulation unit test (fake child emitting exit before forcedFinalDrain) |
| 2 | `test/smoke/*.dwf.ts` (new) | HB-004 harness |
| 2 | `.github/workflows/smoke.yml` (new) | manual-dispatch smoke CI |
| 1 | `CHANGELOG.md`, `docs/troubleshooting.md` | move "Known issues" entry to "Fixed"; remove workaround note |

## 5. Test plan

- **Phase 0:** before/after instrumentation output showing the captured signal.
- **Phase 1 unit:** a unit test that injects a fake child process whose `exit`
  fires with `code=null` *before* the timer callback runs, asserting `finalExitCode === 0`
  and that stdout content is preserved. This is the regression guard for the race.
- **Phase 1 real-binary (manual):** re-run the §1 repro matrix; all rows ✅.
- **Phase 1 regression:** `npm run test:unit` + `npm run test:integration` green;
  typecheck + lazy-imports clean; TABS.
- **Phase 2 CI:** smoke workflow green on all 3 OSes.

## 6. Risk analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| Fix A hides a *real* crash as a clean exit | medium | Telemetry log (`final-drain-zero-exit` style) on the override; only override when stdout is non-empty AND finalDrain timer was armed. Never override `responseTimeoutHit` or `abortRequested` paths. |
| Race fix changes behavior for the common (has-tools) path | low | The `finalDrainArmed` condition only adds to the existing `forcedFinalDrain` branch; has-tools path already sets `forcedFinalDrain=true` normally. Unit test covers both. |
| Cross-platform signal differences (Windows has no signals) | medium | Windows already uses `taskkill`/`undefined` signal semantics; Fix A keys off `exitCode === null` which is platform-consistent for signal/force-kill death. Verify on Windows CI. |
| Phase 0 instrumentation itself changes timing | low | Keep it log-only; use monotonic `performance.now()`; revert before merge if it perturbs the race. |

## 7. Out of scope

- P2-2 VM sandbox / isolated-vm (separate, v1.5).
- Refactoring the 919-line `child-pi.ts` (tempting but out of scope; surgical fix only).
- Changing the final-drain timeout constants (`FINAL_DRAIN_MS=5s`, `HARD_KILL_MS=3s`).
- The `runKind:'goal-loop'` foreground-dispatch note from smoke testing (separate item).

## 8. Open questions for Phase 0

1. Why does the keep-alive case return `exitCode=0` with `finalDrain=true` while the
   fast-exit case returns `null` with no `final_drain` event? (The unref'd timer +
   event-loop lifetime is the leading suspect — needs the timing capture to confirm.)
2. Is there a second code path (e.g. `killProcessTree` at line 657) that can fire
   before the final-drain timer under the `--no-tools` fast-exit pattern?
3. Does the prompt-runtime extension (loaded via `--extension` in the child) do
   anything on `agent_end` that could self-terminate the child?

---

**Recommendation:** execute Phase 0 first (cheap, read-only, removes all guesswork),
then pick Fix A or B based on the finding. Do NOT implement Phase 1 blind — the bug
is in core runtime and a wrong fix could mask real crashes across every agent call.
