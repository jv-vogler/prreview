export interface DiffLine {
	type: "context" | "add" | "del";
	/** prefix character stripped */
	content: string;
	oldLine?: number;
	newLine?: number;
	noEol?: boolean;
}
