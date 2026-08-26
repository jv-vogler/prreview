import { type ReactNode, useEffect, useState } from "react";
import styles from "./Collapsible.module.css";

/**
 * A region that opens and closes at the speed of a gesture rather than
 * appearing and vanishing.
 *
 * The height is nobody's to know — a balloon's is whatever its markdown
 * comes to, an overview's is whatever the agent wrote — so the animation
 * runs on a single grid row between `0fr` and `1fr`, which is the one thing
 * that interpolates to an unmeasured height. The inner element does the
 * clipping, so the content is revealed rather than squashed.
 *
 * Closing is owned here: React would drop the content the instant `open`
 * went false, leaving nothing to animate, so it stays mounted until its
 * exit animation reports it has finished. `onClosed` fires at that moment,
 * for a caller that wants to unmount the whole thing after the way out.
 */
export function Collapsible({
	open,
	onClosed,
	children,
}: {
	open: boolean;
	onClosed?(): void;
	children: ReactNode;
}) {
	const [mounted, setMounted] = useState(open);
	const closing = mounted && !open;

	useEffect(() => {
		if (open) {
			setMounted(true);
		}
	}, [open]);

	if (!mounted) {
		return null;
	}

	return (
		<div
			className={styles.region}
			data-closing={closing || undefined}
			onAnimationEnd={(event) => {
				// the content's own animations bubble through here too
				if (closing && event.target === event.currentTarget) {
					setMounted(false);
					onClosed?.();
				}
			}}
		>
			<div className={styles.clip}>{children}</div>
		</div>
	);
}
