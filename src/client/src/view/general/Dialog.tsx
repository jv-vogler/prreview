import { XIcon } from "@primer/octicons-react";
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import styles from "./Dialog.module.css";

export interface DialogProps {
	title: string;
	open: boolean;
	onOpenChange(open: boolean): void;
	children: ReactNode;
}

/**
 * Headless Radix Dialog (focus trap, dismissal, aria) with token-styled
 * visuals (ARCHITECTURE §9 general/).
 */
export function Dialog({ title, open, onOpenChange, children }: DialogProps) {
	return (
		<RadixDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className={styles.overlay} />
				<RadixDialog.Content className={styles.content}>
					<header className={styles.header}>
						<RadixDialog.Title className={styles.title}>
							{title}
						</RadixDialog.Title>
						<RadixDialog.Close
							className={styles.close}
							aria-label="Close dialog"
						>
							<XIcon size={16} />
						</RadixDialog.Close>
					</header>
					{children}
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}
