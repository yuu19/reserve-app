#!/usr/bin/env bash
set -euo pipefail
set +x

REPO="${REPO:-yuu19/reserve-app}"

command -v gh >/dev/null || {
  echo "gh CLI が見つかりません。" >&2
  exit 1
}

gh auth status -h github.com >/dev/null

printf "Repository: %s\n" "$REPO"
printf "R2_ACCESS_KEY_ID: "
IFS= read -r -s R2_ACCESS_KEY_ID
printf "\nR2_SECRET_ACCESS_KEY: "
IFS= read -r -s R2_SECRET_ACCESS_KEY
printf "\n"

if [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
  echo "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY は空にできません。" >&2
  exit 1
fi

printf "%s" "$R2_ACCESS_KEY_ID" | gh secret set R2_ACCESS_KEY_ID --repo "$REPO"
printf "%s" "$R2_SECRET_ACCESS_KEY" | gh secret set R2_SECRET_ACCESS_KEY --repo "$REPO"

unset R2_ACCESS_KEY_ID
unset R2_SECRET_ACCESS_KEY

echo "登録済み secrets:"
gh secret list --repo "$REPO" | grep -E '^R2_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|ACCOUNT_ID|BUCKET)\b'
