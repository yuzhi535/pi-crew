---
name: incident-playbook-construction
description: "Build structured incident response playbooks and runbooks."
origin: distilled:anthropic-cybersecurity-skills
triggers:
  - "build playbook"
  - "create runbook"
  - "document procedure"
  - "IR automation"
  - "SOAR design"
---
# incident-playbook-construction

Use this skill when building incident response playbooks and structured procedures.

## Source

Distilled from `building-incident-response-playbook` (Anthropic Cybersecurity Skills) and generalized for software/team context.

## When to Use

- Creating new incident response procedures
- Documenting procedures for a specific incident type
- Automating response workflows
- Preparing for compliance audits (SOC 2, HIPAA, PCI-DSS)
- Conducting gap analysis of existing response capabilities

## Playbook Structure

```yaml
playbook:
  name: string                    # e.g., "data-breach-response"
  version: string                # e.g., "1.0.0"
  trigger:
    conditions:
      - name: string
        description: string
  scope:
    affected:
      - [files, systems, teams]
    not_in_scope:
      - [what this playbook doesn't cover]
  steps:
    - id: number
      name: string
      action: string             # What to do
      verify: string             # How to confirm success
      on_success: next_step_id    # or "close"
      on_failure: escalation_id   # or "abort"
  decision_tree:
    - condition: string          # e.g., "data_encrypted == true"
      branches:
        yes: step_id
        no: step_id
  escalation:
    - id: number
      condition: string
      action: string              # notify, escalate, abort
      notify: [roles]
  raci:
    responsible: [role]
    accountable: [role]
    consulted: [role]
    informed: [role]
  sla:
    detection: duration          # e.g., "15m"
    containment: duration
    eradication: duration
    recovery: duration
    lessons_learned: duration
```

## Playbook Workflow

```markdown
## Playbook Construction Process

1. **Identify Type** → [bug-fix, security-incident, outage, data-breach, supply-chain]
2. **Define Scope** → [affected files, teams, systems]
3. **Document Steps** → Numbered procedure: [step → action → verification]
4. **Add Decisions** → Branch points: [if X then Y else Z]
5. **Specify Roles** → RACI: [Responsible, Accountable, Consulted, Informed]
6. **Set SLAs** → Time-based thresholds: [P1: 1hr, P2: 4hr, P3: 24hr]
7. **Add Automation** → Auto-trigger conditions: [if X then run Y]
8. **Test** → Validate with [scenario simulation]
```

## Step Definition

Each step follows this structure:

```yaml
step:
  id: 1                          # Sequential ID
  name: "Contain the incident"  # Human-readable name
  action: |
    # Concrete actions to take
    1. Isolate affected system
    2. Preserve evidence
    3. Notify team
  verify: |
    # How to confirm step completed
    - System isolated: check network connections
    - Evidence preserved: snapshot taken
    - Team notified: ack received
  tools:
    - name: string
      command: string
  artifacts:
    output: [files created by this step]
  rollback: |
    # How to undo this step if needed
    reconnect_system()
  next:
    success: 2                   # Next step ID on success
    failure: "escalate"          # Or step ID, or "abort"
```

## Decision Tree Patterns

### Branch by Severity

```yaml
decision:
  name: severity-assessment
  condition: "incident.severity"
  branches:
    P1:
      - step: 2                  # Immediate containment
        notify: [lead, manager]
      - step: 5                  # War room
    P2:
      - step: 3                  # Standard response
        notify: [lead]
    P3:
      - step: 4                  # Low priority
        notify: [team]
    P4:
      - step: 6                  # Backlog
        notify: []
```

### Branch by Type

```yaml
decision:
  name: incident-type-assessment
  condition: "incident.type"
  branches:
    data-breach:
      - step: data_containment
      - step: legal_notification
      - step: affected_users_notification
    security-compromise:
      - step: isolate_system
      - step: preserve_evidence
      - step: forensic_investigation
    outage:
      - step: assess_impact
      - step: restore_service
      - step: post-mortem
    bug:
      - step: reproduce
      - step: fix
      - step: verify
```

## RACI Matrix

```yaml
raci:
  roles:
    - name: orchestrator
      responsible: [coordinate, dispatch]
      accountable: [decisions, outcomes]
    - name: executor
      responsible: [implement, investigate]
      accountable: []
    - name: verifier
      responsible: [test, validate]
      accountable: []
    - name: lead
      responsible: []
      accountable: [escalation, resource_allocation]
    - name: manager
      responsible: []
      accountable: [approval, external_communication]
```

