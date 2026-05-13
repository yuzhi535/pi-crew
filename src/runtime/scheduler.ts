export type ScheduleType = "cron" | "once" | "interval";

export interface ScheduledJob {
	id: string;
	name: string;
	description: string;
	schedule: string;
	scheduleType: ScheduleType;
	intervalMs?: number;
	subagentType: string;
	prompt: string;
	enabled: boolean;
	createdAt: string;
	lastRun?: string;
	lastStatus?: "success" | "error" | "running";
	nextRun?: string;
	runCount: number;
}

export type ScheduleChangeEvent =
	| { type: "added"; job: ScheduledJob }
	| { type: "removed"; jobId: string }
	| { type: "updated"; job: ScheduledJob }
	| { type: "fired"; jobId: string; agentId: string; name: string }
	| { type: "error"; jobId: string; error: string };

export class CrewScheduler {
	private jobs = new Map<string, ScheduledJob>();
	private timers = new Map<string, ReturnType<typeof setInterval | typeof setTimeout>>();
	private emit?: (event: ScheduleChangeEvent) => void;
	private executor?: (job: ScheduledJob) => string;
	private finalizer?: (jobId: string, agentId: string) => void;

	start(
		options: {
			emit: (event: ScheduleChangeEvent) => void;
			executor: (job: ScheduledJob) => string;
			finalizer: (jobId: string, agentId: string) => void;
		},
	): void {
		this.emit = options.emit;
		this.executor = options.executor;
		this.finalizer = options.finalizer;
	}

	stop(): void {
		for (const t of this.timers.values()) {
			clearInterval(t as ReturnType<typeof setInterval>);
			clearTimeout(t as ReturnType<typeof setTimeout>);
		}
		this.timers.clear();
		this.emit = undefined;
		this.executor = undefined;
		this.finalizer = undefined;
	}

	add(job: ScheduledJob): void {
		this.jobs.set(job.id, job);
		if (job.enabled) this.arm(job);
		this.emit?.({ type: "added", job });
	}

	remove(id: string): boolean {
		this.disarm(id);
		const ok = this.jobs.delete(id);
		if (ok) this.emit?.({ type: "removed", jobId: id });
		return ok;
	}

	update(id: string, patch: Partial<ScheduledJob>): ScheduledJob | undefined {
		const existing = this.jobs.get(id);
		if (!existing) return undefined;
		this.disarm(id);
		const updated = { ...existing, ...patch };
		this.jobs.set(id, updated);
		if (updated.enabled) this.arm(updated);
		this.emit?.({ type: "updated", job: updated });
		return updated;
	}

	list(): ScheduledJob[] {
		return [...this.jobs.values()];
	}

	private arm(job: ScheduledJob): void {
		if (this.timers.has(job.id)) return;
		if (job.scheduleType === "interval" && job.intervalMs) {
			const t = setInterval(() => this.fire(job.id), job.intervalMs);
			this.timers.set(job.id, t);
		} else if (job.scheduleType === "once") {
			const target = new Date(job.schedule).getTime();
			const delay = target - Date.now();
			if (delay > 0) {
				const t = setTimeout(() => {
					this.fire(job.id);
					this.update(job.id, { enabled: false });
				}, delay);
				this.timers.set(job.id, t);
			} else {
				this.update(job.id, { enabled: false, lastStatus: "error" });
				this.emit?.({ type: "error", jobId: job.id, error: `Scheduled time ${job.schedule} is in the past` });
			}
		}
	}

	private disarm(id: string): void {
		const t = this.timers.get(id);
		if (t) {
			clearInterval(t as ReturnType<typeof setInterval>);
			clearTimeout(t as ReturnType<typeof setTimeout>);
			this.timers.delete(id);
		}
	}

	private fire(id: string): void {
		const job = this.jobs.get(id);
		if (!job?.enabled || !this.executor) return;
		this.update(id, { lastStatus: "running" });
		let agentId: string;
		try {
			agentId = this.executor(job);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this.update(id, { lastRun: new Date().toISOString(), lastStatus: "error" });
			this.emit?.({ type: "error", jobId: id, error });
			return;
		}
		this.emit?.({ type: "fired", jobId: id, agentId, name: job.name });
		this.finalizer?.(id, agentId);
	}

	static detectSchedule(s: string): { type: ScheduleType; intervalMs?: number; normalized: string } {
		const trimmed = s.trim();
		// Relative: +10m
		const rel = trimmed.match(/^\+(\d+)(s|m|h|d)$/);
		if (rel) {
			const ms = parseInt(rel[1], 10) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as "s" | "m" | "h" | "d"];
			return { type: "once", normalized: new Date(Date.now() + ms).toISOString() };
		}
		// Interval: 5m
		const ivl = trimmed.match(/^(\d+)(s|m|h|d)$/);
		if (ivl) {
			const ms = parseInt(ivl[1], 10) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[ivl[2] as "s" | "m" | "h" | "d"];
			return { type: "interval", intervalMs: ms, normalized: trimmed };
		}
		// ISO timestamp
		if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
			const d = new Date(trimmed);
			if (!Number.isNaN(d.getTime())) {
				if (d.getTime() <= Date.now()) throw new Error(`Scheduled time ${d.toISOString()} is in the past.`);
				return { type: "once", normalized: d.toISOString() };
			}
		}
		// Simple cron-like (5 fields)
		const cronFields = trimmed.split(/\s+/);
		if (cronFields.length >= 5) {
			return { type: "cron", normalized: trimmed };
		}
		throw new Error(`Invalid schedule "${s}". Use "5m", "+10m", ISO timestamp, or cron expression.`);
	}
}
