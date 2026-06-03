---
name: hunting-investigation-loop
description: "Active hypothesis-driven investigation and threat hunting."
origin: distilled:anthropic-cybersecurity-skills
triggers:
  - "hunt for"
  - "find evidence of"
  - "investigate"
  - "active search"
  - "forensic hunt"
---
# hunting-investigation-loop

Use this skill when conducting active, hypothesis-driven threat hunting and investigation.

## Source

Distilled from 28 `hunting-for-*` skills (Anthropic Cybersecurity Skills) and generalized for software/codebase context.

## When to Use

- Proactively hunting for indicators of compromise
- Investigating suspicious patterns without clear incident
- Periodic security assessments
- After threat intelligence suggests specific patterns
- Purple team exercises

## Core Loop

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Form      │ →  │  Locate     │ →  │   Query     │ →  │   Analyze   │
│ Hypothesis  │    │ Data Sources│    │   Search    │    │   Results   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                          ↓
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Report    │ ←  │  Document   │ ←  │   Scope     │ ←  │  Validate   │
│  Findings   │    │  Evidence   │    │  Extent     │    │  Findings   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

## Investigation Loop

```markdown
## Hunting Investigation Loop

1. **Form Hypothesis** → "There might be [vulnerability/pattern] in [location]"
2. **Identify Hunt** → Search location: [files, commits, logs, configs]
3. **Execute Search** → Query: [grep, regex, pattern match]
4. **Analyze Results** → Filter: [true_positive, false_positive, noise]
5. **Validate** → Confirm: [secondary source, cross-reference]
6. **Scope** → Extent: [how many files, lines, occurrences]
7. **Document** → Findings: [file, line, pattern, severity]
```

## Hunt Structure

```yaml
hunt:
  id: string                    # e.g., "HUNT-2026-001"
  hypothesis: string            # What we're testing
  technique: string             # e.g., "credential_theft", "injection"
  status: [planned|running|completed|cancelled]
  
  data_sources:
    - name: string
      type: [file|commit|log|config|database]
      locations: [paths, globs, queries]
      priority: [high|medium|low]
  
  search_patterns:
    - pattern: string
      type: [regex|AST|signature|heuristic]
      context_needed: int        # Lines before/after
      expected_findings: int     # Estimated findings
  
  validation:
    methods:
      - name: string
        description: string
        expected: string         # What validation should confirm
    cross_references:
      - source: string
        query: string
  
  findings:
    - file: string
      line: number
      evidence: string
      confidence: [high|medium|low]
      validated: boolean
  
  scope:
    total_findings: int
    files_affected: int
    severity: [critical|high|medium|low]
  
  next_actions:
    - investigate: [further analysis needed]
    - contain: [immediate action required]
    - remediate: [fix required]
    - close: [false positive, no action]
```

## Hypothesis Templates

### Template 1: Credential Pattern Hunt

```yaml
hypothesis:
  id: HUNT-2026-CRED-001
  title: Hardcoded credentials in codebase
  technique: credential_exposure
  data_sources:
    - name: source_code
      type: file
      locations: ["**/*.ts", "**/*.js", "**/*.py"]
    - name: config_files
      type: file
      locations: ["**/*.json", "**/*.yaml", "**/*.env"]
  search_patterns:
    - pattern: '(password|secret|token|key)\s*[=:]\s*["\'][^"\']{10,}'
      type: regex
    - pattern: 'process\.env\.[A-Z_]{5,}'
      type: regex
  validation:
    - method: git_history_check
      description: Check if credentials were ever committed
    - method: secret_scanner
      description: Run trufflehog to confirm
```

### Template 2: Injection Pattern Hunt

```yaml
hypothesis:
  id: HUNT-2026-INJ-001
  title: Code injection vulnerabilities
  technique: command_injection
  data_sources:
    - name: source_code
      type: file
      locations: ["**/*.ts", "**/*.js", "**/*.py", "**/*.go"]
  search_patterns:
    - pattern: '(eval|exec|Function|spawn)\s*\('
      type: regex
    - pattern: 'child_process.*exec.*template'
      type: AST
  validation:
    - method: confirm_user_input_taint
      description: Check if eval input includes user data
    - method: test_in_sandbox
      description: Execute with controlled input
```

### Template 3: Supply Chain Hunt

```yaml
hypothesis:
  id: HUNT-2026-SUPPLY-001
  title: Dependency confusion or typosquatting
  technique: supply_chain_attack
  data_sources:
    - name: package_manifest
      type: file
      locations: ["package.json", "requirements.txt", "Cargo.toml"]
  search_patterns:
    - pattern: '"@private/.*"'
      type: regex
    - pattern: 'version.*>.*9999999'
      type: regex
  validation:
    - method: npm_audit
      description: Check for malicious packages
    - method: typosquat_check
      description: Check for similar package names
```

