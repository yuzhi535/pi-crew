# pi-crew — Tool Actions Reference

Tool `team` là công cụ chính mà pi-crew đăng ký vào Pi. Mọi thao tác đều đi qua `action`.

## Quick Reference

| Action | Purpose | Trọng tâm |
|--------|---------|-----------|
| `recommend` | Gợi ý team/workflow phù hợp | Bắt đầu khi chưa chắc chọn gì |
| `run` | Tạo run và thực thi workflow | Thao tác chính |
| `plan` | Preview workflow không chạy tasks | Dry-run planning |
| `orchestrate` | Execute từ plan document | Tự động hóa plan |
| `schedule` | Lên lịch recurring runs | Tự động định kỳ |
| `scheduled` | List scheduled jobs | Xem lịch trình |
| `status` | Đọc trạng thái run | Theo dõi tiến độ |
| `summary` | Đọc/ghi run summary artifact | Tổng kết |
| `cancel` | Hủy queued/running work | Dừng run |
| `resume` | Re-queue failed/cancelled tasks | Tiếp tục run |
| `list` | List teams, agents, workflows, runs | Khám phá tài nguyên |
| `get` | Inspect agent/team/workflow | Xem chi tiết |
| `search` | BM25 ranked agent/team discovery | Tìm kiếm thông minh |
| `events` | Đọc event log | Debug/audit |
| `artifacts` | List run artifacts | Xem outputs |
| `worktrees` | List run worktree metadata | Kiểm tra worktrees |
| `graph` | Load/save/list run graphs | Trực quan hóa |
| `cleanup` | Xóa run worktrees | Dọn dẹp |
| `forget` | Xóa run state/artifacts | Xóa hẳn (cần `confirm`) |
| `prune` | Xóa nhiều old finished runs | Dọn dẹp hàng loạt |
| `export` | Export portable run bundle | Chia sẻ/backup |
| `import` | Import run bundle | Nhận run từ nơi khác |
| `imports` | List imported bundles | Xem imports |
| `create` | Tạo agent/team/workflow | Mở rộng tài nguyên |
| `update` | Cập nhật agent/team/workflow | Sửa tài nguyên |
| `delete` | Xóa agent/team/workflow | Xóa tài nguyên (cần `confirm`) |
| `validate` | Validate resources | Kiểm tra sức khỏe |
| `doctor` | Kiểm tra readiness | Chẩn đoán môi trường |
| `config` | Show/update config | Cấu hình |
| `init` | Khởi tạo project layout | Setup ban đầu |
| `autonomy` | Quản lý delegation settings | Điều chỉnh tự động hóa |
| `api` | Safe interop cho state operations | Tích hợp nâng cao |
| `help` | Hiển thị help text | Trợ giúp |

---

## Chi tiết từng Action

### `recommend` — Gợi ý định hướng

Khi chưa biết dùng team/workflow nào, gọi `recommend` để nhận phân tích + đề xuất:

```json
{
  "action": "recommend",
  "goal": "Refactor auth flow and add tests"
}
```

Response gồm:
- Team/workflow được gợi ý
- Fanout hints (bao nhiêu subagents)
- Có nên async hay worktree không
- Lý do lựa chọn

---

### `run` — Thực thi workflow

Đây là action chính. Tạo run manifest, task graph, và thực thi.

#### Cú pháp cơ bản

```json
{
  "action": "run",
  "team": "default",
  "goal": "Investigate failing tests and propose a fix"
}
```

#### Chọn team

| Team | Mục đích |
|------|----------|
| `default` | Cân bằng, 4 bước: explore → plan → execute → verify |
| `fast-fix` | Sửa bug nhỏ: explore → execute → verify |
| `implementation` | Adaptive planner tự quyết fanout |
| `review` | Code review + security review |
| `research` | Nghiên cứu và viết tài liệu |

#### Chạy bất đồng bộ (async)

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Implement user settings screen",
  "async": true
}
```

Run tách riêng khỏi session, có thể sống qua session switch/reload. Pi-crew tự động notify khi run hoàn thành.

#### Worktree isolation

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Add API endpoint and tests",
  "workspaceMode": "worktree"
}
```

Mỗi task chạy trong git worktree riêng — an toàn cho codebase chính. Yêu cầu repo clean.

#### Override model

```json
{
  "action": "run",
  "team": "default",
  "goal": "Quick exploration",
  "model": "gpt-4o-mini"
}
```

