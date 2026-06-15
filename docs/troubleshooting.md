# Troubleshooting

Common problems and their fixes. If you hit an error code (E001–E012), see the
[Error codes](#error-codes) table below.

## Quick health check

```text
team action='doctor'
team action='health'
```

`doctor` validates your config, runtime, and worker setup. `health` shows live
run/process status. Start here.

## Runs won't start / workers are "blocked"

**Symptom:** `team action='run'` returns a `blocked` status with a message like
"Child worker execution is disabled".

**Cause:** Worker execution is off. pi-crew refuses to create no-op scaffold
subagents by default until you opt in.

**Fix — pick one:**
- Set in your config (`~/.pi/agent/pi-crew.json`): `"executeWorkers": true`
- Or set the env var: `PI_CREW_EXECUTE_WORKERS=1`
- Or pass at run time: `team action='run' config={runtime:{mode:'live-session'}}`

The blocked-run message lists the exact config + env vars in play — read it.

## "Run not found" / I lost my run ID

Run IDs are long (`team_20260615180014_a1b2c3d4e5f60718`). To recover:

```text
team action='list'              # recent runs + IDs
team action='status'            # status of in-flight runs in this project
team action='artifacts' runId=… # if you only have a partial ID
```

Every "Run not found" error now appends a `Tip: run action='list'` hint.

## "Unknown action: X"

You typo'd an action. The error now suggests the closest match
(`Did you mean 'status'?`). To see all valid actions:

```text
team action='help'
team action='list' resource='workflow'
```

## Worktree runs fail ("not a git repo" / "tree is dirty")

Worktree mode (`workspaceMode: 'worktree'`) requires:
1. The target directory is a **git repository** (`git rev-parse` succeeds).
2. The working tree is **clean** (no uncommitted changes) unless you pass
   `force: true`.

If you don't need isolation, use single mode instead:
`team action='run' workspaceMode='single'`.

## Stale async process / run stuck in "running"

A background run whose process died (crash, Ctrl+C, reboot) can appear stuck
in `running`. The stale-reconciler eventually marks it `failed`, but you can
force recovery:

```text
team action='status' runId=…    # check the async liveness line
team action='cleanup' runId=…   # repair stuck state
team action='cancel' runId=…    # cancel a truly-dead run
```

The error message explains the heartbeat mechanism + remediation.

## Model fallback exhausted

**Symptom:** `All N candidates exhausted (tried: a → b → c)`.

**Cause:** Every model in your fallback chain failed (rate limit, auth, quota).

**Fix:** Check your provider config / API keys. The error now lists the full
chain tried and the last failure reason.

## Config is malformed / ignored

If your `pi-crew.json` has a syntax or type error, `team action='run'` emits a
`config.warning` event (visible via `team action='events'`) and proceeds with
defaults — it does **not** hard-fail. To validate explicitly:

```text
team action='config'            # show loaded config + any warnings
team action='doctor'            # full validation
```

## Compact vs full status

`team action='status'` defaults to full output (~40 lines). For a quick check:

```text
team action='status' details=false   # compact: status, progress, goal, issues only
```

## Error codes

pi-crew uses a structured error taxonomy (E001–E012). Each error renders its
code + a help hint inline. Common ones:

| Code | Name | Meaning | First check |
|------|------|---------|-------------|
| E001 | FileReadError | a required file couldn't be read | check the file exists + read perms; may need `cleanup` |
| E002 | FileWriteError | an atomic write failed | check disk space + dir write perms |
| E003 | TaskNotFound | a referenced task id doesn't exist | `team status` to verify the run's tasks |
| E004 | InvalidStatusTransition | illegal run/task status change | verify status via `team status` before retrying |
| E005 | ConfigError | config has a syntax/type error | `team config` shows the offending field |
| E006 | ResourceNotFound | agent/team/workflow not found | `team list` to see available resources |
| E007 | ChildTimeout | a worker Pi didn't finish in time | raise `runtime.responseTimeoutMs` or simplify the task |
| E008 | ModelExhausted | all fallback models failed | see "Model fallback exhausted" above |
| E009 | PreStepFailed | a workflow pre-step hook failed | check the hook stderr in events; set `preStepOptional: true` on the step to make it advisory (non-fatal) |
| E010 | EventLogLockTimeout | event log locked under contention | transient; retry, or lower concurrency |
| E011 | DepthLimitExceeded | crew nesting too deep | raise `crew.maxDepth` or flatten the call |
| E012 | RunStale | run reconciled as stale | see "Stale async process" above |

## Still stuck

- `team action='explain' runId=…` — structured per-task analysis (why, files,
  complexity).
- `team action='summary' runId=…` — includes common failure-pattern detection
  ("4 of 5 failures share 2 root causes").
- `team action='events' runId=…` — full event timeline for forensics.
