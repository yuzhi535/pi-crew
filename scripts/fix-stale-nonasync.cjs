const fs = require('fs');
let c = fs.readFileSync('src/state/active-run-registry.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Add stale non-async check
c = c.replace(
    `\t\t\t\t// Dead PID = stale async run
\t\t\t\tif (raw.async?.pid) {
\t\t\t\t\ttry { process.kill(raw.async.pid, 0); } catch { return false; }
\t\t\t\t}`,
    `\t\t\t\t// Dead PID = stale async run
\t\t\t\tif (raw.async?.pid) {
\t\t\t\t\ttry { process.kill(raw.async.pid, 0); } catch { return false; }
\t\t\t\t}
\t\t\t\t// Non-async run (live-session / scaffold) stale after 30 min with no update
\t\t\t\tif (!raw.async) {
\t\t\t\t\tconst updatedMs = Date.parse(raw.updatedAt ?? "");
\t\t\t\t\tif (Number.isFinite(updatedMs) && Date.now() - updatedMs > 30 * 60 * 1000) return false;
\t\t\t\t}`
);

fs.writeFileSync('src/state/active-run-registry.ts', c);
console.log('Added stale non-async filter');
