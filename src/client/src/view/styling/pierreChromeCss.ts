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
 * Only Primer tokens appear below (ARCHITECTURE §10): custom properties are
 * inherited properties, so every `--bgColor-*` and `--motion-*` defined on the
 * root element resolves normally on the far side of the shadow boundary.
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
	[data-code]::-webkit-scrollbar {
		width: var(--base-size-12);
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
 * The whole file header is the fold control.
 *
 * A bar with a filename, a change count, a checkbox and a chevron, where only
 * the chevron does anything, spends a wide target on nothing. GitHub folds on
 * the header, and so does this: the hover tells you the whole strip is live
 * before you commit to the click, which is the part that makes it discoverable
 * rather than merely true.
 *
 * The hover color has to be opaque. A sticky header paints over the code
 * scrolling beneath it, and a translucent background would let the code show
 * through exactly when the header is doing its job.
 */
const CLICKABLE_HEADER_CSS = `
	[data-diffs-header="default"] {
		cursor: pointer;
		transition: background-color var(--motion-transition-hover);
	}
	[data-diffs-header="default"]:hover {
		background-color: var(--bgColor-muted);
	}
`;

/**
 * The clamp a fold eases through.
 *
 * Both halves of this cross the shadow boundary and nothing else does:
 * `:host()` lets a rule inside the shadow root read an attribute on the element
 * outside it, and custom properties inherit straight through. So the animation
 * is driven entirely by two values set on the item's own element — no reaching
 * into a shadow root, no patching the renderer. See `useAnimatedCollapse.ts`
 * for why animating the height does not desynchronize the virtualizer.
 *
 * The rule applies only while the attribute is present, so a file at rest keeps
 * exactly the overflow behaviour the renderer gave it and its horizontal
 * scroller is untouched.
 */
const FOLD_ANIMATION_CSS = `
	:host([data-prr-folding]) [data-diff] {
		overflow: hidden;
		max-height: var(--prr-fold-height, none);
	}
`;

/** for the Diff tab's CodeView, where files fold */
export const PIERRE_DIFF_CHROME_CSS = `${SCROLLBAR_CSS}${CLICKABLE_HEADER_CSS}${FOLD_ANIMATION_CSS}`;

/**
 * For the Understanding tab's topic excerpts, which are curated cuts of a file
 * and have nothing to fold — so they get the scroller treatment and none of the
 * clickability, because a header that highlights under the pointer and then
 * does nothing is worse than one that never invited the click.
 */
export const PIERRE_EXCERPT_CHROME_CSS = SCROLLBAR_CSS;
