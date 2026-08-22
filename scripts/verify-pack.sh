#!/usr/bin/env bash
# Packaging verification (TASK-054): prove the tarball npm would publish
# contains exactly what it should, installs cleanly, and actually serves.
#
#   1. npm pack (runs prepack = full build)
#   2. assert the tarball holds ONLY the allowed files, and all required ones
#   3. install the tarball into a scratch project
#   4. run `prreview working --no-open` inside a dirty fixture repo
#   5. curl /api/session and expect HTTP 200
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/prreview-verify-pack.XXXXXX")"
SERVER_PID=""
SERVER_LOG="$WORK_DIR/server.log"

# how long to wait for the served URL to appear in the server's stdout
SERVER_START_TIMEOUT_SECONDS=30

cleanup() {
	if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill -9 "$SERVER_PID" 2>/dev/null || true
	fi
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
	echo "verify-pack: FAIL — $1" >&2
	if [ -f "$SERVER_LOG" ]; then
		echo "--- server log ---" >&2
		cat "$SERVER_LOG" >&2
	fi
	exit 1
}

# ── 1. pack ──────────────────────────────────────────────────────────────
echo "verify-pack: packing…"
TARBALL_NAME="$(cd "$REPO_ROOT" && npm pack --pack-destination "$WORK_DIR" | tail -n 1)"
TARBALL="$WORK_DIR/$TARBALL_NAME"
[ -f "$TARBALL" ] || fail "npm pack produced no tarball at $TARBALL"

# ── 2. contents: nothing unexpected, nothing missing ─────────────────────
# Allowed: dist/**, README.md, LICENSE, package.json — and nothing else.
tar -tzf "$TARBALL" | sed 's|^package/||' | sort >"$WORK_DIR/contents.txt"

UNEXPECTED="$(grep -Ev '^(dist/|README\.md$|LICENSE$|package\.json$)' "$WORK_DIR/contents.txt" || true)"
if [ -n "$UNEXPECTED" ]; then
	fail "unexpected files in the tarball:
$UNEXPECTED"
fi

for required in dist/cli.js dist/client/index.html README.md LICENSE package.json; do
	grep -qx "$required" "$WORK_DIR/contents.txt" ||
		fail "required file missing from the tarball: $required"
done
echo "verify-pack: tarball contents ok ($(grep -c "" "$WORK_DIR/contents.txt") files)"

# ── 3. install into a scratch project ────────────────────────────────────
echo "verify-pack: installing tarball into a scratch project…"
SCRATCH_PROJECT="$WORK_DIR/project"
mkdir -p "$SCRATCH_PROJECT"
(cd "$SCRATCH_PROJECT" &&
	npm init -y >/dev/null 2>&1 &&
	npm install --no-audit --no-fund "$TARBALL" >/dev/null)
PRREVIEW_BIN="$SCRATCH_PROJECT/node_modules/.bin/prreview"
[ -x "$PRREVIEW_BIN" ] || fail "installed package exposes no prreview binary"

# ── 4. a dirty fixture repo, hermetic from the machine's git config ──────
FIXTURE_REPO="$WORK_DIR/fixture"
mkdir -p "$FIXTURE_REPO"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
git -C "$FIXTURE_REPO" init --quiet -b main
echo "hello" >"$FIXTURE_REPO/greeting.txt"
git -C "$FIXTURE_REPO" add -A
git -C "$FIXTURE_REPO" commit --quiet -m "initial commit"
echo "hello, changed" >"$FIXTURE_REPO/greeting.txt"

# ── 5. serve and probe /api/session ──────────────────────────────────────
echo "verify-pack: launching prreview working --no-open…"
(cd "$FIXTURE_REPO" && "$PRREVIEW_BIN" working --no-open >"$SERVER_LOG" 2>&1) &
SERVER_PID=$!

SERVED_URL=""
for _ in $(seq 1 $((SERVER_START_TIMEOUT_SECONDS * 2))); do
	SERVED_URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/' "$SERVER_LOG" 2>/dev/null | head -n 1 || true)"
	[ -n "$SERVED_URL" ] && break
	kill -0 "$SERVER_PID" 2>/dev/null || fail "server exited before announcing its URL"
	sleep 0.5
done
[ -n "$SERVED_URL" ] || fail "server did not announce a URL within ${SERVER_START_TIMEOUT_SECONDS}s"

STATUS="$(curl -fsS -o "$WORK_DIR/session.json" -w '%{http_code}' "${SERVED_URL}api/session")" ||
	fail "curl ${SERVED_URL}api/session failed"
[ "$STATUS" = "200" ] || fail "GET /api/session returned $STATUS, expected 200"

echo "verify-pack: OK — tarball exact, install clean, /api/session 200"
