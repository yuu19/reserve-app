#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  install-skill-dir.sh <github_tree_url>

Example:
  install-skill-dir.sh https://github.com/vercel/turborepo/tree/main/skills/turborepo
  install-skill-dir.sh https://github.com/antfu/skills/tree/main/skills

What it does:
  - Downloads only the directory pointed to by the GitHub tree URL (e.g. .../tree/main/skills/turborepo)
  - Installs it into ./.agents/skills/<last_dir_name>
    (e.g. turborepo -> ./.agents/skills/turborepo)
  - If URL points to .../tree/<ref>/skills, installs each child dir under `skills/` into ./.agents/skills/
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

TREE_URL="${1%/}"

# Parse: https://github.com/<owner>/<repo>/tree/<ref>/<path...>
if [[ ! "$TREE_URL" =~ ^https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)(/.*)$ ]]; then
  echo "Error: URL must look like: https://github.com/<owner>/<repo>/tree/<ref>/<path>" >&2
  exit 1
fi

OWNER="${BASH_REMATCH[1]}"
REPO="${BASH_REMATCH[2]}"
REF="${BASH_REMATCH[3]}"
SUBPATH="${BASH_REMATCH[4]#/}"  # drop leading '/'

# Keep install naming independent from repo name so URLs like:
# https://github.com/antfu/skills/tree/main/skills
# treat the first "skills" (repo name) as unrelated.
INSTALL_ALL_FROM_SKILLS_ROOT=false
INSTALL_SUBPATH="$SUBPATH"
if [[ "$INSTALL_SUBPATH" == "skills" ]]; then
  INSTALL_ALL_FROM_SKILLS_ROOT=true
elif [[ "$INSTALL_SUBPATH" == skills/* ]]; then
  INSTALL_SUBPATH="${INSTALL_SUBPATH#skills/}"
fi

if [[ -z "$SUBPATH" ]]; then
  echo "Error: URL must include a directory path after /tree/<ref>/ (e.g. /tree/main/skills/turborepo)" >&2
  exit 1
fi

# Destination dir name = last normalized path segment
DEST_NAME="${INSTALL_SUBPATH##*/}"

if [[ "$INSTALL_ALL_FROM_SKILLS_ROOT" == "false" ]] && [[ -z "$DEST_NAME" || "$DEST_NAME" == "." || "$DEST_NAME" == ".." || "$DEST_NAME" =~ [/:] ]]; then
  echo "Error: Invalid destination directory name derived from URL: '$DEST_NAME'" >&2
  exit 1
fi

TARGET_ROOT="$(pwd)/.agents/skills"
TARGET_DIR="$TARGET_ROOT/$DEST_NAME"
mkdir -p "$TARGET_ROOT"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

REPO_GIT_URL="https://github.com/$OWNER/$REPO.git"

echo "==> Cloning (sparse) $REPO_GIT_URL @ $REF"
git clone --depth 1 --filter=blob:none --sparse -b "$REF" "$REPO_GIT_URL" "$tmp/repo" >/dev/null

pushd "$tmp/repo" >/dev/null
echo "==> Fetching subdir: $SUBPATH"
git sparse-checkout set "$SUBPATH" >/dev/null

if [[ ! -d "$SUBPATH" ]]; then
  echo "Error: Directory '$SUBPATH' not found in $OWNER/$REPO at ref '$REF'." >&2
  exit 1
fi

if [[ "$INSTALL_ALL_FROM_SKILLS_ROOT" == "true" ]]; then
  echo "==> Installing child skill directories from: $SUBPATH into $TARGET_ROOT"
  installed_count=0
  shopt -s nullglob
  for skill_dir in "$SUBPATH"/*; do
    [[ -d "$skill_dir" ]] || continue
    skill_name="${skill_dir##*/}"
    if [[ -z "$skill_name" || "$skill_name" == "." || "$skill_name" == ".." || "$skill_name" =~ [/:] ]]; then
      echo "Warning: Skipping invalid skill directory name: '$skill_name'" >&2
      continue
    fi
    echo "   - $skill_name"
    rm -rf "$TARGET_ROOT/$skill_name"
    cp -a "$skill_dir" "$TARGET_ROOT/$skill_name"
    installed_count=$((installed_count + 1))
  done
  shopt -u nullglob

  if [[ "$installed_count" -eq 0 ]]; then
    echo "Error: No child directories found under '$SUBPATH' in $OWNER/$REPO at ref '$REF'." >&2
    exit 1
  fi
else
  echo "==> Installing into: $TARGET_DIR"
  rm -rf "$TARGET_DIR"
  mkdir -p "$(dirname "$TARGET_DIR")"
  cp -a "$SUBPATH" "$TARGET_DIR"
fi
popd >/dev/null

echo "✅ Done."
if [[ "$INSTALL_ALL_FROM_SKILLS_ROOT" == "true" ]]; then
  echo "Installed $installed_count skill directories into: $TARGET_ROOT"
else
  echo "Installed: $TARGET_DIR"
fi
