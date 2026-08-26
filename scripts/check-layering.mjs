import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The layering gate (CLAUDE.md, "Where a file goes"). Four rules, all
 * mechanical, because a rule that needs judgment is a rule that drifts:
 *
 * 1. imports only ever point down the stack;
 * 2. a module under `application/` takes a port, or it is domain code in the
 *    wrong folder;
 * 3. no `types/` folder anywhere — types live with the layer that owns them;
 * 4. no folder holds more than MAX_FILES_PER_FOLDER source files.
 *
 * Existing violations live in `layering-baseline.json` and are not failures.
 * That file may only shrink: an entry that no longer violates is itself an
 * error, so fixing something forces you to prune it rather than leaving a
 * suppression behind that quietly re-authorises the next one.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const BASELINE_FILE = join(ROOT, "scripts", "layering-baseline.json");

/** Enough for a cohesive concept, few enough that a dumping ground shows up. */
const MAX_FILES_PER_FOLDER = 15;

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;
const RELATIVE_IMPORT = /\bfrom\s*["'](\.[^"']+)["']/g;

/**
 * Each stack, innermost first. A file may import from its own layer or any
 * layer earlier in its list, never a later one: the dependency arrow points
 * inward, always.
 */
const STACKS = [
	{
		name: "server",
		layers: [
			"src/domain",
			"src/application",
			"src/infrastructure",
			"src/interface",
		],
	},
	{
		name: "client",
		layers: [
			"src/client/src/domain",
			"src/client/src/infrastructure",
			"src/client/src/view",
			"src/client/src/pages",
		],
	},
];

/** The wire contract is shared on purpose; `check-dto-imports.mjs` guards it. */
const SHARED = "src/interface/http/dto";
const PORTS = "src/application/ports";

const violations = [];

function report(rule, where, message) {
	violations.push({ rule, where, message });
}

function sourceFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
			found.push(join(entry.parentPath, entry.name));
		}
	}
	return found;
}

/** Repo-relative, forward-slashed, so it reads the same on every platform. */
function repoPath(absolute) {
	return relative(ROOT, absolute).split(sep).join("/");
}

function layerOf(path) {
	for (const stack of STACKS) {
		// longest match first: src/client/src/domain also starts with src/
		const matches = stack.layers.filter((layer) =>
			path.startsWith(`${layer}/`),
		);
		const layer = matches.sort((a, b) => b.length - a.length)[0];
		if (layer !== undefined) {
			return { stack, layer, depth: stack.layers.indexOf(layer) };
		}
	}
	return null;
}

function importsOf(absolute) {
	const text = readFileSync(absolute, "utf8");
	const here = dirname(absolute);
	return [...text.matchAll(RELATIVE_IMPORT)].map((match) =>
		repoPath(resolve(here, match[1])),
	);
}

const files = sourceFiles(SRC).map((absolute) => ({
	absolute,
	path: repoPath(absolute),
}));

for (const file of files) {
	if (TEST_FILE.test(file.path)) {
		continue;
	}
	const from = layerOf(file.path);
	if (from === null) {
		continue;
	}
	const targets = importsOf(file.absolute);

	// 1. imports point down the stack
	for (const target of targets) {
		if (target.startsWith(`${SHARED}/`) || target === SHARED) {
			continue;
		}
		const to = layerOf(target);
		if (to === null || to.stack !== from.stack) {
			continue;
		}
		if (to.depth > from.depth) {
			report(
				"direction",
				file.path,
				`imports ${to.layer} from ${from.layer} — the arrow points inward`,
			);
		}
	}

	// 2. application code takes a port
	const isApplication =
		from.layer === "src/application" && !file.path.startsWith(`${PORTS}/`);
	if (isApplication && !targets.some((t) => t.startsWith(`${PORTS}/`))) {
		report(
			"placement",
			file.path,
			"takes no port, so it is domain code in the application layer",
		);
	}
}

// 3. no types/ folder
for (const file of files) {
	if (file.path.includes("/types/")) {
		report(
			"types-folder",
			file.path,
			"types live with the layer that owns them",
		);
	}
}

// 4. folder size
const perFolder = new Map();
for (const file of files) {
	if (TEST_FILE.test(file.path)) {
		continue;
	}
	const folder = dirname(file.path);
	perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
}
for (const [folder, count] of perFolder) {
	if (count > MAX_FILES_PER_FOLDER) {
		report(
			"folder-size",
			folder,
			`${count} source files, over the ${MAX_FILES_PER_FOLDER} a folder may hold`,
		);
	}
}

const key = (violation) => `${violation.rule} ${violation.where}`;
const baseline = new Set(JSON.parse(readFileSync(BASELINE_FILE, "utf8")));
const fresh = violations.filter((violation) => !baseline.has(key(violation)));
const stale = [...baseline].filter(
	(entry) => !violations.some((violation) => key(violation) === entry),
);

if (fresh.length === 0 && stale.length === 0) {
	const suppressed = baseline.size === 0 ? "" : `, ${baseline.size} baselined`;
	console.log(`layering: ${files.length} files checked — ok${suppressed}`);
	process.exit(0);
}

if (fresh.length > 0) {
	console.error("Layering violations (CLAUDE.md, 'Where a file goes'):");
	for (const violation of fresh) {
		console.error(`  ${violation.where}: ${violation.message}`);
	}
}
if (stale.length > 0) {
	console.error(
		"\nFixed, but still listed in scripts/layering-baseline.json — remove them:",
	);
	for (const entry of stale) {
		console.error(`  ${entry}`);
	}
}
process.exit(1);
