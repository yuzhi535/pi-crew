# Changelog

## Unreleased

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
