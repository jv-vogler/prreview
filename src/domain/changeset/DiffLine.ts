export interface DiffLine {
	type: "context" | "add" | "del";
	content: string;
	oldLine?: number;
	newLine?: number;
	noEol?: boolean;
}
