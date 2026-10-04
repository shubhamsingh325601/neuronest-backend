#!/usr/bin/env node
// PreToolUse hook (Bash): commits and PRs must carry the logged-in git user only.
// Blocks any git commit / gh pr command that adds Claude/Anthropic authorship or a
// "Generated with Claude Code" line. Exit code 2 feeds the message back to Claude.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(raw).tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  if (!/\bgit\b[^\n]*\b(commit|tag|merge)\b|\bgh\s+pr\b/.test(command)) process.exit(0);

  const banned = [
    /co-authored-by:[^\n]*(claude|anthropic)/i,
    /generated with[^\n]*claude/i,
    /noreply@anthropic\.com/i,
    /--author[=\s]+["']?[^\n"']*(claude|anthropic)/i,
    /user\.(name|email)[=\s]+["']?[^\n"']*(claude|anthropic)/i,
  ];
  if (banned.some((re) => re.test(command))) {
    process.stderr.write(
      'Blocked: commits/PRs in this repo must be authored by the logged-in git user only. ' +
        'Remove any Co-Authored-By / "Generated with Claude Code" line and any Claude author override, then retry.\n',
    );
    process.exit(2);
  }
  process.exit(0);
});
