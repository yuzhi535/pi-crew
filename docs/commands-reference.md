# pi-crew — Slash Commands Reference

Slash commands là thao tác thủ công từ Pi chat. Autonomous tool use qua `team` action là path chính; slash commands dành cho ops/debug.

## Lệnh chính

| Command | Mô tả |
|---------|-------|
| `/teams` | Liệt kê teams, agents, workflows, recent runs |
| `/team-run [options] <goal>` | Chạy team workflow |
| `/team-orchestrate <planPath>` | Execute từ plan document |
| `/team-schedule [options]` | Lên lịch recurring run |
| `/team-scheduled` | List scheduled jobs |
| `/team-cancel <runId>` | Hủy run |
| `/team-status <runId>` | Xem trạng thái |
| `/team-summary <runId>` | Xem/ghi summary |
| `/team-resume <runId>` | Tiếp tục run đã dừng |
| `/team-search <query>` | BM25 ranked discovery |
| `/team-graph <runId>` | Load/save/list run graphs |
| `/team-events <runId>` | Xem event log |
| `/team-artifacts <runId>` | Xem artifacts |
| `/team-worktrees <runId>` | Xem worktree metadata |
| `/team-cleanup <runId>` | Xóa worktrees |
| `/team-forget <runId>` | Xóa run hoàn toàn |
| `/team-prune` | Xóa nhiều runs cũ |
| `/team-export <runId>` | Export run bundle |
| `/team-import <path>` | Import run bundle |
| `/team-imports` | Liệt kê imported bundles |
| `/team-api <runId> <op>` | State API interop |
| `/team-metrics [filter]` | Xem metrics |
| `/team-manager` | Interactive helper |
| `/team-dashboard` | Live dashboard overlay |
| `/team-init [options]` | Khởi tạo project layout |
| `/team-config [options]` | Xem/sửa config |
| `/team-settings <subcmd>` | Quản lý config keys |
| `/team-autonomy <subcmd>` | Quản lý delegation |
| `/team-validate` | Validate resources |
| `/team-help` | Help text |
| `/team-doctor` | Chẩn đoán môi trường |

---

## `/team-run` — Chi tiết

```text
/team-run <goal>
/team-run --team=implementation <goal>
/team-run --team=default --workflow=default <goal>
/team-run --async <goal>
/team-run --worktree <goal>
```

Options:

