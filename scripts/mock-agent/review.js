// The findings pass, generated against the diff actually in front of it.
//
// Same rule as the comprehension generator next door: read the caps and the
// enums out of the `--json-schema` the CLI was handed, anchor on lines this
// round really has, and stay deterministic. What is different is that a review
// has to survive three gates on the way to the screen — the confidence floor,
// the form gate, and the grounding check — so every row below is designed
// against a specific gate outcome rather than merely being valid.
//
// That is the whole point. Before this existed the review branch fell through to
// a schema-shaped lorem instance whose `confidence` was the schema's `minimum`
// of 0, so adjudication discarded every single mock finding and the comments tab
// rendered its empty state. Nobody could look at this surface without real
// spend.
//
// Two invariants that are easy to break silently:
//
// 1. **Every live row needs its own `category`.** `mergeDuplicates` keys on
//    path + category + overlapping lines, and on a one-hunk changeset every row
//    shares a path and overlaps — so two rows with the same category merge, and
//    a row meant to be discarded takes a surviving row's body with it. The
//    duplicate pair is the one deliberate exception.
// 2. **The read log decides everything.** `checkGrounding` compares citations
//    against the paths this round `Read`, normalized against the workspace dir
//    parsed out of the prompt. Get that prefix wrong and every finding is
//    ungrounded, every blocker is dropped, and the board is empty again.
//
// Bodies are hand-written English, not lorem: `formGate` measures prose length,
// counts lead sentences, and looks for model tells, so lorem would be discarded
// for reasons that have nothing to do with what is being demonstrated.

/** the lowest tier that exists at this depth, for a row that wants to be small */
function severityFor(wanted, allowed) {
	return allowed.includes(wanted) ? wanted : allowed[allowed.length - 1];
}

/** the named category, or a distinct fallback so two rows never collide */
function categoryFor(wanted, allowed, index) {
	return allowed.includes(wanted) ? wanted : allowed[index % allowed.length];
}

/**
 * Where a finding can point.
 *
 * Two lines wherever the hunk allows it, and deliberately so: `formGate`'s
 * restatement check keys on `path:line:line`, so a single-line anchor is the
 * only shape that can trip it. Multi-line anchors are the safe default and the
 * narrow one is a weapon this generator does not need.
 */
function anchorSlots(files) {
	const slots = [];
	for (const file of files) {
		for (const hunk of file.hunks) {
			const added = hunk.rows.filter((row) => row.newLine !== null);
			const first = added.find((row) => row.kind === "add") ?? added[0];
			if (first === undefined) {
				continue;
			}
			const last = added[added.length - 1];
			slots.push({
				path: file.path,
				side: "new",
				startLine: first.newLine,
				endLine: Math.max(
					first.newLine,
					Math.min(first.newLine + 1, last.newLine),
				),
				hunkId: hunk.id,
				lines: added.map((row) => row.content),
			});
		}
	}
	return slots;
}

/** identifiers worth naming in a sentence, so the prose is about this diff */
function symbolsOf(slot) {
	const seen = [];
	for (const match of slot.lines
		.join(" ")
		.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) {
		const word = match[0];
		if (!RESERVED.has(word) && !seen.includes(word)) {
			seen.push(word);
		}
	}
	return seen.length > 0 ? seen : ["the changed value"];
}

const RESERVED = new Set([
	"const",
	"return",
	"function",
	"export",
	"import",
	"class",
	"async",
	"await",
	"true",
	"false",
	"null",
	"undefined",
	"this",
	"from",
	"type",
	"interface",
	"string",
	"number",
	"boolean",
	"void",
	"else",
	"case",
]);

/**
 * The path this round pointedly does not open.
 *
 * A real changeset file when there is more than one, because that is what a
 * reviewer citing a caller they never opened actually looks like; a plausible
 * sibling otherwise. It is excluded from the anchor pool as well as from the
 * reads, so the findings that cite it fail the grounding check rather than
 * failing to anchor — a card that vanished because `findFile` missed would
 * demonstrate nothing.
 */
