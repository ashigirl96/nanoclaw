# Karpathy LLM Wiki を削除する

各手順は冪等（何度実行しても結果が変わらないこと）になっている。再実行しても安全だ。

## 1. 共有のコンテナ skill を削除する

`wiki`（LLM Wiki のコンテナ skill）は、共有の `container/skills/`（コンテナに配る skill を置くディレクトリ）にある。このディレクトリは自動で見つけられ、すべての agent group（NanoClaw のエージェントの単位。作業領域と CLAUDE.md を持つ）にシンボリックリンクで組み込まれる。以下のコマンドで削除し、どのコンテナにも表示されないようにする。

```bash
rm -rf container/skills/wiki
```

## 2. グループの `CLAUDE.md` から wiki の節を削除する

wiki の節は、マーカーのコメント（節の始まりと終わりを示す目印の行）で囲まれている。ブロックを、マーカーごと、グループの `CLAUDE.md` から削除する。`groups/<folder>/CLAUDE.md` にあるので、そこを探す。

```bash
# Replace <folder> with the group folder you set up the wiki for.
perl -0pi -e 's/\n?<!-- BEGIN karpathy-llm-wiki -->.*?<!-- END karpathy-llm-wiki -->\n?//s' groups/<folder>/CLAUDE.md
```

マーカーがなければ、何も削除されない（ブロックがすでに無いか、最初から追加されていなかった場合）。

## 3. コンテナが skill を外すよう再起動する

```bash
source setup/lib/install-slug.sh
launchctl kickstart -k gui/$(id -u)/$(launchd_label)  # macOS
# Linux: systemctl --user restart $(systemd_unit)
```

## ユーザーのコンテンツは残る

グループごとの `groups/<folder>/wiki/`（ユーザー自身の知識ベース）と `groups/<folder>/sources/`（取り込んだ元資料）には、ユーザーの内容が入っている。これらは残す。wiki の内容も消したいとユーザーが明示した場合に限り、手で削除する。

```bash
rm -rf groups/<folder>/wiki groups/<folder>/sources
```
