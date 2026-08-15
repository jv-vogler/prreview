const LOCKFILE_NAMES = new Set([
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	"bun.lockb",
	"deno.lock",
	"Cargo.lock",
	"Gemfile.lock",
	"composer.lock",
	"poetry.lock",
	"uv.lock",
	"Pipfile.lock",
	"go.sum",
	"flake.lock",
	"Podfile.lock",
]);

const GENERATED_DIRECTORY_NAMES = new Set(["dist", "vendor"]);

const MINIFIED_MARKER = ".min.";
const SOURCE_MAP_EXTENSION = ".map";

/**
 * Heuristic: files nobody reviews line by line (lockfiles, minified bundles,
 * build output, vendored code, source maps). Used for attention ordering and
 * collapsed-by-default rendering, never to drop files from the changeset.
 */
export function isGenerated(path: string): boolean {
	const segments = path.split("/");
	const basename = segments[segments.length - 1] ?? "";

	if (LOCKFILE_NAMES.has(basename)) {
		return true;
	}
	if (basename.includes(MINIFIED_MARKER)) {
		return true;
	}
	if (basename.endsWith(SOURCE_MAP_EXTENSION)) {
		return true;
	}
	return segments
		.slice(0, -1)
		.some((directory) => GENERATED_DIRECTORY_NAMES.has(directory));
}