function reservedPath(files) {
	if (files.length > 1) {
		return files[files.length - 1].path;
	}
	const path = files[0]?.path ?? "src/index.ts";
	const cut = path.lastIndexOf("/");
	const directory = cut < 0 ? "" : `${path.slice(0, cut)}/`;
	return `${directory}callers.ts`;
}

function pad(text, length) {
	let padded = text;
	const filler = " and the same again";
	while (padded.length < length) {
		padded += filler;
	}
	return padded.slice(0, length);
}

/**
 * A body that passes the form gate on purpose.
 *
 * Two sentences of consequence, then a fence, then `see <path>:<line>`.
 * `leadSentences` cuts at the word "see", so everything after it is the showing
 * rather than the telling, and `stripFences` removes the snippet before the
 * prose budget is measured. Both of those are load-bearing: three sentences
 * before the `see` fails `lead-too-long`, and a paragraph instead of a fence
 * fails `prose-too-long`.
 */
function body(lead, snippet, slot) {
	return [
		lead,
		"",
		"```ts",
		snippet,
		"```",
		"",
		`see ${slot.path}:${slot.startLine}`,
	].join("\n");
}

function buildReview(input) {
	const { lens, files, schema, workspaceDir, confidenceFloor, suppressions } =
		input;
	const item = schema.properties.findings.items.properties;
	const severities = item.severity.enum;
	const categories = item.category.enum;
	const titleMax = item.title.maxLength;
	const bodyMax = item.body.maxLength;

	const reserved = reservedPath(files);
	const shown = files.filter((file) => file.path !== reserved);
	const slots = anchorSlots(shown.length > 0 ? shown : files);
	if (slots.length === 0) {
		// an empty or stat-only changeset: answer honestly rather than throwing
		return { output: { findings: [], relatedFindings: [] }, toolCalls: [] };
	}
	const at = (index) => slots[index % slots.length];

	const severity = (wanted) => severityFor(wanted, severities);
	const category = (wanted, index) => categoryFor(wanted, categories, index);
	const confidence = (over) =>
		Math.min(item.confidence.maximum, confidenceFloor + over);

	const rows = ROWS({
		at,
		reserved,
		severity,
		category,
		confidence,
		titleMax,
		bodyMax,
		item,
	}).filter((row) => row.lens === lens);

	const findings = [];
	const relatedFindings = [];
	for (const row of rows) {
		// dismissing a comment suppresses it for the next pass, which is the one
		// part of the curation loop a generator can actually demonstrate
		if (suppressions.some((entry) => entry === row.finding.title)) {
			continue;
		}
		(row.related ? relatedFindings : findings).push(row.finding);
	}

	return {
		output: {
			findings: findings.slice(0, schema.properties.findings.maxItems),
			relatedFindings: relatedFindings.slice(
				0,
				schema.properties.relatedFindings.maxItems,
			),
		},
		toolCalls: readsFor(lens, rows, shown, workspaceDir),
	};
}

/**
 * What this lens opened.
 *
 * The paths its own rows anchor on, absolutized against the workspace dir the
 * prompt named — byte-identical to the string adjudication normalizes against,
 * which is why it is parsed rather than taken from `process.cwd()`. The
 * reserved path is never read by anyone.
 *
 * `fresh-eyes` reads nothing at all, which is not an omission: that lens is
 * defined by having no context, and its lead still comes back grounded because
 * grounding is checked against the **union** of the round's logs. That is the
 * union rule made visible on one screen.
 */
