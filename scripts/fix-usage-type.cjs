const fs = require('fs');
let c = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');
// Fix possibly-undefined usage
c = c.replace(
    'const tok = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);',
    'const u = usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };\n\t\t\t\t\tconst tok = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);'
);
fs.writeFileSync('src/ui/run-dashboard.ts', c);
console.log('Fixed usage type');
