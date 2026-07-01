/**
 * deterministic-ast.ts — AST-based determinism enforcement for dynamic-workflow scripts (round-13 P0-2).
 *
 * Rejects `Date.now()`, `Math.random()`, and `new Date()` at workflow-load time
 * using a true AST walk (not regex) so that:
 *   - Prompts mentioning "Date.now()" as string literals are accepted.
 *   - Comments containing "Date.now()" are accepted.
 *   - `Date.parse()`, `Date.UTC()`, `Math.floor()`, etc. are accepted (only `now` and `random` are blocked).
 *   - `new Date(0)` with deterministic arguments is accepted (only `new Date()` without args is blocked).
 *
 * Adapted from pi-dynamic-workflows/src/workflow.ts (MIT) — see NOTICE.md.
 *
 * The walker uses acorn's parse() with permissive flags (allowAwaitOutsideFunction,
 * allowReturnOutsideFunction). For .dwf.ts TypeScript sources, type annotations are
 * stripped via TypeScript's transpileModule before feeding to acorn, so the
 * determinism check actually works on real-world TypeScript workflows (acorn alone
 * cannot parse TS syntax).
 *
 * On parse error (JS) or transpile error (TS), this function returns silently: jiti
 * will surface a clearer parse/build error downstream. We don't double-report. */

import { parse } from "acorn";
import ts from "typescript";

const NONDETERMINISM_ERROR =
	"Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable. These introduce non-reproducible behavior across runs. Use ctx.vars for cached state, or pass a fixed seed via ctx.setArgs(). To bypass this check (escape hatch), set PI_CREW_DWF_SKIP_DETERMINISM_CHECK=1.";

export class DeterminismError extends Error {
	constructor() {
		super(NONDETERMINISM_ERROR);
		this.name = "DeterminismError";
	}
}

/**
 * Parse `script` and walk the AST looking for non-deterministic calls.
 * Throws DeterminismError on the first hit. Silently returns on parse
 * or transpile error (jiti will produce a clearer message downstream).
 *
 * For .ts scripts: TypeScript types are stripped via `ts.transpileModule`
 * before feeding to acorn, so real-world TS workflows (with type annotations,
 * interfaces, generics, etc.) are properly checked instead of silently skipped.
 */
export function assertDeterministicScript(script: string, isTypeScript = false): void {
	let jsSource = script;
	if (isTypeScript) {
		try {
			const result = ts.transpileModule(script, {
				compilerOptions: {
					target: ts.ScriptTarget.ESNext,
					module: ts.ModuleKind.ESNext,
					// Strip all type-only constructs: interfaces, type aliases, annotations, etc.
				},
			});
			jsSource = result.outputText;
		} catch {
			// Transpile errors are handled by jiti downstream — don't double-report.
			return;
		}
	}
	let ast: AstNode;
	try {
		ast = parse(jsSource, {
			ecmaVersion: "latest",
			sourceType: "module",
			allowAwaitOutsideFunction: true,
			allowReturnOutsideFunction: true,
			ranges: false,
		}) as unknown as AstNode;
	} catch {
		// Parse errors are handled by jiti downstream — don't double-report.
		return;
	}
	assertDeterministicAst(ast);
}

/**
 * Escape hatch: when PI_CREW_DWF_SKIP_DETERMINISM_CHECK=1 the check is bypassed.
 * Power users may need this when a workflow legitimately depends on time/random
 * (e.g. randomized benchmark scripts).
 */
export function isDeterminismCheckEnabled(): boolean {
	return process.env.PI_CREW_DWF_SKIP_DETERMINISM_CHECK !== "1";
}

// ---------------------------------------------------------------------------
// AST walker
// ---------------------------------------------------------------------------

interface AstNode {
	type: string;
	[key: string]: unknown;
}

function asAstNode(value: unknown): AstNode | undefined {
	if (!value || typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	if (typeof obj.type !== "string") return undefined;
	return obj as AstNode;
}

function astChildren(node: AstNode): AstNode[] {
	const out: AstNode[] = [];
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				const child = asAstNode(item);
				if (child) out.push(child);
			}
		} else {
			const child = asAstNode(value);
			if (child) out.push(child);
		}
	}
	return out;
}

function assertDeterministicAst(node: AstNode): void {
	if (isDateNowCall(node) || isMathRandomCall(node) || isNewDateExpression(node)) {
		throw new DeterminismError();
	}
	for (const child of astChildren(node)) assertDeterministicAst(child);
}

function isDateNowCall(node: AstNode): boolean {
	return node.type === "CallExpression" && isMemberExpression(node, "callee", "Date", "now");
}

function isMathRandomCall(node: AstNode): boolean {
	return node.type === "CallExpression" && isMemberExpression(node, "callee", "Math", "random");
}

function isNewDateExpression(node: AstNode): boolean {
	if (node.type !== "NewExpression") return false;
	const callee = unwrapSequence(asAstNode(node.callee));
	if (callee?.type !== "Identifier" || callee.name !== "Date") return false;
	// Only flag `new Date()` without arguments (non-deterministic current time).
	// `new Date(0)`, `new Date(2024, 0, 1)`, etc. are fully deterministic.
	const args = node.arguments as unknown[] | undefined;
	return !Array.isArray(args) || args.length === 0;
}

/**
 * Test whether `node[childKey]` is a MemberExpression of shape `objectName.propertyName`,
 * where the property is either a static Identifier or a resolvable static string.
 * `childKey` is the property name on `node` (usually "callee" for CallExpression).
 *
 * Unwraps SequenceExpression (comma operator) so that `(0, Date).now()` is detected.
 */
function isMemberExpression(node: AstNode, childKey: string, objectName: string, propertyName: string): boolean {
	const child = asAstNode(node[childKey]);
	if (!child || child.type !== "MemberExpression") return false;
	const object = unwrapSequence(asAstNode(child.object));
	if (!object || object.type !== "Identifier" || object.name !== objectName) return false;
	return propertyNameOf(child) === propertyName;
}

/** Unwrap SequenceExpression (comma operator) to get the terminal expression. */
function unwrapSequence(node: AstNode | undefined): AstNode | undefined {
	if (!node) return undefined;
	if (node.type !== "SequenceExpression") return node;
	const exprs = node.expressions as unknown[] | undefined;
	if (!Array.isArray(exprs) || exprs.length === 0) return node;
	return asAstNode(exprs[exprs.length - 1]);
}

function propertyNameOf(node: AstNode): string | undefined {
	const computed = node.computed === true;
	const property = asAstNode(node.property);
	if (!property) return undefined;
	if (!computed && property.type === "Identifier") {
		return property.name as string | undefined;
	}
	return staticStringOf(property);
}

function staticStringOf(node: AstNode | undefined): string | undefined {
	if (!node) return undefined;
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	if (node.type === "TemplateLiteral") {
		const expressions = node.expressions;
		if (Array.isArray(expressions) && expressions.length > 0) return undefined;
		const quasis = node.quasis;
		if (!Array.isArray(quasis)) return undefined;
		return quasis
			.map((q) => {
				const quasi = asAstNode(q);
				const value = quasi?.value as { cooked?: string; raw?: string } | undefined;
				return value?.cooked ?? value?.raw ?? "";
			})
			.join("");
	}
	if (node.type === "BinaryExpression" && node.operator === "+") {
		const left = staticStringOf(asAstNode(node.left));
		const right = staticStringOf(asAstNode(node.right));
		if (left !== undefined && right !== undefined) return left + right;
	}
	return undefined;
}
