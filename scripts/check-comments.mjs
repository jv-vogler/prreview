import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["src", "scripts", "test", "e2e"];
const SOURCE_FILE = /\.(?:ts|tsx|mjs|js|css)$/;

const DIRECTIVES = [
	"biome-ignore",
	"@ts-expect-error",
	"@ts-ignore",
	"eslint-",
	"stylelint-",
	"<reference",
];

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%~^<>".split(""));

function endOfQuoted(text, start, quote) {
	let at = start + 1;
	while (at < text.length) {
		if (text[at] === "\\") {
			at += 2;
		} else if (text[at] === quote) {
			return at + 1;
		} else {
			at += 1;
		}
	}
	return at;
}

function endOfRegex(text, start) {
	let at = start + 1;
	let inClass = false;
	while (at < text.length && text[at] !== "\n") {
		if (text[at] === "\\") {
			at += 2;
		} else if (text[at] === "[" || text[at] === "]") {
			inClass = text[at] === "[";
			at += 1;
		} else if (text[at] === "/" && !inClass) {
			return at + 1;
		} else {
			at += 1;
		}
	}
	return at;
}

function endOf(text, start, marker) {
	const at = text.indexOf(marker, start + 2);
	return at === -1 ? text.length : at + marker.length;
}

function newlinesIn(text, from, to) {
	let count = 0;
	for (let at = from; at < to; at += 1) {
		if (text[at] === "\n") {
			count += 1;
		}
	}
	return count;
}

function comments(text, css) {
	const found = [];
	let index = 0;
	let line = 1;
	let previous = "";

	while (index < text.length) {
		const here = text[index];
		const pair = text.slice(index, index + 2);
		let end = index + 1;

		if (pair === "//" && !css) {
			end = endOf(text, index, "\n") - 1;
			found.push({ line, body: text.slice(index, end) });
		} else if (pair === "/*") {
			end = endOf(text, index, "*/");
			found.push({ line, body: text.slice(index, end) });
		} else if (here === "'" || here === '"' || (here === "`" && !css)) {
			end = endOfQuoted(text, index, here);
			previous = here;
		} else if (here === "/" && !css && REGEX_PRECEDERS.has(previous)) {
			end = endOfRegex(text, index);
			previous = "/";
		} else if (!/\s/.test(here)) {
			previous = here;
		}

		line += newlinesIn(text, index, end);
		index = end;
	}
	return found;
}

function sourceFiles() {
	const found = [];
	for (const root of ROOTS) {
		for (const entry of readdirSync(join(ROOT, root), {
			recursive: true,
			withFileTypes: true,
		})) {
			const mock =
				entry.name === "claude" && entry.parentPath.includes("mock-agent");
			if (entry.isFile() && (SOURCE_FILE.test(entry.name) || mock)) {
				found.push(join(entry.parentPath, entry.name));
			}
		}
	}
	return found;
}

const files = sourceFiles();
const offenders = files.flatMap((path) =>
	comments(readFileSync(path, "utf8"), path.endsWith(".css"))
		.filter((comment) => !DIRECTIVES.some((d) => comment.body.includes(d)))
		.map(
			(comment) =>
				`${relative(ROOT, path).split(sep).join("/")}:${comment.line}`,
		),
);

if (offenders.length === 0) {
	console.log(`comments: ${files.length} files checked — ok`);
	process.exit(0);
}

console.error(
	"Comments are not how this codebase explains itself (CLAUDE.md, 'How code is written').",
);
console.error(
	"Name it better, split it smaller, or write a test whose name says it. Only tool directives are allowed:",
);
for (const offender of offenders.slice(0, 40)) {
	console.error(`  ${offender}`);
}
if (offenders.length > 40) {
	console.error(`  … and ${offenders.length - 40} more`);
}
process.exit(1);
