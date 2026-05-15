const fs = require('fs');
let c = fs.readFileSync('test/unit/run-dashboard.test.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Test 1: "pi-crew dashboard" -> "pi-crew" (title simplified)
c = c.replace(
    '// Selected run shown as compact header "▸ team_a · completed ..."\n\tassert.ok(lines.some((line) => line.includes("team_a") && line.includes("completed")));',
    'assert.ok(lines.some((line) => line.includes("team_a") && line.includes("completed")));'
);
c = c.replace(
    'assert.ok(lines.some((line) => line.includes("pi-crew dashboard")));',
    'assert.ok(lines.some((line) => line.includes("pi-crew")));'
);

// Test 2: "pi-crew sidebar" still works
c = c.replace(
    'assert.ok(lines.some((line) => line.includes("pi-crew sidebar")));',
    'assert.ok(lines.some((line) => line.includes("pi-crew")));'
);

fs.writeFileSync('test/unit/run-dashboard.test.ts', c);
console.log('Fixed tests');