function readsFor(lens, rows, shown, workspaceDir) {
	if (lens === "fresh-eyes") {
		return [];
	}
	const paths = new Set(rows.map((row) => row.finding.anchor.path));
	if (rows.length === 0) {
		// a lens with nothing to say still read the diff, and its reads still
		// count toward the union every other lens is checked against
		for (const file of shown.slice(0, 2)) {
			paths.add(file.path);
		}
	}
	return [...paths].map((path) => [
		"Read",
		{ file_path: `${workspaceDir}/${path}` },
	]);
}

/**
 * Every state of the tab, at once.
 *
 * A real run gives you these one at a time and only by luck. Reading down the
 * "outcome" column should tell you what the screen ought to look like before
 * you open it.
 */
function ROWS(build) {
	const {
		at,
		reserved,
		severity,
		category,
		confidence,
		titleMax,
		bodyMax,
		item,
	} = build;

	const first = at(0);
	const second = at(1);
	const third = at(2);
	const fourth = at(3);
	const firstSymbol = symbolsOf(first)[0];
	const secondSymbol = symbolsOf(second)[0];

	return [
		// ── survives clean, ranked first ────────────────────────────────────
		{
			lens: "correctness",
			finding: {
				title: `${firstSymbol} is read before it is checked`,
				body: body(
					`A caller that reaches this path with no value set gets a crash rather than the fallback, and the request fails with a 500 instead of a default. Every caller that omits the argument is affected.`,
					`if (${firstSymbol} === undefined) {\n  throw new Error("unreachable"); // it is reachable\n}`,
					first,
				),
				anchor: anchorOf(first),
				severity: severity("blocker"),
				category: category("correctness", 0),
				confidence: confidence(16),
				proof: {
					mode: "traced",
					how: "followed both callers into this branch",
				},
				evidence: {
					path: first.path,
					startLine: first.startLine,
					endLine: first.endLine,
					note: "the guard runs after the value is already used",
				},
			},
		},
		// ── the duplicate pair: two lenses, one claim ────────────────────────
		{
			lens: "correctness",
			finding: {
				title: `${secondSymbol} widens what callers may pass`,
				body: body(
					`Callers built against the old shape keep compiling and start receiving values they never handled. The widened type reaches persisted data, so the mismatch survives a restart.`,
					`// before: string\n// after:  string | null`,
					second,
				),
				anchor: anchorOf(second),
				severity: severity("consider"),
				category: category("api-contract", 1),
				confidence: confidence(4),
				proof: { mode: "inferred", how: "did not open every caller" },
			},
		},
		{
			lens: "security",
			finding: {
				// the same anchor and category from a second lens: adjudication
				// merges them, keeps the worse framing, and ranks the pair up
				title: `${secondSymbol} widens what callers may pass`,
				body: body(
					`Callers built against the old shape keep compiling and start receiving values they never handled. One of them writes the value straight to storage without validating it.`,
					`store.write(${secondSymbol}); // no validation on this path`,
					second,
				),
				anchor: {
					...anchorOf(second),
					startLine: second.startLine,
					endLine: second.endLine,
				},
				severity: severity("should-fix"),
				category: category("api-contract", 1),
				confidence: confidence(8),
				proof: { mode: "traced", how: "read the caller and the write path" },
			},
		},
		// ── survives, and ranks BELOW the corroborated pair despite a higher
		//    confidence: corroboration outranks self-report ────────────────────
		{
			lens: "correctness",
			finding: {
				title: `Empty input reaches ${firstSymbol} unfiltered`,
				body: body(
					`An empty collection takes the branch meant for the populated case, so the caller gets a partial write instead of a no-op. The failure is silent — nothing throws and nothing is logged.`,
					`for (const entry of entries) { /* never runs, and that is the bug */ }`,
					third,
				),
				anchor: anchorOf(third),
				severity: severity("should-fix"),
				category: category("edge-case", 2),
				confidence: confidence(15),
				proof: { mode: "traced", how: "read the loop and its two callers" },
			},
		},
		// ── the hedged one: anchored on code that was read, citing code that
		//    was not ─────────────────────────────────────────────────────────
		{
			lens: "security",
			finding: {
				title: `The error path returns the caller's input verbatim`,
				body: body(
					`A failed lookup echoes whatever was submitted back to the client, so a crafted value lands in the response body unescaped. Anything rendering that response inherits the problem.`,
					`return { error: request.query.q }; // echoed unescaped`,
					third,
				),
				anchor: anchorOf(third),
				severity: severity("should-fix"),
				category: category("error-handling", 3),
				confidence: confidence(10),
				proof: { mode: "traced", how: "read the handler and its error branch" },
				evidence: {
					path: reserved,
					startLine: 12,
					endLine: 14,
					note: "the caller that renders this response",
				},
			},
		},
		// ── every cap, at once, plus the repro test ──────────────────────────
		{
			lens: "correctness",
			finding: {
				title: pad(
					`${firstSymbol} deserves a longer title than this`,
					titleMax,
				),
				body: cappedBody(fourth, bodyMax),
				anchor: anchorOf(fourth),
				severity: severity("nitpick"),
				category: category("testing", 4),
				confidence: confidence(2),
				proof: {
					mode: "inferred",
					how: pad(
						"traced as far as the module boundary and no further",
						item.proof.properties.how.maxLength,
					),
				},
				evidence: {
					path: fourth.path,
					startLine: fourth.startLine,
					endLine: fourth.endLine,
					note: pad(
						"the assertion this test would add",
						item.evidence.properties.note.maxLength,
					),
				},
				reproTest: [
					"it('falls back when nothing was set', () => {",
					`  expect(${firstSymbol}(undefined)).toBe("fallback");`,
					"});",
				].join("\n"),
			},
		},
		// ── discarded: the ungrounded blocker ────────────────────────────────
		{
			lens: "security",
			finding: {
				title: `A secret reaches the log on this path`,
				body: body(
					`The token is written to the request log, so anyone with log access can replay it. Log retention makes this outlive the credential.`,
					`logger.info({ token }); // the whole token`,
					first,
				),
				anchor: anchorOf(first),
				severity: severity("blocker"),
				category: category("security", 5),
				confidence: confidence(13),
				proof: { mode: "traced", how: "read the logger call" },
				evidence: {
					path: reserved,
					startLine: 40,
					endLine: 42,
					note: "where the token is put on the request",
				},
			},
		},
		// ── discarded: below the confidence floor, twice, so one reason group
		//    has a count above one ───────────────────────────────────────────
		{
			lens: "correctness",
			finding: {
				title: `This might be a performance problem`,
				body: body(
					`The lookup may run once per row rather than once per request. Whether that matters depends on how large the collection gets in practice.`,
					`rows.map((row) => lookup(row.id)) // one call per row`,
					second,
				),
				anchor: anchorOf(second),
				severity: severity("consider"),
				category: category("performance", 6),
				confidence: Math.max(0, confidence(-8)),
				proof: { mode: "inferred", how: "did not measure anything" },
			},
		},
		{
			lens: "security",
			// in the related lane on purpose: the floor applies to both species,
			// and this is the row that proves it. It also frees `concurrency` for
			// the impact lens below — with ten categories and eleven live rows,
			// two rows in the *same* array sharing one would merge before any gate
			// ran, and a discarded row's body would ride into a surviving card.
			related: true,
			finding: {
				title: `Two callers might race here`,
				body: body(
					`Two requests arriving together could both pass the check before either writes. Whether they can actually interleave depends on the runtime.`,
					`if (!exists) { await write(); } // no lock`,
					third,
				),
				anchor: anchorOf(third),
				severity: severity("consider"),
				category: category("concurrency", 7),
				confidence: Math.max(0, confidence(-14)),
				proof: { mode: "inferred", how: "did not read the scheduler" },
			},
		},
		// ── discarded: reads like a model wrote it ───────────────────────────
		{
			lens: "correctness",
			finding: {
				title: `The new abstraction earns less than it costs`,
				body: body(
					`It's worth noting that this indirection adds a layer without removing one. The two implementations it allows for do not exist yet.`,
					`export interface Strategy { run(): void } // one implementer`,
					fourth,
				),
				anchor: anchorOf(fourth),
				severity: severity("consider"),
				category: category("design", 8),
				confidence: confidence(11),
				proof: { mode: "traced", how: "read every implementer" },
			},
		},
		// ── the pre-existing problems, in their own lane ─────────────────────
		{
			lens: "security",
			related: true,
			finding: {
				title: `This helper has never validated its input`,
				body: body(
					`The helper this change calls has always trusted its argument, and every existing caller relies on that. It predates this change and is not the author's to fix here.`,
					`function normalize(value) { return value.trim(); } // throws on null`,
					first,
				),
				anchor: anchorOf(first),
				severity: severity("consider"),
				category: category("correctness", 9),
				confidence: confidence(8),
				proof: { mode: "traced", how: "read the helper and its callers" },
			},
		},
		{
			lens: "design",
			related: true,
			finding: {
				title: `The module has no tests at all`,
				body: body(
					`Nothing in this module is covered, so any change to it is unverified by construction. That was true before this change and stays true after it.`,
					`// no *.test.ts beside this module`,
					second,
				),
				anchor: anchorOf(second),
				severity: severity("consider"),
				category: category("testing", 4),
				confidence: confidence(3),
				proof: {
					mode: "inferred",
					how: "looked for a test file and found none",
				},
			},
		},
		// ── the context-free lead: grounded only through the union log ───────
		{
			lens: "fresh-eyes",
			finding: {
				title: `A reader meeting this cold cannot tell what the flag does`,
				body: body(
					`The parameter's name does not say what changes when it is set, so the next reader has to open the callee to find out. Nothing here verifies that guess.`,
					`greet(name, true) // true meaning what?`,
					first,
				),
				anchor: anchorOf(first),
				severity: severity("consider"),
				category: category("data-loss", 10),
				confidence: confidence(1),
				proof: {
					mode: "inferred",
					how: "read only the diff; verified nothing",
				},
			},
		},
		// ── the sixth lens, present only at thorough ─────────────────────────
		{
			lens: "impact",
			finding: {
				title: `The serialized shape changes for data already on disk`,
				body: body(
					`Records written by the previous version no longer parse, so a reader on old data fails at load rather than at use. There is no backfill in this change.`,
					`{ "v": 1 } // still on disk; the reader now expects v: 2`,
					third,
				),
				anchor: anchorOf(third),
				severity: severity("should-fix"),
				category: category("concurrency", 7),
				confidence: confidence(6),
				proof: { mode: "inferred", how: "did not open the migration history" },
			},
		},
	];
}

function anchorOf(slot) {
	return {
		path: slot.path,
		side: slot.side,
		startLine: slot.startLine,
		endLine: slot.endLine,
	};
}

/**
 * A body at exactly the schema's cap.
 *
 * The padding goes **inside the fence**, because `stripFences` removes it before
 * the prose budget is measured — 900 characters of prose would fail
 * `prose-too-long`, while 900 characters of mostly-fence passes and still shows
 * what a body at its limit does to the card's layout.
 */
function cappedBody(slot, bodyMax) {
	const head = [
		"The assertion this module needs does not exist, so a regression here would ship green. The fix is one test rather than a change to the code.",
		"",
		"```ts",
	].join("\n");
	const tail = ["```", "", `see ${slot.path}:${slot.startLine}`].join("\n");
	const room = bodyMax - head.length - tail.length - 2;
	const filler = "// ".concat("a".repeat(Math.max(1, room - 3)));
	return `${head}\n${filler.slice(0, Math.max(1, room))}\n${tail}`.slice(
		0,
		bodyMax,
	);
}

module.exports = { buildReview };