### Template 4: Persistence Mechanism Hunt

```yaml
hypothesis:
  id: HUNT-2026-PERS-001
  title: Malicious persistence mechanisms
  technique: persistence
  data_sources:
    - name: startup_files
      type: file
      locations: ["**/startup/**", "**/init/**", "**/.profile"]
    - name: cron_configs
      type: file
      locations: ["**/cron/**", "**/.crontab"]
    - name: systemd
      type: file
      locations: ["**/*.service", "**/systemd/**"]
  search_patterns:
    - pattern: '(wget|curl).*\|.*(bash|sh)'
      type: regex
    - pattern: 'nohup.*background'
      type: regex
  validation:
    - method: confirm_evil_binary
      description: Check downloaded binary hash
    - method: network_check
      description: Check for suspicious network activity
```

## Hunt Execution

### Phase 1: Form Hypothesis

Before starting a hunt, clearly define:
- What you're looking for
- Why you think it might exist
- Where to look
- How to confirm

```markdown
## Hypothesis Formulation Checklist

- [ ] Clear technique/pattern being hunted
- [ ] Known attack chain context
- [ ] Data sources identified
- [ ] Search patterns defined
- [ ] Validation method specified
- [ ] False positive patterns identified
```

### Phase 2: Execute Search

Run searches in priority order:

```bash
# High priority - common locations
rg -n "pattern" --type ts src/ | head -50

# Config files
rg -n "pattern" --type json --type yaml config/ | head -20

# Check for encoded/obfuscated
rg -n "atob|b64decode|base64" --type js | head -20
```

### Phase 3: Analyze Results

Filter findings by:
1. **True Positive** - Actual vulnerability/indicator
2. **False Positive** - Known benign pattern
3. **Noise** - Irrelevant matches

```yaml
analysis:
  true_positives:
    count: int
    examples:
      - file: path
        line: number
        reason: why this is a finding
  false_positives:
    count: int
    reasons:
      - known_benign_pattern
      - test_code
      - excluded_by_validation
  noise:
    count: int
    reasons:
      - not_in_scope
      - duplicate_findings
```

### Phase 4: Validate

For each potential finding:
1. Cross-reference with other data sources
2. Check git history for context
3. Verify with secondary method
4. Assess exploitability

```yaml
validation:
  method_1:
    name: secondary_source_check
    result: [confirmed|suspected|false_positive]
    evidence: string
  method_2:
    name: git_history_check
    result: [confirmed|suspected|false_positive]
    evidence: string
  method_3:
    name: exploitability_assessment
    result: [confirmed|suspected|false_positive]
    evidence: string
```

### Phase 5: Scope and Document

Document findings with:
- Exact location (file:line)
- Evidence (code snippet, pattern match)
- Confidence level
- Validation results
- Recommended action

## Hunt Report Format

```
Hunt Report: [HUNT-ID]
==============

Hypothesis: [what we tested]
Hunt Date: [timestamp]
Hypothesis: [technique/pattern]

## Executive Summary

- Total Findings: [N]
- Critical: [N] | High: [N] | Medium: [N] | Low: [N]
- Files Affected: [N]
- Confidence: [Overall assessment]

## Data Sources Searched

- [source 1]: [findings count]
- [source 2]: [findings count]

## Findings

### [Finding 1] - [Severity]
Location: [file:line]
Evidence:
```
[code snippet]
```
Validated: [YES/NO - how]
Recommendation: [action]

### [Finding 2]...

## False Positives

- [why certain matches were dismissed]

## Next Actions

- [ ] Investigate further: [specific items]
- [ ] Remediate: [specific items]
- [ ] Monitor: [specific items]

## Conclusion

[Overall assessment of hunt results]
```

## Hunt Status Tracking

```yaml
hunt_status:
  planned:
    - id: string
      hypothesis: string
      planned_date: date
  running:
    - id: string
      start_time: timestamp
      current_phase: [form|locate|query|analyze|validate|report]
      findings_count: int
  completed:
    - id: string
      end_time: timestamp
      outcome: [findings_confirmed|no_findings|false_positive]
      report_path: string
```

## Anti-Patterns

- **Don't** hunt without clear hypothesis (scattershot searching)
- **Don't** skip data source identification (missing coverage)
- **Don't** skip validation (false positive flood)
- **Don't** skip false positive documentation (repeating mistakes)
- **Don't** report without confidence level (misleads stakeholders)

## Tools

| Tool | Purpose |
|------|---------|
| `rg` (ripgrep) | Pattern search in files |
| `git log` | History investigation |
| `semgrep` | AST-based pattern matching |
| `grep` | Binary/encoded string search |
| `jq` | JSON log analysis |

## Verification

For hunting framework changes:
```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/hunting-patterns.test.ts
```

*See also: `threat-hypothesis-framework` for structured hypothesis creation, `read-only-explorer` for exploration fundamentals.*