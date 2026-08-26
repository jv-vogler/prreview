const VERSION_TOKEN = /\d+\.\d+[^\s]*/;

export function parseAgentVersion(output: string): string {
	return output.match(VERSION_TOKEN)?.[0] ?? output.trim();
}