#### Override config cho run

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Refactor auth",
  "config": {
    "runtime": { "requirePlanApproval": true },
    "limits": { "maxConcurrentWorkers": 4 }
  }
}
```

#### Plan approval gate

Yêu cầu explicit approve sau khi planner tạo plan, trước khi executor chạy:

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Major refactor",
  "config": {
    "runtime": { "requirePlanApproval": true }
  }
}
```

Approve:

```json
{
  "action": "api",
  "runId": "team_...",
  "config": { "operation": "approve-plan" }
}
```

Cancel plan:

```json
{
  "action": "api",
  "runId": "team_...",
  "config": { "operation": "cancel-plan" }
}
```

---

### `plan` — Preview workflow

Giống `run` nhưng **không spawn workers**. Xem trước task graph sẽ tạo:

```json
{
  "action": "plan",
  "team": "implementation",
  "goal": "Add authentication module"
}
```

---

### `orchestrate` — Execute từ plan document

Thực thi workflow từ plan document có tag sections:

```markdown
# Design Phase
<!-- tag: design -->
Design the authentication system...

# Implementation
<!-- tag: impl -->
Implement the JWT auth...
```

```json
{
  "action": "orchestrate",
  "planPath": "./plan.md"
}
```

TAG→chain mapping:
- `design` → planner, architect
- `impl` → tdd-guide, lang-reviewer
- `security` → security-reviewer, lang-reviewer
- `build` → build-error-resolver
- `test` → test-engineer, verifier
- `review` → reviewer

---

### `schedule` — Lên lịch recurring runs

Tạo scheduled job với cron, interval, hoặc once:

```json
{
  "action": "schedule",
  "team": "review",
  "goal": "Weekly security review",
  "cron": "0 9 * * MON"
}
```

Params: `cron`, `interval` (ms), `once` (ISO timestamp)

---

### `scheduled` — List scheduled jobs

```json
{
  "action": "scheduled"
}
```

---

### `graph` — Load/save/list run graphs

```json
{
  "action": "graph",
  "runId": "team_..."
}
```

---

### `search` — BM25 ranked discovery

Tìm kiếm agents/teams/workflows với BM25 ranking:

```json
{
  "action": "search",
  "goal": "security audit"
}
```

---

### `status` — Trạng thái run

```json
{
  "action": "status",
  "runId": "team_..."
}
```

Output gồm: manifest, tasks, agents, timing, usage totals.

---

### `summary` — Tổng kết run

Đọc summary:

```json
{
  "action": "summary",
  "runId": "team_..."
}
```

Ghi summary:

```json
{
  "action": "summary",
  "runId": "team_...",
  "message": "Implemented auth with tests. All passing."
}
```

---

### `cancel` — Hủy run

```json
{
  "action": "cancel",
  "runId": "team_..."
}
```

Hủy tất cả queued/running tasks. Running child processes nhận SIGTERM.

---

### `resume` — Tiếp tục run

```json
{
  "action": "resume",
  "runId": "team_..."
}
```

Re-queue failed/cancelled/skipped tasks. Tasks đã completed không bị ảnh hưởng.

---

### `list` — Liệt kê tài nguyên

```json
{
  "action": "list"
}
```

Hiển thị: teams, agents, workflows đã discover, và recent runs.

---

### `get` — Xem chi tiết tài nguyên

```json
{
  "action": "get",
  "resource": "agent",
  "agent": "executor"
}
```

---

### `events` — Event log

```json
{
  "action": "events",
  "runId": "team_..."
}
```

Append-only JSONL events: task.started, task.completed, run.blocked, etc.

---

### `artifacts` — Run outputs

```json
{
  "action": "artifacts",
  "runId": "team_..."
}
```

---

### `worktrees` — Worktree metadata

```json
{
  "action": "worktrees",
  "runId": "team_..."
}
```

---

### `cleanup` — Xóa worktrees

```json
{
  "action": "cleanup",
  "runId": "team_..."
}
```

Dirty worktrees được giữ lại trừ khi `force: true`.

---

### `forget` — Xóa run hoàn toàn

```json
{
  "action": "forget",
  "runId": "team_...",
  "confirm": true
}
```

Xóa state + artifacts + worktrees. Cần `confirm: true`.

---

### `prune` — Xóa nhiều runs cũ

```json
{
  "action": "prune",
  "confirm": true,
  "keep": 10
}
```

Giữ lại `keep` runs gần nhất, xóa phần còn lại.

---

### `export` / `import` — Chia sẻ runs

Export:

```json
{
  "action": "export",
  "runId": "team_..."
}
```

Import:

