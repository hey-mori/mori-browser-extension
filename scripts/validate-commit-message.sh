#!/usr/bin/env bash
#
# The one definition of a valid commit message, the Mori commit format made
# executable: https://github.com/hey-mori/.github/blob/main/docs/commit-format.md
# Copied unchanged in behaviour from hey-mori/mori; keep the two in step.
#
#   .githooks/commit-msg      before the commit object exists
#   CI                        over a pull request's commits
#
# Usage:
#   scripts/validate-commit-message.sh <message-file>
#   printf '%s' "$message" | scripts/validate-commit-message.sh --stdin
#
# Exit 0 when the message conforms; exit 1 with one line per violation on
# stderr; exit 2 on bad usage.
set -euo pipefail

if [[ "${1:-}" == "--stdin" ]]; then
  msg="$(cat)"
elif [[ -n "${1:-}" && -f "$1" ]]; then
  msg="$(cat "$1")"
else
  echo "usage: $0 <message-file> | $0 --stdin" >&2
  exit 2
fi

# git hands commit-msg the raw buffer: drop the comment lines it strips itself.
msg="$(printf '%s\n' "$msg" | grep -v '^#' || true)"
subject="$(printf '%s\n' "$msg" | head -n 1)"
errors=()

# Attribution and decoration are banned everywhere, merge commits included.
if grep -qiE '^co-authored-by:' <<<"$msg"; then
  errors+=("Co-Authored-By lines are forbidden")
fi
if grep -qiE 'generated (with|by)' <<<"$msg"; then
  errors+=("'Generated with/by' lines are forbidden")
fi
if grep -qiE '(claude|codex|copilot|chatgpt|gemini|qwen) (code|opus|sonnet|haiku|ai|assistant)' <<<"$msg"; then
  errors+=("AI tool attribution is forbidden")
fi
# Matched as UTF-8 bytes under the C locale, so the rule holds under any locale
# and any grep. grep -P needs a UTF-8 locale and the BSD grep on macOS has no
# -P; either way the old pattern errored and the rule skipped itself silently.
# F0 9F 8C-AB is U+1F300 to U+1FAFF, E2 98-9E is U+2600 to U+27BF.
if LC_ALL=C grep -qE $'\xf0\x9f[\x8c-\xab]|\xe2[\x98-\x9e]' <<<"$msg"; then
  errors+=("emoji are forbidden")
fi
# CLAUDE.md bans U+2014 in commit messages as in all prose.
if grep -q $'\xe2\x80\x94' <<<"$msg"; then
  errors+=("the em dash (U+2014) is forbidden; use ',' or '·'")
fi

# Mori merges with merge commits (docs/git-workflow.md §4), and git or GitHub
# writes their messages, including a PR-title body that is not a bullet. They
# are checked for attribution above and exempt from the shape rules below.
if grep -qE "^Merge (pull request #[0-9]+ from |branch '|remote-tracking branch '|[0-9a-f]{7,40} into )" <<<"$subject"; then
  if (( ${#errors[@]} > 0 )); then
    printf 'commit message: %s\n' "${errors[@]}" >&2
    exit 1
  fi
  exit 0
fi

# Rules shared by the bullet body of a normal commit and of a revert.
check_bullets() {
  local body="$1" seen_bullet="" gap="" line
  while IFS= read -r line; do
    if [[ -z "$line" ]]; then
      [[ -n "$seen_bullet" ]] && gap=1
      continue
    fi
    if [[ "$line" != "- "* ]]; then
      errors+=("body line is not a '- ' bullet: ${line:0:60}")
      return
    fi
    if [[ -n "$gap" ]]; then
      errors+=("blank line between bullets; the body is one list")
      return
    fi
    seen_bullet=1
  done <<<"$body"
}

# The one trailer allowed is a DCO sign-off (the organization's CONTRIBUTING.md,
# "Licence and sign-off"): a final block of `Signed-off-by: Name <email>` lines
# after one blank line, which is where `git commit -s` puts it. It is split off
# before the bullet rules; a sign-off anywhere else is still a non-bullet line.
strip_signoff() {
  printf '%s\n' "$1" | awk '
    { line[NR] = $0 }
    END {
      n = NR
      while (n > 0 && line[n] ~ /^Signed-off-by: [^<>]+ <[^<>]+>$/) n--
      # Keep the block only when a blank line separates it from the bullets.
      if (n < NR && n > 0) { if (line[n] == "") n--; else n = NR }
      for (i = 1; i <= n; i++) print line[i]
    }'
}

# `git revert` writes `Revert "<subject>"` and `This reverts commit <full sha>.`.
# That exact shape is accepted as a special case; any other `Revert ...` subject
# is an ordinary commit and must carry a type. A reason may follow as bullets.
if grep -qE '^Revert ".+"$' <<<"$subject"; then
  revert_second="$(printf '%s\n' "$msg" | sed -n '2p')"
  revert_line="$(printf '%s\n' "$msg" | sed -n '3p')"
  if [[ -n "$revert_second" ]]; then
    errors+=("the subject must be followed by one blank line")
  fi
  if ! grep -qE '^This reverts commit ([0-9a-f]{40}|[0-9a-f]{64})\.$' <<<"$revert_line"; then
    errors+=("a revert must keep git's 'This reverts commit <full sha>.' line under the subject")
  fi
  check_bullets "$(strip_signoff "$(printf '%s\n' "$msg" | tail -n +4)")"
  if (( ${#errors[@]} > 0 )); then
    printf 'commit message: %s\n' "${errors[@]}" >&2
    exit 1
  fi
  exit 0
fi

if ! grep -qE '^(feat|fix|perf|refactor|test|docs|chore): .+' <<<"$subject"; then
  if grep -qE '^[a-z]+\(' <<<"$subject"; then
    errors+=("subject must not carry a scope: use 'type: summary'")
  else
    errors+=("subject must start with '<type>: ', type one of feat fix perf refactor test docs chore")
  fi
else
  summary="${subject#*: }"
  if grep -qE '^[A-Z]' <<<"$summary"; then
    errors+=("summary must start lower-case")
  fi
fi
if (( ${#subject} > 72 )); then
  errors+=("subject is ${#subject} characters; keep it under ~70 (hard limit 72)")
fi
if [[ "$subject" == *. ]]; then
  errors+=("subject must not end with a period")
fi
if grep -qiE '\((p|phase ?)[0-9]|\[(p|phase ?)[0-9]' <<<"$subject"; then
  errors+=("subject must not carry a phase or milestone marker")
fi

second="$(printf '%s\n' "$msg" | sed -n '2p')"
body="$(printf '%s\n' "$msg" | tail -n +3)"
if [[ -n "$second" ]]; then
  errors+=("the subject must be followed by one blank line")
fi

# The body is one bullet list: every non-blank line is a bullet, and no blank
# line separates two bullets (a gap makes the log read as paragraphs, the shape
# the bullet rule exists to prevent; 9dfbe9a1 merged with exactly that).
check_bullets "$(strip_signoff "$body")"

if (( ${#errors[@]} > 0 )); then
  printf 'commit message: %s\n' "${errors[@]}" >&2
  exit 1
fi
exit 0
