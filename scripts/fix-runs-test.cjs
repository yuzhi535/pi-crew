const fs = require('fs');
let c = fs.readFileSync('test/unit/run-dashboard.test.ts', 'utf8');

// Fix: "Runs: 2" -> "2 runs" (new format)
c = c.replace(
    'assert.ok(lines.some((line) => line.includes("Runs: 2")));',
    'assert.ok(lines.some((line) => line.includes("2 runs")));'
);

fs.writeFileSync('test/unit/run-dashboard.test.ts', c);
console.log('Fixed Runs: test');
