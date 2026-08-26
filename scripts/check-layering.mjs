import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const BASELINE_FILE = join(ROOT, "scripts", "layering-baseline.json");

const MAX_FILES_PER_FOLDER = 15;

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;

const RELATIVE_IMPORT_PATTERNS = [
	/\bfrom\s*["'](\.[^"']+)["']/g,
	/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
	/^\s*import\s+["'](\.[^"']+)["']/gm,
	/\brequire\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
];

const RULES_FILE = join(ROOT, "CLAUDE.md");
const DOCUMENTED_DOMAIN_FOLDER = /^\| `domain\/([A-Za-z]+)\/` \|/gm;

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

const SHARED = "src/interface/http/dto";
const PORTS = "src/application/ports";
const CLIENT = "src/client/";

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

function repoPath(absolute) {
	return relative(ROOT, absolute).split(sep).join("/");
}

function stackOf(path) {
	if (path.startsWith(CLIENT)) {
		return "client";
	}
	return path.startsWith("src/") ? "server" : null;
}

function layerOf(path) {
	for (const stack of STACKS) {
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
	return RELATIVE_IMPORT_PATTERNS.flatMap((pattern) =>
		[...text.matchAll(pattern)].map((match) =>
			repoPath(resolve(here, match[1])),
		),
	);
}

function domainFolders() {
	return readdirSync(join(SRC, "domain"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

const files = sourceFiles(SRC).map((absolute) => ({
	absolute,
	path: repoPath(absolute),
	targets: importsOf(absolute),
}));

for (const file of files) {
	if (TEST_FILE.test(file.path)) {
		continue;
	}
	const fromStack = stackOf(file.path);
	for (const target of file.targets) {
		if (target === SHARED || target.startsWith(`${SHARED}/`)) {
			continue;
		}
		const toStack = stackOf(target);
		if (toStack !== null && toStack !== fromStack) {
			report(
				"boundary",
				file.path,
				`imports ${target} across the server/client boundary — ${SHARED} is the only code they share`,
			);
		}
	}
}

for (const file of files) {
	if (TEST_FILE.test(file.path)) {
		continue;
	}
	const from = layerOf(file.path);
	if (from === null) {
		continue;
	}
	const targets = file.targets;

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

for (const file of files) {
	if (file.path.includes("/types/")) {
		report(
			"types-folder",
			file.path,
			"types live with the layer that owns them",
		);
	}
}

const documentedFolders = new Set(
	[...readFileSync(RULES_FILE, "utf8").matchAll(DOCUMENTED_DOMAIN_FOLDER)].map(
		(match) => match[1],
	),
);
for (const folder of domainFolders()) {
	if (!documentedFolders.has(folder)) {
		report(
			"undocumented",
			`src/domain/${folder}`,
			"no row in CLAUDE.md's folder table says what this holds",
		);
	}
}
for (const folder of documentedFolders) {
	if (!existsSync(join(SRC, "domain", folder))) {
		report(
			"undocumented",
			"CLAUDE.md",
			`the folder table has a row for domain/${folder}/, which does not exist`,
		);
	}
}

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
