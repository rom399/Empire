---
name: "commit-message"
description: "Generate an organized, detailed commit message from staged or recent changes. Use when the user says \"generate a commit message\", \"write a commit message\", or asks to commit changes and wants the message drafted first."
---

Generate a commit message from the current changes, then commit if the user has approved doing so (or asks you to commit in the same request).

## 1. Gather the changes

- Run `git status --short` to see what's changed.
- Run `git diff` (and `git diff --cached` if anything is already staged) to see the actual content of the changes, not just filenames.
- If the repo has prior commits, run `git log -5 --oneline` to match the existing message style (imperative mood, any prefix conventions like `feat:`/`fix:`, line length, etc.).
- If nothing is staged yet but changes exist, ask whether to stage everything or only specific files — do not assume `git add -A` unless the user says so or it's obviously the whole feature.

## 2. Structure the message

Write a message with two parts:

**Summary line** — a single imperative-mood sentence (e.g. "Add X", "Fix Y", "Refactor Z"), under ~72 characters, no period at the end.

**Body** — organized, detailed, grouped by area of change, not just a flat list of files. For each group:
- What changed (specific: function/method/class names, not just "updated logic")
- Why it changed, if not obvious from the diff alone (reference the task or bug it addresses)
- Files touched, when it helps orient the reader

Use blank lines between groups. Avoid vague lines like "various fixes" or "code cleanup" — name the actual thing that changed. If the diff includes something notable like a breaking change, a TODO left behind, or a follow-up still needed, call it out explicitly rather than letting it get buried.

Keep it factual and grounded in the actual diff — do not describe changes that aren't in the diff, and do not pad the message with generic filler to make it look thorough.

## 3. Confirm and commit

Show the drafted message to the user before committing unless they've already pre-approved committing in the same request. Once confirmed:

```
git add <files>   # if not already staged
git commit -m "<summary line>

<body>"
```

Use the repo's existing `user.name`/`user.email` config — don't override author identity unless the user asks. If commit fails due to lock files or permission issues, report the exact error rather than retrying blindly or working around it silently.
