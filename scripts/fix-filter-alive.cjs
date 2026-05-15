const fs = require('fs');
let c = fs.readFileSync('src/state/active-run-registry.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Add PID liveness to filterAliveEntries
const old = `function filterAliveEntries(entries: ActiveRunRegistryEntry[]): ActiveRunRegistryEntry[] {
	return entries.filter((entry) => {
		// Quick checks first — skip heavy manifest read if CWD or state dir is gone
		try {
			if (!fs.existsSync(entry.cwd)) return false;
			if (!fs.existsSync(entry.manifestPath)) return false;
		} catch {
			return false;
		}
		// Only read manifest if quick checks pass
		try {
			const raw = JSON.parse(fs.readFileSync(entry.manifestPath, "utf-8")) as { status?: string };
			if (TERMINAL_STATUSES.has(raw.status ?? "")) return false;
		} catch {
			return false;
		}
		return true;
	});
}`;

const rep = `function filterAliveEntries(entries: ActiveRunRegistryEntry[]): ActiveRunRegistryEntry[] {
	return entries.filter((entry) => {
		try {
			if (!fs.existsSync(entry.cwd)) return false;
			if (!fs.existsSync(entry.manifestPath)) return false;
		} catch {
			return false;
		}
		try {
			const raw = JSON.parse(fs.readFileSync(entry.manifestPath, "utf-8")) as { status?: string; async?: { pid?: number } };
			if (TERMINAL_STATUSES.has(raw.status ?? "")) return false;
			// Dead PID = stale async run
			if (raw.async?.pid) {
				try { process.kill(raw.async.pid, 0); } catch { return false; }
			}
		} catch {
			return false;
		}
		return true;
	});
}`;

if (!c.includes(old)) { console.error('Cannot find filterAliveEntries'); process.exit(1); }
c = c.replace(old, rep);
fs.writeFileSync('src/state/active-run-registry.ts', c);
console.log('Added PID check to filterAliveEntries');
