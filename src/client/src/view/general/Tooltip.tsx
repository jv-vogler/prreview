import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
	label: string;
	children: ReactNode;
}

const OPEN_DELAY_MS = 350;

/**
 * Headless Radix for positioning and dismissal, visuals 100% ours through
 * tokens (ARCHITECTURE §9 general/). Wrap any focusable trigger.
 */
export function Tooltip({ label, children }: TooltipProps) {
	return (
		<RadixTooltip.Root delayDuration={OPEN_DELAY_MS}>
			<RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
			<RadixTooltip.Portal>
				<RadixTooltip.Content className={styles.content} sideOffset={6}>
					{label}
				</RadixTooltip.Content>
			</RadixTooltip.Portal>
		</RadixTooltip.Root>
	);
}

export const TooltipProvider = RadixTooltip.Provider;
