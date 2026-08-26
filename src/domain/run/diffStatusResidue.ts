export function diffStatusResidue(before: string, after: string): string[] {
	const beforeLines = new Set(porcelainPaths(before));
	return porcelainPaths(after).filter((path) => !beforeLines.has(path));
}

function porcelainPaths(porcelain: string): string[] {
	return porcelain
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => line.slice(3).trim());
}
