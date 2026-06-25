import test from "node:test";
import assert from "node:assert/strict";
import { checkSubagentSpawnPermission, currentCrewRole } from "../../src/runtime/role-permission.ts";

test("read-only crew roles are denied recursive Agent/crew_agent spawning", () => {
	// Round 20: writer moved to WRITE_ROLES (P0 fix for parallel-research
	// incident) — see role-permission-cov.test.ts "workspace_write for writer".
	for (const role of ["explorer", "reviewer", "security-reviewer", "verifier", "analyst", "critic", "planner"]) {
		const denied = checkSubagentSpawnPermission(role);
		assert.equal(denied.allowed, false, role);
		assert.equal(denied.mode, "read_only", role);
		assert.match(denied.reason ?? "", /cannot spawn additional subagents/, role);
	}
});

test("write roles and parent sessions may spawn subagents", () => {
	assert.equal(checkSubagentSpawnPermission("executor").allowed, true);
	assert.equal(checkSubagentSpawnPermission("test-engineer").allowed, true);
	assert.equal(checkSubagentSpawnPermission("writer").allowed, true);
	assert.equal(checkSubagentSpawnPermission(undefined).allowed, true);
});

test("currentCrewRole prefers canonical PI_CREW_ROLE over legacy env", () => {
	assert.equal(currentCrewRole({ PI_CREW_ROLE: "executor", PI_TEAMS_ROLE: "explorer" } as NodeJS.ProcessEnv), "executor");
	assert.equal(currentCrewRole({ PI_TEAMS_ROLE: "explorer" } as NodeJS.ProcessEnv), "explorer");
});
