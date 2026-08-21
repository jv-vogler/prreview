import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The wire-contract purity gate (CON-002, ARCHITECTURE §2): every file under
 * src/interface/http/dto may import nothing but zod — plus siblings inside
 * the folder itself, which keeps shared sub-schemas in one place while the
 * transitive closure still reaches only zod. This is what makes the folder
 * safe for the browser bundle to import at runtime through the @dto alias.
 * Any violation fails `npm run lint` (and with it the build gate in CI).
 */
const DTO_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/interface/http/dto",
);
const ALLOWED_BARE_SPECIFIER = "zod";
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|mjs|cjs)$/;

// every syntax that can pull a module in: static import/export-from,
// dynamic import(), and require()
const SPECIFIER_PATTERNS = [
	/\bfrom\s*["']([^"']+)["']/g,
	/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	/^\s*import\s+["']([^"']+)["']/gm,
	/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const violations = [];
if (!existsSync(DTO_DIR)) {
	// mid-rewrite: the wire contract doesn't exist yet — nothing to violate
	console.log(
		"dto import rule: src/interface/http/dto does not exist yet — skipped",
	);
	process.exit(0);
}
for (const entry of readdirSync(DTO_DIR, {
	recursive: true,
	withFileTypes: true,
})) {
	if (!entry.isFile() || !SOURCE_FILE_PATTERN.test(entry.name)) {
		continue;
	}
	const filePath = join(entry.parentPath, entry.name);
	const text = readFileSync(filePath, "utf8");
	for (const pattern of SPECIFIER_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const specifier = match[1];
			if (!isAllowed(specifier, filePath)) {
				violations.push(`${filePath}: imports "${specifier}"`);
			}
		}
	}
}

function isAllowed(specifier, filePath) {
	if (specifier === ALLOWED_BARE_SPECIFIER) {
		return true;
	}
	if (!specifier.startsWith(".")) {
		return false;
	}
	const target = resolve(dirname(filePath), specifier);
	return target === DTO_DIR || target.startsWith(DTO_DIR + sep);
}

if (violations.length > 0) {
	console.error(
		"The wire contract (src/interface/http/dto) may import nothing but zod (CON-002):",
	);
	for (const violation of violations) {
		console.error(`  ${violation}`);
	}
	process.exit(1);
}
console.log("dto import rule: only zod (and in-folder siblings) imported — ok");
