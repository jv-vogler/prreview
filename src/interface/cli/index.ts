// Placeholder boot entry so the two-target build works from Phase 1.
// The real CLI (argument parsing, toolchain probe, container, server) lands in Phase 6 (TASK-036).
process.stdout.write(
	"prreview: scaffold placeholder — the CLI arrives in a later phase\n",
);
