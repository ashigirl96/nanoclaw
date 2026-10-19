# Issue tracker: GitHub

この repo の issue と spec は、GitHub の `ashigirl96/nanoclaw` の Issues に置く。操作はすべて `gh` CLI で行う。

upstream の `nanocoai/nanoclaw` には issue も PR も出さない。この checkout は remote を 2 つ持ち、`gh` の自動推定が upstream を選ぶことがあるので、`gh` のコマンドには必ず `-R ashigirl96/nanoclaw` を付ける。

## 操作

- **issue を作る**: `gh issue create -R ashigirl96/nanoclaw --title "..." --body "..."`。複数行の本文は heredoc で渡す。
- **issue を読む**: `gh issue view <番号> -R ashigirl96/nanoclaw --json number,title,body,labels,comments`
- **issue を一覧する**: `gh issue list -R ashigirl96/nanoclaw --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`。必要に応じて `--label` と `--state` で絞る。
- **親 issue の sub-issue にする**: `gh issue create -R ashigirl96/nanoclaw --parent <親> ...`、または作った後に `gh issue edit <親> -R ashigirl96/nanoclaw --add-sub-issue <子>`（`gh` 2.94 以降）。古い `gh` では `gh api --method POST repos/ashigirl96/nanoclaw/issues/<親>/sub_issues -F sub_issue_id=<子の database id>`（database id は下の **Blocking** と同じ）。sub-issue を使えないときは、子の本文の先頭に `Part of #<親>` を書く。
- **comment する**: `gh issue comment <番号> -R ashigirl96/nanoclaw --body "..."`
- **label を付ける・外す**: `gh issue edit <番号> -R ashigirl96/nanoclaw --add-label "..."` / `--remove-label "..."`
- **閉じる**: `gh issue close <番号> -R ashigirl96/nanoclaw --comment "..."`

## PR を triage の対象にするか

**PRs as a request surface: no.** _（外部からの PR を機能要望として扱う repo なら `yes` にする。`/triage` がこの値を読む。）_

`yes` のときは、PR も issue と同じ label と状態で扱い、`gh pr` の同等のコマンドを使う。

- **PR を読む**: `gh pr view <番号> -R ashigirl96/nanoclaw --comments`、diff は `gh pr diff <番号> -R ashigirl96/nanoclaw`
- **triage する外部 PR を一覧する**: `gh api --paginate 'repos/ashigirl96/nanoclaw/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`
- **comment・label・close**: `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`（いずれも `-R ashigirl96/nanoclaw` を付ける）

GitHub は issue と PR で番号を共有するので、`#42` だけではどちらか分からない。`gh pr view 42` で確かめ、PR でなければ `gh issue view 42` を使う。

## skill が「issue tracker に publish する」と言ったとき

`ashigirl96/nanoclaw` に GitHub issue を作る。

## skill が「関連する ticket を取ってくる」と言ったとき

上の **issue を読む** の手順で読む。

## Wayfinding の操作

`/wayfinder` が使う。**map** は 1 つの issue で、ticket はその **子** の issue として作る。

- **Map**: `wayfinder:map` label を付けた 1 つの issue。本文に Notes / Decisions-so-far / Fog を持つ。`gh issue create -R ashigirl96/nanoclaw --label wayfinder:map`
- **子 ticket**: map の GitHub sub-issue としてつないだ issue（**親 issue の sub-issue にする** を参照）。sub-issue を使えないときは、map の本文の task list に子を足し、子の本文の先頭に `Part of #<map>` を書く。label は `wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。着手したら、作業している dev を assignee にする。
- **Blocking**: GitHub の **native issue dependencies** で表す。UI に出る正式な表現はこれになる。依存の追加は `gh api --method POST repos/ashigirl96/nanoclaw/issues/<子>/dependencies/blocked_by -F issue_id=<blocker の database id>`。`<blocker の database id>` は blocker の数値の **database id**（`gh api repos/ashigirl96/nanoclaw/issues/<n> --jq .id`）で、`#番号` や `node_id` ではない。GitHub は `issue_dependencies_summary.blocked_by` に open の blocker の数だけを返し、これが着手できるかの判定になる。dependencies を使えないときは、子の本文の先頭に `Blocked by: #<n>, #<n>` の行を書く。blocker がすべて closed になったら、その ticket は着手できる。
- **Frontier の求め方**: map の open な子を一覧し（`gh issue list -R ashigirl96/nanoclaw --state open` を map の sub-issue か task list に絞る）、open な blocker を持つもの（`issue_dependencies_summary.blocked_by > 0`、または `Blocked by` 行に open の issue があるもの）と assignee がいるものを除く。残りのうち map で先に並ぶものを取る。
- **着手**: session で最初の書き込みとして `gh issue edit <n> -R ashigirl96/nanoclaw --add-assignee @me` を実行する。
- **解決**: `gh issue comment <n> -R ashigirl96/nanoclaw --body "<答え>"`、次に `gh issue close <n> -R ashigirl96/nanoclaw`、最後に map の Decisions-so-far へ要点とリンクを足す。
