# pi-crew

> Forked from [baphuongna/pi-crew](https://github.com/baphuongna/pi-crew) with bug fixes for the dynamic workflow plugin.

**Coordinate AI agent teams inside [Pi](https://github.com/nicekate/pi-coding-agent).**

pi-crew is a Pi extension for orchestrating autonomous multi-agent workflows — research, implementation, review, testing, and more.

```bash
pi install npm:pi-crew
```

## Features

- **Multi-agent workflows** — explore → plan → execute → verify, with parallel execution and configurable concurrency
- **Dynamic workflows** (`.dwf.ts`) — author orchestration as TypeScript scripts with `ctx.agent()`, `ctx.fanOut()`, `ctx.pipeline()`, `ctx.review()`, `ctx.budget`, and per-phase event tracking
- **Autonomous goal loops** — multi-turn agent runs with LLM-as-judge evaluation, stopping on achieved / maxTurns / budget / blocked
- **Worktree isolation** — opt-in git worktrees per agent for safe parallel file edits
- **Adaptive planning** — implementation workflow lets a planner decide subagent fanout
- **Async/background runs** — detached runs survive session switches with completion notifications
- **Rich UI** — live widget, dashboard, progress tracking, model/token display
- **Durable state** — manifest, tasks, events, artifacts persisted to disk with atomic writes
- **Import/export** — portable run bundles for sharing and archiving
- **Scheduled runs** — cron, interval, and one-shot support
- **Observability** — metrics registry, Prometheus/OTLP exporters, heartbeat watching
- **Resource management** — create/update/delete agents, teams, workflows with validation
- **Plugin system** — framework-aware context injection (Next.js, Vite, Vitest)
- **Health scoring** — penalty-based run health with time-series snapshots

## Builtin Teams

| Team | Workflow | Purpose |
|------|----------|---------|
| `default` | explore → plan → execute → verify | General-purpose |
| `fast-fix` | explore → execute → verify | Quick bug fixes |
| `implementation` | Adaptive planner decides fanout | Multi-file implementation |
| `review` | explore → code-review → security-review → verify | Code review + audit |
| `research` | explore → analyze → write | Research & documentation |
| `parallel-research` | Parallel shards → synthesize → write | Multi-source research |

## Quick Start

```text
/team-init                              # initialize project
/team-run Investigate failing tests     # run a team
/team-status <runId>                    # check status
/team-dashboard                         # live dashboard
```

## Development

```bash
npm install
npm test            # ~5,860 tests
npm run typecheck   # tsc --noEmit
```

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/actions-reference.md](docs/actions-reference.md) | Tool actions + examples |
| [docs/commands-reference.md](docs/commands-reference.md) | Slash commands |
| [docs/resource-formats.md](docs/resource-formats.md) | Agent/team/workflow file formats |
| [docs/goals.md](docs/goals.md) | Autonomous goal loops |
| [docs/dynamic-workflows.md](docs/dynamic-workflows.md) | `.dwf.ts` script runtime |
| [docs/architecture.md](docs/architecture.md) | Internal architecture |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common errors & recovery |
