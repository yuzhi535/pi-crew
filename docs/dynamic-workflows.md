# Dynamic Workflows (`.dwf.ts`)

pi-crew v0.9.0 introduces dynamic workflows, modeled on Claude Code's Dynamic Workflows.

## What it does

A dynamic workflow is a `.dwf.ts` script whose default export orchestrates subagents
with normal JavaScript (`for`/`while`/`if`/`switch`). It runs in the background, calls
subagents per phase via `ctx.agent()` / `ctx.fanOut()`, holds intermediate results in
JS variables, and only `ctx.setResult()` reaches the main context — keeping the plan
and intermediate data out of the main context window.

```ts
// .crew/workflows/security-audit.dwf.ts
export default async function (ctx) {
  const endpoints = [/* ... */];
  const shards = chunk(endpoints, 3);
  const reports = await ctx.fanOut(shards, 3, (s) =>
    ctx.agent({ role: "explorer", prompt: `Audit ${s.join(",")} for auth + input validation` })
  );
  const synth = await ctx.agent({ role: "analyst", prompt: "Merge + dedupe findings", inputs: reports.map(r => r.artifactPath) });
  for (let i = 0; i < 3; i++) {
    const review = await ctx.review(synth.taskId, "reviewer");
    if (review.outcome === "accept") break;
    await ctx.retry(synth.taskId, { feedback: review.feedback });
  }
  ctx.setResult(synth.artifactPath, { summary: "security audit complete" });
}
```

## Usage

Place the script under `.crew/workflows/<name>.dwf.ts`, then:

```
team action='run', workflow='security-audit', goal='Audit src/routes'
```

Slash command: `/workflows` lists all workflows (static + dynamic).

## WorkflowCtx API

| Method | Purpose |
|---|---|
| `ctx.agent({role, prompt, model?, skill?, maxTurns?, inputs?})` | Spawn one agent, await `{ok, text, structured, artifactPath, usage}`. Concurrency enforced by `ctx.semaphore`. |
| `ctx.fanOut(items, limit, fn)` | Bounded parallel fan-out (wraps `mapConcurrent`). |
| `ctx.review(taskId, reviewerRole?)` | Run a reviewer; parse `{outcome, feedback}`. |
| `ctx.retry(taskId, {feedback?})` | Re-run with feedback (wraps `executeWithRetry`). |
| `ctx.mail(to, body, opts?)` | Mailbox message to another agent/leader. |
| `ctx.gatherReplies(ids, deadlineMs)` | Block until N replies arrive or deadline. |
| `ctx.renderTemplate(name, vars)` | Render a built-in plan template. |
| `ctx.vars` | Script-local variables. |
| `ctx.setResult(artifactPath, meta?)` | Mark the final result. ONLY this reaches the main context. |

`ctx.agent({role})` resolves the role to an `AgentConfig` via 4-tier precedence:
explicit `agent` name → `team.roles[].agent` → `discoverAgents` by name → synthesize
minimal (`source:'dynamic'`).

## Security model (IMPORTANT)

`.dwf.ts` files are **postinstall-equivalent trust** — treat them as `node script.js`.
The v1 boundary is **capability-locked**, NOT sandboxed:

- `WorkflowCtx` is `Object.freeze()`d and exposes ONLY the documented methods.
- The script host loads it via `vm.runInNewContext` with a minimal globals object
  (no `process`/`require`/`import` passthrough).
- A determined script can still escape via constructor walking. `isolated-vm` (real
  V8 isolate) is planned for v1.5.
- **Only place `.dwf.ts` files you have reviewed** in `.crew/workflows/`.

`workflow-create` is an arbitrary-code-execution (ACE) surface and is gated:
- Requires `confirm:true` (enforced by `destructive-gate.ts` at the tool_call layer).
- **User-initiated only** — the agent MUST NOT auto-invoke it.
- Path-allowlisted via `resolveRealContainedPath` (TOCTOU-safe, not `startsWith`).
- Content validation rejects obvious `require('child_process')`, `process.exit`,
  and network-import patterns (best-effort).

## Isolation

Worker output → artifact file (via `runChildPi` + `writeArtifact`). The dynamic runner
holds results only in JS variables + `ctx.vars`. Only `ctx.setResult(artifactPath)` is
read back into the tool result returned to the main context — mirroring the static
workflow `summary.md` contract. The orchestrator's context never holds raw worker
output.