## SLA Definition

```yaml
sla:
  phases:
    - name: detection
      target: "15m"              # Time to detect/acknowledge
      measured_from: incident_start
    - name: containment
      target: "1h"
      measured_from: detection_complete
    - name: eradication
      target: "4h"
      measured_from: containment_complete
    - name: recovery
      target: "24h"
      measured_from: eradication_complete
    - name: lessons_learned
      target: "72h"
      measured_from: recovery_complete
  escalation:
    - phase: detection
      exceeded: notify_lead
    - phase: containment
      exceeded: notify_manager
    - phase: recovery
      exceeded: notify_executive
```

## Playbook Examples

### Example 1: Security Incident Playbook

```yaml
playbook:
  name: security-compromise-response
  trigger:
    conditions:
      - name: unauthorized_access
        description: Access by unauthorized user
      - name: malware_detection
        description: Malware or suspicious process
      - name: data_exfiltration
        description: Abnormal data transfer
  steps:
    - id: 1
      name: Detect and confirm
      action: |
        - Review logs for unauthorized access
        - Confirm malware detection with secondary tool
        - Identify scope of compromise
      verify: |
        - Logs show compromise indicators
        - Malware confirmed by 2+ tools
      next:
        success: 2
        failure: abort
    - id: 2
      name: Contain
      action: |
        - Isolate affected system from network
        - Preserve evidence (memory dump, disk image)
        - Block malicious IPs/domains
      verify: |
        - System isolated: no network connections
        - Evidence preserved: hash verified
      next:
        success: 3
        failure: escalate
    - id: 3
      name: Investigate
      action: |
        - Determine attack vector
        - Identify affected systems
        - Timeline reconstruction
      next:
        success: 4
    - id: 4
      name: Eradicate
      action: |
        - Remove malware/backdoor
        - Patch vulnerability
        - Reset compromised credentials
      next:
        success: 5
    - id: 5
      name: Recover
      action: |
        - Restore from clean backup
        - Verify system integrity
        - Monitor for recurrence
      next:
        success: close
  sla:
    detection: "15m"
    containment: "1h"
    eradication: "4h"
    recovery: "24h"
```

### Example 2: Bug Fix Playbook

```yaml
playbook:
  name: bug-fix-response
  trigger:
    conditions:
      - name: regression
        description: Existing feature broken
      - name: new_bug
        description: Newly reported issue
  steps:
    - id: 1
      name: Reproduce
      action: |
        - Get reliable repro steps
        - Verify bug exists
        - Document environment
      verify: |
        - Bug reproduced consistently OR
        - Bug confirmed as flaky (>50% reproduction)
      next:
        success: 2
    - id: 2
      name: Investigate
      action: |
        - Find root cause
        - Identify affected code
        - Determine fix approach
      verify: |
        - Root cause identified (not hypothesis)
      next:
        success: 3
    - id: 3
      name: Fix
      action: |
        - Implement fix
        - Write regression test
        - Update documentation
      next:
        success: 4
    - id: 4
      name: Verify
      action: |
        - Run original repro
        - Run full test suite
        - Code review
      next:
        success: close
  sla:
    detection: "30m"
    containment: "1h"
    eradication: "4h"
    recovery: "24h"
```

## Enforcement — Incident Playbook Construction Gate

**Before publishing a playbook, verify:**

- [ ] Trigger conditions defined (knowing when to use this playbook)
- [ ] Each step has action + verification + next (success/failure) defined
- [ ] Decision points have explicit branches (if X then Y else Z)
- [ ] RACI matrix assigns responsible/accountable roles
- [ ] SLA phases defined with targets and escalation conditions
- [ ] Rollback procedures documented for critical steps

If ANY answer is NO → Stop. Complete playbook structure before publishing.

## Anti-Patterns

- **Don't** create playbooks without trigger conditions (don't know when to use)
- **Don't** skip verification steps (can't confirm success)
- **Don't** skip rollback procedures (can't undo mistakes)
- **Don't** skip decision points (linear playbooks miss branches)
- **Don't** skip SLA definition (no accountability for timing)

## Tools

| Tool | Purpose |
|------|---------|
| `post-mortem` | Post-incident documentation |
| `systematic-debugging` | Root cause investigation |
| `verification-before-done` | Step verification |

## Verification

For playbook changes:
```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/playbook-validation.test.ts
```

*See also: `post-mortem` skill for post-incident documentation, `delegation-patterns` for escalation matrix.*