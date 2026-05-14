import * as fs from "node:fs";
import * as path from "node:path";
import { logInternalError } from "../utils/internal-error.ts";
import { sleepSync } from "../utils/sleep.ts";

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Symlink-safe file write guard (caveman-inspired).
 * Returns true if the path is safe to write, false if it's a symlink or
 * inside a symlinked directory owned by another user.
 */
function isSymlinkSafePath(filePath: string): boolean {
	try {
		const dir = path.dirname(filePath);
		// Check if parent directory is a symlink
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

export function renameWithRetry(tempPath: string, filePath: string, retries = 20, rename: (oldPath: string, newPath: string) => void = fs.renameSync): void {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			rename(tempPath, filePath);
			return;
		} catch (error) {
			lastError = error;
			if (!isRetryableRenameError(error) || attempt === retries) break;
			// Exponential backoff: 10ms, 20ms, 40ms, ..., capped at 500ms
			// Windows EPERM on rename can take longer when multiple processes contend
			sleepSync(Math.min(500, 10 * 2 ** attempt));
		}
	}
	throw lastError;
}

/** Test alias for renameWithRetry. */
export const __test__renameWithRetry = renameWithRetry;

export async function renameWithRetryAsync(tempPath: string, filePath: string, retries = 10, rename: (oldPath: string, newPath: string) => Promise<void> = (source, destination) => fs.promises.rename(source, destination)): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await rename(tempPath, filePath);
			return;
		} catch (error) {
			lastError = error;
			if (!isRetryableRenameError(error) || attempt === retries) break;
			await sleep(Math.min(500, 10 * 2 ** attempt));
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
		const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o644);
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
			// Fallback: if rename fails (Windows EPERM/EBUSY), try direct write.
			// This is less atomic but avoids data loss when concurrent writers contend.
			try {
				fs.writeFileSync(filePath, content, "utf-8");
			} catch {
				throw renameError;
			}
			try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
		}
	} catch (error) {
		let matches = false;
		try {
			const existing = fs.readFileSync(filePath, "utf-8");
			matches = existing === content;
		} catch {
			/* ignore */
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
		const fd = await fs.promises.open(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o644);
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
