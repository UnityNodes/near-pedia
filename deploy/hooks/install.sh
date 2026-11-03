#!/usr/bin/env bash
#
# Symlinks the tracked hook templates into .git/hooks/.
# Run once after `git clone`, and again whenever deploy/hooks/* changes.
#
# The hooks are the backstop against committing or pushing a .env file; a
# fresh clone does not have them until this runs.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

linked=0
for hook in pre-push pre-commit; do
  src="deploy/hooks/$hook"
  dst=".git/hooks/$hook"
  if [[ ! -f "$src" ]]; then
    echo "skip: $src missing"
    continue
  fi
  # A relative symlink, so the link survives the repository being moved.
  ln -sf "../../$src" "$dst"
  echo "linked: $dst -> $src"
  linked=$((linked + 1))
done

if [[ $linked -eq 0 ]]; then
  echo "nothing linked: deploy/hooks/ holds no hook templates" >&2
  exit 1
fi

echo
echo "Done. Both hooks refuse anything matching .env* (except *.example)."
echo "Check they are live:"
echo "  ls -l .git/hooks/pre-commit .git/hooks/pre-push"
echo "  echo 'SECRET=x' > .env.production && git add -f .env.production   # pre-commit should refuse the commit"
