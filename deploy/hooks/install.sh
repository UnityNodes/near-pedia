#!/usr/bin/env bash
#
# Symlinks the tracked hook templates into .git/hooks/.
# Run once after `git clone`, and again whenever deploy/hooks/* changes.
#
# CLAUDE.md has told every reader to run this since before the file existed:
# a fresh clone got "No such file or directory", and the secret-leak backstop
# the same paragraph describes was never installed. A documented step that
# cannot be taken is worse than an undocumented one, because it reads as done.

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
