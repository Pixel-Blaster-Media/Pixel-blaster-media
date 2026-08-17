#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_ID="prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5"
EXPECTED_PROJECT_NAME="pixel-blaster-media"
EXPECTED_ROOT_DIRECTORY="booking"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LINK_FILE="$REPO_ROOT/.vercel/project.json"

fail() {
  printf 'Production deployment blocked: %s\n' "$1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required."
command -v node >/dev/null 2>&1 || fail "node is required."
command -v vercel >/dev/null 2>&1 || fail "Vercel CLI is required."

if [[ ! -f "$LINK_FILE" ]]; then
  fail "repository root is not linked. Run: cd '$REPO_ROOT' && vercel link --yes --project $EXPECTED_PROJECT_NAME"
fi

actual_project_id="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(p.projectId ?? "")' "$LINK_FILE")"
actual_project_name="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(p.projectName ?? "")' "$LINK_FILE")"

[[ "$actual_project_id" == "$EXPECTED_PROJECT_ID" ]] || fail "linked project ID is not the canonical Realtor-facing project."
[[ "$actual_project_name" == "$EXPECTED_PROJECT_NAME" ]] || fail "linked project name is not $EXPECTED_PROJECT_NAME."

project_details="$(vercel project inspect "$EXPECTED_PROJECT_NAME" 2>&1)"
printf '%s\n' "$project_details" | grep -Fq "$EXPECTED_PROJECT_ID" || fail "Vercel returned a different project ID."
printf '%s\n' "$project_details" | grep -Eq "^[[:space:]]*Root Directory[[:space:]]+$EXPECTED_ROOT_DIRECTORY[[:space:]]*$" || fail "canonical project root directory is not booking."

if [[ "${1:-}" == "--check-only" ]]; then
  printf 'Canonical Vercel deployment target verified: %s (%s), root directory %s.\n' \
    "$EXPECTED_PROJECT_NAME" "$EXPECTED_PROJECT_ID" "$EXPECTED_ROOT_DIRECTORY"
  exit 0
fi

[[ $# -eq 0 ]] || fail "unsupported argument. Use --check-only or no argument."

git -C "$REPO_ROOT" fetch origin main
git -C "$REPO_ROOT" diff --quiet || fail "tracked working tree changes are present."
git -C "$REPO_ROOT" diff --cached --quiet || fail "staged changes are present."
[[ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ]] || fail "untracked files are present."
[[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$(git -C "$REPO_ROOT" rev-parse origin/main)" ]] || fail "HEAD is not the current origin/main commit."

cd "$REPO_ROOT"
exec vercel --prod --yes