| Flag | Mô tả |
|------|-------|
| `--team=<name>` | Chọn team (default: `default`) |
| `--workflow=<name>` | Chọn workflow (default: team's defaultWorkflow) |
| `--async` | Chạy bất đồng bộ |
| `--worktree` | Sử dụng worktree isolation |

Ví dụ:

```text
# Chạy default team
/team-run Investigate failing tests and propose a fix

# Implementation team, async
/team-run --team=implementation --async Refactor auth module

# Worktree isolation
/team-run --team=implementation --worktree Add API endpoint and tests
```

---

## `/team-forget` — Xóa run

```text
/team-forget <runId> --confirm        # Xóa state + artifacts
/team-forget <runId> --confirm --force # Xóa kể cả dirty worktrees
```

⚠️ Cần `--confirm`. Dirty worktrees được giữ lại trừ khi thêm `--force`.

---

## `/team-prune` — Dọn dẹp hàng loạt

```text
/team-prune --keep=20 --confirm
```

Giữ lại 20 runs gần nhất, xóa phần còn lại.

---

## `/team-api` — State Operations

```text
/team-api <runId> <operation> [key=value ...]
```

### Read operations

```text
/team-api team_... read-manifest
/team-api team_... list-tasks
/team-api team_... read-task taskId=task_...
/team-api team_... read-events
/team-api team_... read-heartbeat taskId=task_...
/team-api team_... read-mailbox direction=outbox
/team-api team_... read-mailbox taskId=task_... direction=inbox
/team-api team_... read-delivery
```

### Write operations

```text
/team-api team_... write-heartbeat taskId=task_... alive=true
/team-api team_... claim-task taskId=task_... owner=worker-1
/team-api team_... release-task-claim taskId=task_... owner=worker-1 token=...
/team-api team_... transition-task-status taskId=task_... owner=worker-1 token=... status=running
```

### Mailbox operations

```text
/team-api team_... send-message direction=outbox to=worker body="please check this"
/team-api team_... send-message taskId=task_... direction=inbox to=worker body="task scoped"
/team-api team_... ack-message messageId=msg_...
/team-api team_... validate-mailbox repair=true
```

### Plan operations

```text
/team-api team_... approve-plan
/team-api team_... cancel-plan
```

---

## `/team-metrics` — Observability

```text
/team-metrics                          # Toàn bộ metrics
/team-metrics crew.task.*              # Filter theo glob pattern
```

---

## `/team-config` — Configuration

```text
/team-config                           # Xem config hiện tại
/team-config asyncByDefault=true       # Update key
/team-config --unset=key.path          # Unset key
/team-config ... --project             # Project scope
```

---

## `/team-settings` — Config Management

```text
/team-settings                          # Liệt kê tất cả keys
/team-settings get limits.maxTurns      # Đọc 1 key
/team-settings set limits.maxTurns 20   # Ghi key
/team-settings unset runtime.maxTurns   # Reset về default
/team-settings path                     # Đường dẫn file config
/team-settings scope                    # Scope hiện tại (user/project)
```

### Supported Keys

| Key | Type | Default | Mô tả |
|-----|------|---------|-------|
| `asyncByDefault` | boolean | `false` | Chạy async mặc định |
| `executeWorkers` | boolean | `true` | Spawn child Pi workers |
| `notifierIntervalMs` | number | `5000` | Polling interval cho async notifications |
| `runtime.mode` | string | `"auto"` | Runtime: `auto`, `scaffold`, `child-process`, `live-session` |
| `runtime.maxTurns` | number | — | Max turns per worker |
| `runtime.graceTurns` | number | — | Grace turns sau max |
| `runtime.inheritContext` | boolean | — | Workers kế thừa parent context |
| `runtime.promptMode` | string | — | `replace` hoặc `append` |
| `runtime.groupJoin` | string | `"smart"` | Group join: `off`, `group`, `smart` |
| `runtime.groupJoinAckTimeoutMs` | number | `300000` | Group join ack timeout (ms) |
| `runtime.requirePlanApproval` | boolean | `false` | Yêu cầu approve plan trước execute |
| `runtime.completionMutationGuard` | string | `"warn"` | `off`, `warn`, `fail` |
| `limits.maxConcurrentWorkers` | number | — | Max workers chạy song song |
| `limits.maxTaskDepth` | number | `2` | Max task tree depth |
| `limits.maxChildrenPerTask` | number | `5` | Max children per task |
| `limits.maxRunMinutes` | number | `60` | Max run duration (phút) |
| `limits.maxRetriesPerTask` | number | `1` | Max retries per task |
| `limits.maxTasksPerRun` | number | — | Max tasks per run |
| `limits.heartbeatStaleMs` | number | `60000` | Heartbeat stale threshold |
| `control.enabled` | boolean | — | Enable agent control-plane |
| `control.needsAttentionAfterMs` | number | — | Attention timeout |
| `autonomous.profile` | string | `"suggested"` | `manual`, `suggested`, `assisted`, `aggressive` |
| `autonomous.injectPolicy` | boolean | `true` | Inject policy vào prompt |
| `autonomous.preferAsyncForLongTasks` | boolean | `false` | Auto-async cho tasks dài |
| `autonomous.allowWorktreeSuggestion` | boolean | `true` | Gợi ý worktree mode |
| `tools.enableClaudeStyleAliases` | boolean | `true` | Enable Claude-style aliases |
| `tools.enableSteer` | boolean | `true` | Enable steer tool |
| `tools.terminateOnForeground` | boolean | `false` | Return terminate từ foreground Agent |
| `agents.disableBuiltins` | boolean | `false` | Disable builtin agents |
| `observability.prometheus.enabled` | boolean | `false` | Enable Prometheus exporter |
| `observability.otlp.enabled` | boolean | `false` | Enable OTLP exporter |
| `worktree.enabled` | boolean | — | Enable worktree isolation |

---

## `/team-autonomy` — Delegation Policy

```text
/team-autonomy status                   # Xem trạng thái
/team-autonomy on                       # Bật autonomous delegation
/team-autonomy off                      # Tắt
/team-autonomy manual                   # Profile: manual
/team-autonomy suggested                # Profile: suggested (default)
/team-autonomy assisted                 # Profile: assisted
/team-autonomy aggressive               # Profile: aggressive
```

Options:

```text
/team-autonomy suggested --prefer-async          # Tự động async cho tasks dài
/team-autonomy suggested --no-worktree-suggest   # Không gợi ý worktree
```

### Autonomy Profiles

| Profile | Hành vi |
|---------|---------|
| `manual` | Không tự động delegate. Chạy khi host agent gọi team tool trực tiếp |
| `suggested` | Đề xuất khi phù hợp, host agent quyết định (default) |
| `assisted` | Chủ động delegate cho hầu hết tasks phức tạp |
| `aggressive` | Luôn delegate, tối đa parallel execution |

---

## `/team-init` — Project Setup

```text
/team-init                             # Khởi tạo layout cơ bản
/team-init --copy-builtins             # Copy builtin resources vào project
/team-init --copy-builtins --overwrite # Copy và ghi đè
```

Tạo directories:

```text
# New projects (.crew/ layout)
.crew/agents/
.crew/teams/
.crew/workflows/
.crew/imports/

# Legacy (.pi/ layout, khi .pi/ đã tồn tại)
.pi/teams/agents/
.pi/teams/teams/
.pi/teams/workflows/
.pi/teams/imports/
```

---

## `/team-dashboard` — Live Dashboard

```text
/team-dashboard
```

### Keyboard Shortcuts

| Key | Hành động |
|-----|-----------|
| `↑`/`↓` hoặc `j`/`k` | Chọn run |
| `r` | Reload run list |
| `p` | Toggle short/long progress |
| `Enter` hoặc `s` | Xem status |
| `a` | Xem artifacts |
| `u` | Xem summary |
| `i` | API read-manifest |
| `q` hoặc `Esc` | Đóng |

---

## `/team-manager` — Interactive Helper

```text
/team-manager
```

Flows:
- Liệt kê resources/runs
- Chạy team
- Xem run status
- Cleanup worktrees
- Tạo/sửa agent/team resources
- Doctor check

---

## `/team-validate` — Resource Validation

```text
/team-validate
```

Kiểm tra:
- Agents, teams, workflows hợp lệ
- References đúng (agent tồn tại trong team roles)
- Model hints hợp lệ
- Workflow steps đúng format

---

## `/team-doctor` — Environment Check

```text
/team-doctor
```

Kiểm tra:
- cwd, platform, architecture
- Node.js version
- `pi --version`
- `git --version`
- State paths writable
- Config parse
- Discovery counts (agents, teams, workflows)
- Resource validation
- Current model/provider
- Model/fallback hints

Child Pi smoke test (explicit):

```text
/team-api team_... doctor smokeChildPi=true
```

hoặc qua tool:

```json
{
  "action": "doctor",
  "config": { "smokeChildPi": true }
}
```
