import type { AnnotationMetadata } from "./annotations";

const SPECIES_STYLE: Record<
	AnnotationMetadata["species"],
	React.CSSProperties
> = {
	note: {
		borderLeft: "4px solid var(--card-note)",
		background: "var(--card-note-bg)",
	},
	warning: {
		borderLeft: "4px solid var(--card-warning)",
		background: "var(--card-warning-bg)",
	},
	suggestion: {
		borderLeft: "4px solid var(--card-suggestion)",
		background: "var(--card-suggestion-bg)",
	},
};

export function AnnotationCard({ metadata }: { metadata: AnnotationMetadata }) {
	return (
		<div
			data-annotation-id={metadata.id}
			data-annotation-species={metadata.species}
			style={{
				...SPECIES_STYLE[metadata.species],
				margin: "4px 8px",
				padding: "8px 12px",
				borderRadius: 6,
				font: "13px/1.5 system-ui, sans-serif",
			}}
		>
			<strong>{metadata.title}</strong>
			{metadata.species === "suggestion" ? (
				<pre style={{ margin: "6px 0", padding: 6, overflowX: "auto" }}>
					<code>{`suggested change for ${metadata.id}`}</code>
				</pre>
			) : null}
			<p style={{ margin: "4px 0 0" }}>{metadata.body}</p>
		</div>
	);
}
