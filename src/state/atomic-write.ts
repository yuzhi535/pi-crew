import * as fs from "node:fs";
import * as path from "node:path";
import { logInternalError } from "../utils/internal-error.ts";
import { sleepSync } from "../utils/sleep.ts";

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Symlink-safe file write guard (caveman-inspired).
 * Returns true if the path is safe to write, false if it's a symlink or
 * inside a symlinked directory owned by another user.
 *
 * This walks the full ancestor chain to detect any symlinks in the path,
 * preventing attacks where an intermediate ancestor is a symlink.
 */
export function isSymlinkSafePath(filePath: string): boolean {
	try {
		// Walk the full ancestor chain to detect any symlinks
		let currentPath = filePath;
		while (currentPath !== path.dirname(currentPath)) {
			const dir = path.dirname(currentPath);
			try {
				const dirStat = fs.lstatSync(dir);
				if (dirStat.isSymbolicLink()) {
					// Resolve and verify ownership on Unix
					const realDir = fs.realpathSync(dir);
					const realStat = fs.statSync(realDir);
					if (!realStat.isDirectory()) return false;
					if (typeof process.getuid === "function" && realStat.uid !== process.getuid()) return false;
				}
			} catch {
				// Directory doesn't exist yet — that's OK, mkdirSync will create it
			}
			currentPath = dir;
		}

		// Check if target file itself is a symlink
		try {
			const fileStat = fs.lstatSync(filePath);
			if (fileStat.isSymbolicLink()) return false;
		} catch {
			// File doesn't exist yet — that's OK
		}

		return true;
	} catch {
		return false;
	}
}



function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRenameError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && RETRYABLE_RENAME_CODES.has(String((error as NodeJS.ErrnoException).code)));
}

export function renameWithRetry(tempPath: string, filePath: string, retries = 8, rename: (oldPath: string, newPath: string) => void = fs.renameSync): void {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			rename(tempPath, filePath);
			return;
		} catch (error) {
			lastError = error;
			if (!isRetryableRenameError(error) || attempt === retries) break;
			// 3.4: exponential backoff with ±20% jitter, capped at 500ms.
			// Without jitter, multiple processes contending on the same file
			// retry in lockstep and starve each other.
			const base = Math.min(500, 10 * 2 ** attempt);
			const jitter = base * 0.2 * (Math.random() * 2 - 1);
			sleepSync(Math.max(1, Math.round(base + jitter)));
		}
	}
	throw lastError;
}

/** Test alias for renameWithRetry. */
export const __test__renameWithRetry = renameWithRetry;

export async function renameWithRetryAsync(tempPath: string, filePath: string, retries = 8, rename: (oldPath: string, newPath: string) => Promise<void> = (source, destination) => fs.promises.rename(source, destination)): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await rename(tempPath, filePath);
			return;
		} catch (error) {
			lastError = error;
			if (!isRetryableRenameError(error) || attempt === retries) break;
			// 3.4: same jitter as renameWithRetry.
			const base = Math.min(500, 10 * 2 ** attempt);
			const jitter = base * 0.2 * (Math.random() * 2 - 1);
			await sleep(Math.max(1, Math.round(base + jitter)));
		}
	}
	throw lastError;
}

/** Test alias for renameWithRetryAsync. */
export const __test__renameWithRetryAsync = renameWithRetryAsync;

export function atomicWriteFile(filePath: string, content: string): void {
	if (!isSymlinkSafePath(filePath)) throw new Error(`Refusing to write: target is a symlink or inside untrusted directory: ${filePath}`);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	// Write temp with restrictive permissions
	const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
	try {
		const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
		// Post-open verification: on Windows O_NOFOLLOW is 0, so verify FD is a regular file
		const openedStat = fs.fstatSync(fd);
		if (!openedStat.isFile()) {
			fs.closeSync(fd);
			throw new Error(`Refusing to write: opened path is not a regular file: ${tempPath}`);
		}
		fs.writeSync(fd, content, undefined, "utf-8");
		fs.closeSync(fd);
		try {
			renameWithRetry(tempPath, filePath);
		} catch (renameError) {
			// H3 fix: re-check symlink safety before fallback.
			// Between isSymlinkSafePath at top and rename attempt, the file
			// could have been replaced with a symlink (TOCTOU). Refuse if so.
			try {
				const lstat = fs.lstatSync(filePath);
				if (lstat.isSymbolicLink()) {
					try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
					throw renameError;
				}
			} catch (checkError) {
				// Only ENOENT / ENOTDIR means the file genuinely doesn't exist — safe to proceed.
				// Re-throw everything else (EACCES, EPERM, EBUSY, etc.)
				const code = (checkError as NodeJS.ErrnoException).code;
				if (code !== "ENOENT" && code !== "ENOTDIR") {
					throw checkError;
				}
			}
			// Fallback: if rename fails (Windows EPERM/EBUSY), try direct write.
			// This is less atomic but avoids data loss when concurrent writers contend.
			// Re-check symlink safety before fallback to prevent TOCTOU attack.
			if (!isSymlinkSafePath(filePath)) {
				try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
				throw new Error(`Refusing to write: target is a symlink or inside untrusted directory: ${filePath}`);
			}
			try {
				fs.writeFileSync(filePath, content, "utf-8");
			} catch {
				throw renameError;
			}
			try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
		}
	} catch (error) {
		// Issue 2 fix: wrap content-match read in nested try-catch that always
		// cleans up the temp file before re-throwing, preventing orphaned temps.
		let matches = false;
		try {
			const existing = fs.readFileSync(filePath, "utf-8");
			matches = existing === content;
		} catch (readError) {
			// Clean up temp file before re-throwing, then re-throw the original error
			try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
			throw error;
		}
		if (matches) {
			try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
			return;
		}
		try {
			fs.rmSync(tempPath, { force: true });
		} catch (cleanupError) {
			logInternalError("atomic-write.cleanup", cleanupError, `tempPath=${tempPath}`);
		}
		throw error;
	}
}


