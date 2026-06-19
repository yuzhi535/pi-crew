# Goal Loops (`team action='goal')

pi-crew v0.9.0 introduces an autonomous goal loop, modeled on Claude Code's `/goal`.

## What it does

A goal loop turns a single objective into a long-running, self-directed multi-turn
process:

1. A **worker** agent does one turn of work (`executeTeamRun`).
2. A separate **evaluator** model (the "goal-judge") reads the turn's transcript +
   tool calls + verification results and returns a verdict:
   `{ achieved: bool, reason: string, evidenceRefs?: string[] }`.
3. If **not achieved**, the `reason` is prepended to the next turn's prompt and the
   loop continues.
4. Stops on: `achieved` / `maxTurns` reached / `budgetAbort` exceeded / `BLOCKED:` /
   user `stop`.

## Usage

```
team action='goal', config.subAction='start',
      config.objective='Migrate src/auth from JS to TS. Done when tsc --noEmit=0 and test/auth passes.',
      config.evaluatorModel='haiku',
      config.maxTurns=20,
      budgetTotal=500000
```

Sub-actions: `start | status | pause | resume | stop | step | clear`.

Slash command: `/team-goal start --objective='...' --evaluatorModel='...'`

## Design notes (see `research-findings/goal-workflow/`)

- **One manifest per turn** — `TEAM_RUN_STATUS_TRANSITIONS` + `shouldMergeTaskUpdate`
  block re-driving a terminal manifest, so each turn is a fresh `createRunManifest`.
  The goal loop owns OUTER state in `GoalLoopState` at
  `<crewRoot>/state/goals/<goalId>.json`.
- **Feedback via `manifest.goal`** — the verdict's `reason` is composed into the next
  turn's `manifest.goal` (re-read lazily each render). `session.steer` is NOT used
  (it's a no-op for child-process runs).
- **Budget via `collectRunMetrics`** — `budgetUsed = Σ over turns of collectRunMetrics(cwd, turnRunId).totalTokens`.
  (`loadRunMetrics`/`saveRunMetrics` have 0 callers — do not use.)
- **Judge lockdown** — the synthesized `goal-judge` AgentConfig sets `disableTools:true`
  (Pi `--no-tools`), `excludeTools:[bash,read,write,edit]`, `inheritContext:false`,
  `excludeContextBash:true`, `parentContext:undefined`, `maxTurns:1`. An empty
  `tools:[]` is INSUFFICIENT because `pi-args.ts` skips empty arrays.
- **Trust boundary** — the judge is capability-locked (no agency, only emits a verdict).

## Background spawn

The loop runs in the background via `runKind:'goal-loop'` (background-runner.ts
dispatch). The handler `handleGoal('start')` writes the `GoalLoopState`; the
background process calls `runGoalLoop` which loops `executeTeamRun` per turn.

## Hooks

- `before_goal_step` — fires before each turn.
- `before_goal_abort` — fires before a budget/maxTurns abort.
