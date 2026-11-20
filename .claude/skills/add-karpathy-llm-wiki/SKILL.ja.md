---
name: add-karpathy-llm-wiki
description: NanoClaw のグループに永続的な wiki のナレッジベースを追加する。Karpathy の LLM Wiki パターンに基づく。次の語で起動する: "add wiki", "wiki", "knowledge base", "llm wiki", "karpathy wiki"。
---

# Karpathy LLM Wiki を追加する

NanoClaw に、Karpathy の LLM Wiki パターンに基づく永続的な wiki のナレッジベースを設定する。

どのステップも再実行しても安全である。ディレクトリの作成は `mkdir -p` で行い、初期の wiki ファイルは存在しない場合にだけ作る。コンテナ（エージェントが動く実行環境）内で読み込まれる skill は、利用者が更新を選ばない限り残す。グループ（NanoClaw でエージェントを 1 つ割り当てる会話の単位）の CLAUDE.md の節は、置き換え位置を示す HTML コメント（マーカー）を頼りにその場で置き換え、重複させない。

## ステップ 1: パターンを読む

`${CLAUDE_SKILL_DIR}/llm-wiki.md` を読む。これは Karpathy が書いた LLM Wiki の考え方の全文である。先に進む前に十分に理解する。中心となる考え方を利用者に短くまとめてから、何を作りたいかを話し合う。

## ステップ 2: グループを選ぶ

`AskUserQuestion`（利用者に選択肢を出して答えを聞く道具）: 「wiki はどのグループに置きますか？」

1. **メインのグループ** — 既存のメインのチャットに追加する
2. **専用のグループ** — wiki 専用の新しいグループを作る
3. **その他** — 既存のグループから選ぶ

専用の場合は、どのチャネル（Slack などのメッセージの経路）とチャットかを聞き、`pnpm exec tsx setup/index.ts --step register` で登録する。

## ステップ 3: 一緒に設計する

パターンをもとに、利用者と次の点を話し合う:
- wiki の分野やテーマは何か
- どんな種類の資料（`sources/` に置く元の文書）を追加するか（URL、PDF、画像、ボイスメモ、書籍、文字起こし）
- 三層構成（資料、wiki、schema（wiki の運用ルールを書いた層））の完全版にするか、軽い版にするか
- 特に大事にしたい規約はあるか（パターンはこの点をあえて決めていない）

この話し合いをもとに、次の三つを作る:

### 3a. ディレクトリの構成

グループのフォルダに `wiki/` と `sources/` のディレクトリを作る（`mkdir -p` を使うので、既にあっても安全）。パターンの Indexing と Logging の節に従い、利用者の分野に合わせて初期の `index.md` と `log.md` を作る。すでに存在するファイルは飛ばし、中身の入った wiki を再実行で上書きしないようにする。

### 3b. コンテナ用 skill

利用者の wiki に合わせて `container/skills/wiki/SKILL.md` を作る。これはパターンの schema の層にあたり、エージェントに wiki の保守の仕方を伝える。パターンの Operations の節（取り込み＝ingest、問い合わせ＝query、点検＝lint）と、利用者と合意した規約をもとにする。細かく決めすぎない。パターンには「あとは LLM が考える」とある。

`container/skills/wiki/SKILL.md` がすでにある場合は、上書きする前に更新してよいか利用者に聞く。こうすれば、手を入れた既存の schema は再実行しても残る。

### 3c. グループの CLAUDE.md

グループの CLAUDE.md に wiki の節を追加する。節は、再実行のときに見つけて置き換えられるよう、次のマーカーコメントで囲む:

```markdown
<!-- BEGIN karpathy-llm-wiki -->
## Wiki
...section body...
<!-- END karpathy-llm-wiki -->
```

`<!-- BEGIN karpathy-llm-wiki -->` の塊がすでにあれば、末尾に二つ目を足さず、その場で置き換える。これは最も重要な点である。この節がエージェントを wiki の保守役にする。節には次を書く:

- wiki の仕組みを簡潔に説明する: 何であるか、三つの層（資料、wiki、schema）、三つの操作（取り込み、問い合わせ、点検）
- 主要なファイルとフォルダを索引に載せる（`wiki/`、`sources/`、`wiki/index.md`、`wiki/log.md`）
- 詳しい手順はコンテナ用 skill を参照するよう示す
- **取り込みの決まり:** 利用者が複数のファイルを渡すか、多数のファイルがあるフォルダを指したら、エージェントは必ず一つずつ処理しなければならないと、明確に書く。各ファイルについて、読み、要点を話し合い、wiki のページ（要約、個々の対象のページ、概念のページ、相互参照、`index.md`、`log.md`）を作成・更新し、そのファイルを完全に終えてから次に進む。すべてのファイルをまとめて読んでから一括で処理してはならない。それではパターンが求める深い統合ではなく、浅く一般的なページになるからである。

## ステップ 4: 資料を扱う機能

取り込む予定の資料の種類（ステップ 3 で話し合ったもの）をもとに、エージェントがその形式をすでに扱えるかを確かめる。標準で扱えるものもあれば、skill が要るものもある（例: `/add-image-vision`、`/add-pdf-reader`、`/add-voice-transcription`）。必要な機能が入っていなければ、それに使える skill があるかを確かめ、利用者が設定できるよう手伝う。

### URL の扱いに関する注意

claude には組み込みの `WebFetch`（URL の内容を取得して要約を返す道具）があるが、返すのは全文ではなく要約である。全文が重要になる URL を wiki に取り込む場合は、コンテナ用 skill と CLAUDE.md で、代わりに bash コマンドを使って全文のファイルを取得するよう指示する。例えば次のとおり:

```bash
curl -sLo sources/filename.pdf "<url>"
```

文書が Web ページの場合は、claude は取得の道具（fetch）か `agent-browser`（ブラウザを自動操作する道具）でページを開き、取得できるなら全文を抜き出せる。コンテナ用 skill と CLAUDE.md にはこの点を書き、claude が要約ではなく資料の全文を得られるようにする。


## ステップ 5: 任意の点検スケジュール

`AskUserQuestion`: 「wiki の定期的な点検を入れますか？」

1. **毎週**
2. **毎月**
3. **入れない** — 点検は手動で行う

「はい」なら、会話の中で、MCP（外部の道具を接続する仕組み）の `schedule_task` ツールを使って点検のタスクを予約するようエージェントに頼む。

## ステップ 6: 再起動

NanoClaw のプロジェクトのルートで次を実行する:

```bash
source setup/lib/install-slug.sh
launchctl kickstart -k gui/$(id -u)/$(launchd_label)  # macOS
systemctl --user restart $(systemd_unit)              # Linux
```

資料を wiki のグループに送り、動作を確かめるよう利用者に伝える。