export async function atomicWriteFileAsync(filePath: string, content: string): Promise<void> {
	if (!isSymlinkSafePath(filePath)) throw new Error(`Refusing to write: target is a symlink or inside untrusted directory: ${filePath}`);
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
		const fd = await fs.promises.open(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
		// Post-open verification: on Windows O_NOFOLLOW is 0, so verify FD is a regular file
		const openedStat = await fd.stat();
		if (!openedStat.isFile()) {
			await fd.close();
			throw new Error(`Refusing to write: opened path is not a regular file: ${tempPath}`);
		}
		await fd.writeFile(content, "utf-8");
		await fd.close();
		try {
			await renameWithRetryAsync(tempPath, filePath);
		} catch (renameError) {
			let matches = false;
			try {
				const existing = await fs.promises.readFile(filePath, "utf-8");
				matches = existing === content;
			} catch {
				/* ignore */
			}
			if (matches) {
				try {
					await fs.promises.rm(tempPath, { force: true });
				} catch (cleanupError) {
					logInternalError("atomic-write.cleanupAsync", cleanupError, `tempPath=${tempPath}`);
				}
				return;
			}
			throw renameError;
		}
	} catch (error) {
		try {
			await fs.promises.rm(tempPath, { force: true });
		} catch (cleanupError) {
			logInternalError("atomic-write.cleanupAsync", cleanupError, `tempPath=${tempPath}`);
		}
		throw error;
	}
}


export function atomicWriteJson<T>(filePath: string, value: T): void {
	atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteJsonAsync<T>(filePath: string, value: T): Promise<void> {
	await atomicWriteFileAsync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// 2.1 — atomic-write coalescer. Buffer the latest payload per filePath and
// flush after `coalesceMs` ms (default 50). Multiple writes to the same
// path within the window collapse to one disk write (last value wins),
// which is exactly the semantic that team-runner.ts merge loops need for
// `saveRunTasks` and similar high-frequency state-store paths.
//
// Caveat: a `readJsonFile` call between buffer and flush sees the previous
// on-disk content. Callers that need read-after-write within the window
// must invoke `flushPendingAtomicWrites()` first (or pass through
// `atomicWriteJson` which flushes synchronously).
//
// Auto-flush hooks: process exit / SIGTERM / SIGINT, plus an exposed
// `flushPendingAtomicWrites()` for cleanupRuntime.
interface CoalescedAtomicWrite {
	content: string;
	timer: ReturnType<typeof setTimeout>;
}
const pendingAtomicWrites = new Map<string, CoalescedAtomicWrite>();
const DEFAULT_ATOMIC_COALESCE_MS = 50;

// Issue 5 fix: guard against concurrent flushes
let flushInProgress = false;

export function atomicWriteJsonCoalesced<T>(filePath: string, value: T, coalesceMs = DEFAULT_ATOMIC_COALESCE_MS): void {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	const previous = pendingAtomicWrites.get(filePath);
	if (previous) clearTimeout(previous.timer);
	const timer = setTimeout(() => flushOnePendingAtomicWrite(filePath), coalesceMs);
	timer.unref();
	pendingAtomicWrites.set(filePath, { content, timer });
}

function flushOnePendingAtomicWrite(filePath: string): void {
	const entry = pendingAtomicWrites.get(filePath);
	if (!entry) return;
	pendingAtomicWrites.delete(filePath);
	clearTimeout(entry.timer);
	try {
		atomicWriteFile(filePath, entry.content);
	} catch (error) {
		logInternalError("atomic-write.coalesced-flush", error, filePath);
	}
}

/** Flush every queued coalesced write synchronously. Safe to call any time. */
export function flushPendingAtomicWrites(): void {
	if (flushInProgress) return;
	flushInProgress = true;
	try {
		for (const filePath of [...pendingAtomicWrites.keys()]) flushOnePendingAtomicWrite(filePath);
	} finally {
		flushInProgress = false;
	}
}

// Defense-in-depth: signal handlers must return immediately.
// Use setImmediate so the handler exits before any sync I/O runs.
// This prevents the main thread from being blocked if a signal
// arrives while the user is idle in the terminal.
process.on("exit", () => flushPendingAtomicWrites());
process.on("SIGTERM", () => setImmediate(() => flushPendingAtomicWrites()));
process.on("SIGINT", () => setImmediate(() => flushPendingAtomicWrites()));

export function readJsonFile<T>(filePath: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTDIR") {
			logInternalError("readJsonFile", err, `filePath=${filePath}`);
		}
		return undefined;
	}
}
