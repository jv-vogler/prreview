import { type ReactNode, useEffect, useState } from "react";
import styles from "./Collapsible.module.css";

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
