---
name: threat-hypothesis-framework
description: "\"Structured investigation using testable hypotheses. Use when hunting for indicators, investigating suspicious patterns, or conducting proactive security assessments. Triggers: hunt for, investigate, threat hypothesis, test this pattern, find evidence of.\""

---
# threat-hypothesis-framework

Use this skill when conducting hypothesis-driven investigation and threat hunting.

## Source

Distilled from `building-threat-hunt-hypothesis-framework` (Anthropic Cybersecurity Skills) and generalized for software/codebase context.

## When to Use

- Proactively hunting for indicators of compromise in code
- After threat intelligence indicates suspicious patterns
- During incident investigation to scope extent
- When EDR/logs alert on related indicators
- During periodic security assessments

## Workflow

```markdown
## Hypothesis Investigation Loop

1. **Formulate** → Given [observed IOCs/patterns], hypothesize [attack scenario]
2. **Identify** → List data sources: [files, commits, logs, configs]
3. **Search** → Run queries across identified sources
4. **Analyze** → Pattern match: [technique, indicator, artifact]
5. **Validate** → Confirm with [secondary source, cross-reference]
6. **Correlate** → Link findings to [broader campaign, actor]
7. **Report** → Document: [finding, confidence, next_action]
```

## Hypothesis Structure

```yaml
hypothesis:
  id: string                    # e.g., "HY-2026-001"
  technique: string              # e.g., "credential-theft", "supply-chain"
  description: string            # What we're testing
  data_sources:
    - type: [file|commit|log|config]
      locations: [paths, globs]
  search_patterns:
    - pattern: string
      type: [regex|AST|signature]
  validation:
    - method: string
      expected_result: string
  confidence_levels:
    high: [confirmed by multiple sources]
    medium: [single source, needs validation]
    low: [heuristic match, requires investigation]
```

## Hunt Report Format

```
Hunt ID: [HY-runid-date-seq]
Hypothesis: [what we're testing]
Data Sources: [where we looked]
Search Patterns: [what we searched for]
Findings:
  - File: [path]
    Line: [number]
    Evidence: [what matched]
    Confidence: [High/Medium/Low]
Correlation: [link to other findings]
Next Actions:
  - investigate: [further analysis needed]
  - contain: [immediate action required]
  - close: [false positive, no action]
```

## Investigation Examples

### Example 1: Credential Detection Hunt

```yaml
hypothesis:
  id: HY-2026-042
  technique: hardcoded-credentials
  description: Search for hardcoded secrets in codebase
  data_sources:
    - type: file
      locations: ["**/*.ts", "**/*.js", "**/*.env"]
  search_patterns:
    - pattern: '(api[_-]?key|secret|token|password)\s*[=:]'
      type: regex
    - pattern: 'process\.env\.[A-Z_]+'
      type: AST
  validation:
    - method: git history check
      expected_result: No recent secret additions
    - method: secret scanning tool
      expected_result: Zero findings in main branch
```

### Example 2: Supply Chain Hunt

```yaml
hypothesis:
  id: HY-2026-043
  technique: dependency-confusion
  description: Detect potential dependency confusion attacks
  data_sources:
    - type: file
      locations: ["**/package.json", "**/requirements.txt"]
  search_patterns:
    - pattern: '"@private/.*
      type: regex
    - pattern: 'version.*>.*<.*9999999'
      type: regex
  validation:
    - method: npm audit
      expected_result: No anomalies
    - method: typosquat check
      expected_result: No similar package names
```

## Confidence Scoring

| Level | Criteria | Action |
|-------|----------|--------|
| **High** | Confirmed by 2+ independent sources, exact match | Immediate action |
| **Medium** | Single source, pattern match, needs validation | Investigate further |
| **Low** | Heuristic match, possible false positive | Log and monitor |

## Enforcement — Threat Hypothesis Framework Gate

**Before reporting hunt findings, verify:**

- [ ] Hypothesis clearly stated before search (not scattershot searching)
- [ ] Data sources identified (files, commits, logs, configs)
- [ ] Search patterns defined (regex, AST, signature)
- [ ] Findings validated with secondary source or cross-reference
- [ ] Confidence level assigned (High/Medium/Low) based on validation
- [ ] Report includes: finding, confidence, next_action (investigate/contain/close)

If ANY answer is NO → Stop. Complete hypothesis framework before reporting.

## Anti-Patterns

- **Don't** run hunt without clear hypothesis (scattershot searching)
- **Don't** claim finding without validation (false positive risk)
- **Don't** skip correlation step (missing broader context)
- **Don't** report without confidence level (misleads stakeholders)

## Tools

| Tool | Purpose |
|------|---------|
| `rg` (ripgrep) | Pattern search in files |
| `git log` | History investigation |
| `semgrep` | AST-based pattern matching |
| `npm audit` | Dependency vulnerability check |

## Verification

For hypothesis framework changes:
```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/security-patterns.test.ts
```

*See also: `hunting-investigation-loop` skill for active hunting workflows.*