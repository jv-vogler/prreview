const SCROLLBAR_CSS = `
	/*
	 * Width stays 0, as Pierre's own rule has it: this element scrolls
	 * horizontally and carries \`scrollbar-gutter: stable\`, so any width here
	 * is reserved at the end of every row whether a bar is there or not —
	 * which left every line, separator and annotation stopping 12px short of
	 * the file header above them.
	 */
	[data-code]::-webkit-scrollbar {
		width: 0;
		height: var(--base-size-12);
	}
	[data-code]::-webkit-scrollbar-track {
		background: transparent;
	}
	[data-code]::-webkit-scrollbar-thumb {
		background: var(--borderColor-default);
		background-clip: padding-box;
		border: var(--base-size-4) solid transparent;
		border-radius: var(--borderRadius-full);
	}
	[data-code]::-webkit-scrollbar-thumb:hover {
		background: var(--borderColor-emphasis);
		background-clip: padding-box;
	}
	[data-code]::-webkit-scrollbar-corner {
		background: transparent;
	}
`;

const CLICKABLE_HEADER_CSS = `
	[data-diffs-header="default"] {
		cursor: pointer;
		background-color: var(--bgColor-muted);
		transition: background-color var(--motion-transition-hover);
	}
	[data-diffs-header="default"]:hover {
		background-color: var(--control-bgColor-hover);
	}
`;

const DIFF_LINE_COLORS_CSS = `
	[data-line-type="change-addition"]:is([data-line], [data-no-newline]) {
		background-color: var(--diffBlob-additionLine-bgColor);
	}
	[data-line-type="change-deletion"]:is([data-line], [data-no-newline]) {
		background-color: var(--diffBlob-deletionLine-bgColor);
	}
	[data-column-number][data-line-type="change-addition"],
	[data-gutter-buffer][data-line-type="change-addition"] {
		background-color: var(--diffBlob-additionNum-bgColor);
	}
	[data-column-number][data-line-type="change-deletion"],
	[data-gutter-buffer][data-line-type="change-deletion"] {
		background-color: var(--diffBlob-deletionNum-bgColor);
	}
	[data-line-type="change-addition"] [data-diff-span] {
		background-color: var(--diffBlob-additionWord-bgColor);
	}
	[data-line-type="change-deletion"] [data-diff-span] {
		background-color: var(--diffBlob-deletionWord-bgColor);
	}
`;

const FOLD_CSS = `
	@keyframes prreview-unfold {
		from {
			opacity: 0;
			transform: translateY(calc(-1 * var(--base-size-4)));
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	[data-diffs-header="default"] ~ [data-diff],
	[data-diffs-header="default"] ~ [data-file] {
		animation: prreview-unfold var(--motion-duration-short)
			var(--motion-easing-enter) both;
	}
`;

const ANNOTATION_LAYER_CSS = `
	[data-annotation-content] {
		z-index: 3;
	}
`;

export const PIERRE_DIFF_CHROME_CSS = `${SCROLLBAR_CSS}${CLICKABLE_HEADER_CSS}${DIFF_LINE_COLORS_CSS}${FOLD_CSS}${ANNOTATION_LAYER_CSS}`;
