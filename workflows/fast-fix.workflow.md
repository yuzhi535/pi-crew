---
name: fast-fix
description: Minimal workflow for small fixes
topology: sequential
---

## explore
role: explorer

Find the likely source of the issue: {goal}

## execute
role: executor
dependsOn: explore

Make the smallest safe fix.

## verify
role: verifier
dependsOn: execute
verify: true

Verify the fix with available evidence.
Run tests ONCE (cache to .crew/cache/), read changed files from executor context. Cross-reference test output with the fix. Do NOT re-run tests. Give PASS or FAIL with specific test evidence.
