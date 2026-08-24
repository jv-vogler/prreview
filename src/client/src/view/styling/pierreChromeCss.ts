/**
 * Our design, applied inside the renderer's shadow roots.
 *
 * `pierre-theme.css` handles everything Pierre exposes as a variable. What is
 * left over is Pierre's own chrome — the file header, the horizontal scroller
 * under the code — which lives in a shadow root and so cannot be reached by a
 * stylesheet in the document. Pierre's sanctioned way in is the `unsafeCSS`
 * option, which injects a stylesheet into each item's shadow root inside
 * `@layer unsafe`, above its own rules.
 *
 * Only Primer tokens appear below (CON-012): custom properties are inherited
 * properties, so every `--bgColor-*` and `--motion-*` defined on the root
 * element resolves normally on the far side of the shadow boundary.
 */

/**
 * The scroller under a wide file.
 *
 * Pierre thins its scrollbar only under `@supports ((-moz-appearance: none))`,
 * which leaves Chromium with the platform's default bar sitting inside an
 * otherwise carefully drawn diff. The two mechanisms are mutually exclusive —
 * Chromium drops `::-webkit-scrollbar` entirely once `scrollbar-width` is set
 * on the element — so this styles the pseudo-elements and lets Pierre's own
 * rule keep serving Firefox.
 */
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

/**
 * The whole file header is the fold control (hover shows the strip is live).
 *
 * Pierre's own default paints it in `--diffs-bg`, same as the code below it,
 * so left alone it has no background of its own. GitHub's real header sits
 * one step up, in canvas-subtle — overridden here at rest.
 *
 * Hover is `--control-bgColor-hover` rather than a step further along the
 * background ramp: `--bgColor-emphasis` is a near-black inverted-text token in
 * light mode, so pairing it with the header's own dark filename dropped the
 * bar to 1.08:1 and the filename vanished under the cursor. It also has to
 * stay opaque, since a sticky header lets the scrolling code show through
 * anything translucent.
 */
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

/**
 * GitHub's own diff line colors, applied as final backgrounds.
 *
 * `pierre-theme.css` maps Primer's diffBlob tokens onto Pierre's
 * `--diffs-bg-addition-override` family, but Pierre does not use those as the
 * background it paints: they are the *mix target* it blends 20% into the page
 * background. Feeding it Primer's `--diffBlob-additionLine-bgColor`, which is
 * already a 15%-alpha wash, diluted GitHub's green to roughly 3% and the diff
 * read as washed out. These rules set the composited result instead, so a
 * changed line is exactly the color github.com paints.
 */
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

/**
 * The unfold, softened.
 *
 * Pierre rebuilds a file's rows when `collapsed` flips, so the body cannot be
 * height-animated from out here — the rows do not exist to animate, and the
 * list they land in is virtualized. What is available is the arrival: the code
 * block fades and settles the last few pixels into place, which reads as the
 * file opening rather than the page jumping. The header never animates, so the
 * bar the reader clicked stays put under the cursor.
 */
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

/** for the Diff view's CodeView, where files fold */
export const PIERRE_DIFF_CHROME_CSS = `${SCROLLBAR_CSS}${CLICKABLE_HEADER_CSS}${DIFF_LINE_COLORS_CSS}${FOLD_CSS}`;
