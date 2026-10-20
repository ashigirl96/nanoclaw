---
name: tackle
description: "spec または ticket の作業を実装し、PR を出して codex review と retro を回し、merge まで運ぶ。"
disable-model-invocation: true
---

spec または ticket でユーザーが記述した作業を、実装から merge まで止まらずに運ぶ。ticket は `docs/agents/issue-tracker.md` の「issue を読む」の形で取る。`gh` には毎回 `-R ashigirl96/nanoclaw` を付ける。

## 1. branch を切る

作業は `issue-<番号>` の branch で行う。今の branch の名前が違えば、`git fetch origin main` してから `git switch --no-track -c issue-<番号> origin/main` で切る。worktree は前の ticket の branch のまま渡されることがあり、その branch は origin/main に無い commit を残しているため。前の session の作業は `origin/issue-<番号>` か、branch に載らない `salvage: … issue-<番号> …` の commit（`git log --all --oneline --grep 'issue-<番号>'`）に残っていることがあるので、あれば branch に merge するか cherry-pick してから始める。切ったら `pnpm install --frozen-lockfile` と、`container/agent-runner` で `bun install --frozen-lockfile` を流す。worktree には依存が入っていないことがあるため。

## 2. 実装する

Skill tool の `implement` を呼び、その手順に従う。手順の中の読み替えは次のとおり。

- テストスイート全体は手元で流さず、PR の CI の `gate` に任せる。手元では型チェック（`pnpm exec tsc --noEmit`、`container/agent-runner/` を触ったら `pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit` も）と、触ったテストファイルだけを流す。
- code-review の fixed point は `git merge-base origin/main HEAD` で出した SHA にする。worktree のローカルの `main` は古いことがあり、他の PR の変更が diff に混ざるため。`$(...)` を含む git は worktree の session の guard が拒むので、SHA は先に出しておく。この時点の変更はまだコミットしていないので、新しいファイルを `git add -N` で載せてから `git diff <SHA>` で渡す。
- コミットメッセージは scratchpad の file に書き、`git commit -q -F <file> >/dev/null 2>&1` で渡し、`git log --oneline -1` で載ったことを確かめる。worktree の session の guard は、heredoc やつないだコマンドで打つ git を拒むため。pre-commit の hook は `src/` の全ファイルを prettier に通して 1 行ずつ出すため。

## 3. PR を出す

`git push -u origin issue-<番号>` して、`gh pr create -R ashigirl96/nanoclaw --base main --body-file <file>` で PR を出す。本文は Skill tool の `pr` で書き、`Closes #<番号>` を入れて scratchpad の file に置く。title は `feat(console): …` のように、この fork の PR と同じ形にする。

## 4. codex review を回す

Skill tool の `watch-ai` に PR 番号を渡して、codex review の往復を終わりまで回す。

## 5. 振り返る

Skill tool の `retro` をこの session に対して呼び、今後の run に活かす改善があるか確かめる。直したものは 1 コミットにまとめて push し、直さなかった候補は merge の確認と一緒にユーザーに並べる。

## 6. merge する

`gh pr view <PR> -R ashigirl96/nanoclaw --json mergeable` で `MERGEABLE` であることを確かめる。`CONFLICTING` なら origin/main を merge して衝突を解き、型チェックが通ったら push する。衝突している PR では CI が走らず、`gh pr checks` は古い commit の結果を返すため。

`gh pr checks <PR> -R ashigirl96/nanoclaw --watch --required` で必須の `gate` が通ったのを確かめてから、merge してよいかをユーザーに尋ねる。了承を得たら `gh pr merge <PR> -R ashigirl96/nanoclaw --merge` で merge する。この fork は merge commit で main に入れている。

## 7. main に戻って host を入れ替える

`git fetch origin main` をして merge 後の main に移る。本体の checkout では `git switch main` と `git merge --ff-only origin/main`、worktree では `git switch --detach origin/main` にする（`main` は本体の checkout が握っていて、worktree では switch できない）。

本体の checkout では続けて host を入れ替える。main の commit が変わると host は upgrade tripwire で起動を止めるので、ローカルの運用ルールの「local commit の後の再起動」の手順で build・marker の打ち直し・再起動を行う。PR が `container/` を触っていれば、再起動の前に `./container/build.sh` で agent の image も作り直す。merge の了承が入れ替えの了承を兼ねる。
