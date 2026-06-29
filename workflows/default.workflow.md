---
name: default
description: Explore, plan, execute, and verify
topology: sequential
---

## explore
role: explorer

Explore the codebase for the goal: {goal}

## plan
role: planner
dependsOn: explore
output: plan.md

Create a concise implementation plan for: {goal}

## execute
role: executor
dependsOn: plan

Implement the plan for: {goal}

## verify
role: verifier
dependsOn: execute
verify: true

Verify completion for: {goal}
Run tests ONCE (cache to .crew/cache/), read changed files from executor context. Cross-reference test output with the changes. Do NOT re-run tests. Give PASS or FAIL with specific test evidence.
