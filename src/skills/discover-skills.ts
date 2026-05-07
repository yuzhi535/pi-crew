import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

export interface SkillDescriptor {
	name: string;
	description: string;
	source: "project" | "package";
	path: string;
}

function listSkillDirs(cwd: string): Array<{ root: string; source: "project" | "package" }> {
	return [
		{ root: path.resolve(cwd, "skills"), source: "project" },
		{ root: PACKAGE_SKILLS_DIR, source: "package" },
	];
}

function frontmatterDescription(content: string): string | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match) return undefined;
	const line = match[1].split(/\r?\n/).find((entry) => entry.startsWith("description:"));
	return line?.slice("description:".length).trim();
}

export function discoverSkills(cwd: string): SkillDescriptor[] {
	const results: SkillDescriptor[] = [];
	for (const dir of listSkillDirs(cwd)) {
		if (!fs.existsSync(dir.root)) continue;
		try {
			for (const entry of fs.readdirSync(dir.root, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const skillMd = path.join(dir.root, entry.name, "SKILL.md");
				if (!fs.existsSync(skillMd)) continue;
				let description = "";
				try {
					const content = fs.readFileSync(skillMd, "utf-8");
					description = frontmatterDescription(content) ?? "";
				} catch { /* skip unreadable */ }
				results.push({ name: entry.name, description, source: dir.source, path: skillMd });
			}
		} catch { /* skip unreadable */ }
	}
	return results;
}
