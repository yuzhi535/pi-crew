# Subagent cold-start race — module-scoped import latch

**Date**: 2026-06-16
**Severity**: Medium (flaky, load-dependent — only under concurrent in-process subagent launch)
**Status**: FIXED (module-scoped latch in `live-session-runtime.ts`)

## Symptom

When launching multiple subagents **concurrently** via `Agent({ run_in_background: true })`,
some crash at cold-start with one of:

```
Cannot read properties of undefined (reading 'existsSync')
Cannot read properties of undefined (reading 'validateWorkflowForTeam')
```

These are **property-access-on-undefined** errors: a namespace import binding is
observed as `undefined` at the moment a function runs.

## Reproduction

Launched 4 explorer subagents at once to deep-dive the UI/UX of 4 cloned repos:

| Subagent | Repo | Result |
|---|---|---|
| `agent_mqgtcgc6_1` | pi-sub | ✅ full digest |
| `agent_mqgtcgca_2` | pi-bar | ❌ `'validateWorkflowForTeam'` |
| `agent_mqgtcgcd_3` | pi-status | ❌ `'existsSync'` |
| `agent_mqgtcgcg_4` | pi-powerline-footer | ❌ `'existsSync'` |

3 of 4 crashed. **All 3 succeeded when retried sequentially** (1 at a time) —
same code, same args, same repos; only the concurrency changed. That is the
definitive signature of a cold-start race, not a logic bug.

## Root cause

`direct-agent` subagents run **in-process** via `createAgentSession` (the
live-session runtime), sharing one Node module graph + one event loop. The
spawn path at `src/runtime/live-session-runtime.ts:401` (original) was:

```ts
const mod = await import("@earendil-works/pi-coding-agent") as unknown as LiveSessionModule;
```

Each concurrent subagent called `await import(...)` **independently**. Under the
**tsx loader** (which registers `load`/`resolve` hooks to transpile TS on the
fly), concurrent first-imports can each enter the loader and race module-record
instantiation. The result is a namespace binding (e.g. `fs`, or a named import
re-exported through `validate-resources`) observed **mid-evaluation as
`undefined`** — exactly the errors above.

ESM engines memoize dynamic imports, but that memoization is not guaranteed to
be *observed synchronously* across concurrent evaluation under transpiling
loaders. Hence an explicit JS-level latch is needed.

## Fix

Module-scoped memoization — the FIRST caller wins, every later caller awaits the
same in-flight promise. Guarantees a single module-record instantiation
regardless of loader behavior.

`src/runtime/live-session-runtime.ts`:

```ts
let liveSessionModulePromise: Promise<LiveSessionModule> | undefined;
function loadLiveSessionModule(): Promise<LiveSessionModule> {
	if (!liveSessionModulePromise) {
		liveSessionModulePromise = import("@earendil-works/pi-coding-agent")
			as unknown as Promise<LiveSessionModule>;
	}
	return liveSessionModulePromise;
}
```

Use site (was the un-memoized `await import(...)`):

```ts
const mod = await loadLiveSessionModule();
```

## Test

`test/unit/live-session-import-latch.test.ts` — regression guard (2 tests):
1. the module loads cleanly and exports `runLiveSessionTask`;
2. the latch variable + check-before-set + `loadLiveSessionModule()` use site
   are present, and the old un-memoized `await import(...) as unknown as
   LiveSessionModule` pattern is gone (checks code-only, stripping doc comments).

## Why sequential retries worked

A single subagent is the only first-importer → no race → module instantiates
cleanly. The latch makes concurrent callers behave as if they were sequential
for the import phase, then proceed in parallel as normal.

## Lessons

1. **In-process subagent runtimes share a module graph.** Any cold-path module
   load is a concurrency hazard when N subagents launch at once. Memoize/latch
   dynamic imports of heavy peer deps at module scope.
2. **`Cannot read properties of undefined (reading '<binding>')` on a module
   namespace** = a binding seen mid-evaluation before its module record
   finished instantiating. Not a TDZ error ("before initialization") — that one
   has a different message. This is the *property-access* variant, indicating a
   namespace object rather than a hoisted binding.
3. **The tsx loader is not transparent for concurrent imports.** Node's native
   ESM memoization assumes in-process V8 module records; a transpiling loader
   adds a JS-visible layer that can interleave. Don't rely on engine-level
   memoization for correctness under tsx; add an explicit latch.
4. **"Succeeded on sequential retry, failed under concurrency" is the defining
   test for a cold-start race.** When you see it, look for a shared, lazily
   initialized, concurrency-sensitive resource (module import, singleton, cache
   fill) and serialize its initialization.