```json
{
  "action": "import",
  "path": "/path/to/run-export.json"
}
```

User-global import:

```json
{
  "action": "import",
  "path": "/path/to/run-export.json",
  "scope": "user"
}
```

List imports:

```json
{
  "action": "imports"
}
```

---

### `create` — Tạo tài nguyên

Tạo agent:

```json
{
  "action": "create",
  "resource": "agent",
  "config": {
    "scope": "project",
    "name": "api-reviewer",
    "description": "Reviews backend API changes",
    "systemPrompt": "You review backend API changes for correctness and compatibility.",
    "triggers": ["api", "endpoint", "contract"],
    "useWhen": ["backend API change", "OpenAPI contract update"],
    "avoidWhen": ["documentation-only edits"],
    "cost": "cheap",
    "category": "backend"
  }
}
```

Tạo team:

```json
{
  "action": "create",
  "resource": "team",
  "config": {
    "name": "backend-team",
    "description": "Backend implementation team",
    "scope": "project",
    "defaultWorkflow": "default",
    "roles": [
      { "name": "explorer", "agent": "explorer" },
      { "name": "executor", "agent": "executor" },
      { "name": "verifier", "agent": "verifier" }
    ]
  }
}
```

Tạo workflow:

```json
{
  "action": "create",
  "resource": "workflow",
  "config": {
    "name": "quick-review",
    "scope": "user",
    "steps": [
      { "id": "review", "role": "reviewer", "prompt": "Review: {goal}" },
      { "id": "verify", "role": "verifier", "dependsOn": "review", "verify": true, "prompt": "Verify the review findings." }
    ]
  }
}
```

---

### `update` — Cập nhật tài nguyên

```json
{
  "action": "update",
  "resource": "agent",
  "agent": "worker",
  "scope": "project",
  "updateReferences": true,
  "config": { "name": "better-worker", "description": "Improved worker agent" }
}
```

`updateReferences: true` sẽ tự động cập nhật tất cả team references trỏ đến tên cũ.

---

### `delete` — Xóa tài nguyên

```json
{
  "action": "delete",
  "resource": "team",
  "team": "backend-team",
  "scope": "project",
  "confirm": true
}
```

Backup tự động trước khi xóa.

---

### `validate` — Kiểm tra tài nguyên

```json
{
  "action": "validate"
}
```

Kiểm tra: agents, teams, workflows, references, model hints.

---

### `doctor` — Chẩn đoán môi trường

```json
{
  "action": "doctor"
}
```

Kiểm tra: cwd, platform, Node.js, Pi version, git, state paths, config, resources, model/provider.

Smoke test child Pi (explicit):

```json
{
  "action": "doctor",
  "config": { "smokeChildPi": true }
}
```

---

### `api` — State interop nâng cao

Safe API cho run/task/event/heartbeat/claim/mailbox operations:

```text
/team-api <runId> <operation> [key=value]
```

Operations:

| Operation | Mô tả |
|-----------|-------|
| `read-manifest` | Đọc manifest |
| `list-tasks` | Liệt kê tasks |
| `read-task` | Đọc task (cần `taskId=`) |
| `read-events` | Đọc event log |
| `read-heartbeat` | Đọc heartbeat (cần `taskId=`) |
| `write-heartbeat` | Ghi heartbeat (cần `taskId=`, `alive=`) |
| `claim-task` | Claim task (cần `taskId=`, `owner=`) |
| `release-task-claim` | Release claim |
| `transition-task-status` | Chuyển task status |
| `send-message` | Gửi mailbox message |
| `read-mailbox` | Đọc mailbox |
| `ack-message` | Acknowledge message |
| `read-delivery` | Đọc delivery state |
| `validate-mailbox` | Validate/sửa mailbox |
| `approve-plan` | Approve plan (khi requirePlanApproval) |
| `cancel-plan` | Cancel plan |

---

### `config` — Cấu hình

Xem config hiện tại:

```json
{ "action": "config" }
```

Update user config:

```json
{
  "action": "config",
  "config": { "asyncByDefault": true }
}
```

Unset:

```json
{
  "action": "config",
  "config": { "autonomous.preferAsyncForLongTasks": "unset" }
}
```

---

### `init` — Khởi tạo project

```json
{ "action": "init" }
```

Copy builtins:

```json
{ "action": "init", "config": { "copyBuiltins": true, "overwrite": true } }
```

---

### `autonomy` — Delegation settings

```json
{ "action": "autonomy" }
```

Profiles: `manual`, `suggested`, `assisted`, `aggressive`.
