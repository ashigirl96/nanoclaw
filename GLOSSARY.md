# NanoClaw

Platform の Chat と Agent の間を Host がつなぎ、Agent の操作を Host が判断する仕組みの語彙。

## Entity

**Install**:
1 つの checkout から動く NanoClaw 一式。Host を 1 つ持ち、1 台のマシンに複数並べられる。
_Avoid_: copy, installation, instance

**Host**:
Install ごとに 1 つ動く NanoClaw の本体。Chat と Agent の間を取り持ち、Privileged Action を判断する。
_Avoid_: server, daemon, orchestrator

**Agent**:
Session ごとに隔離された Container の中で動く AI。外とは Mailbox を通してしかやり取りしない。
_Avoid_: bot, assistant, container

**Agent Provider**:
Agent を動かす AI の実装。Claude、OpenCode、Codex など。Agent Group ごとに選ぶ。
_Avoid_: provider（単独で）, model, runtime

**Container**:
1 つの Session の Agent が動く、隔離された使い捨ての実行環境。止まっても Session は続き、次に仕事が来れば新しい Container が起きる。
_Avoid_: sandbox, VM

**Agent Group**:
1 つの Agent の Standing Instructions・Memory・Workspace・実行環境の設定のまとまり。複数の Session が同じ Agent Group を共有できる。
_Avoid_: agent, group, workspace

**Messaging Group**:
1 つの Channel から見た 1 つの Chat。同じ Chat でも Channel が違えば別の Messaging Group になる。
_Avoid_: channel, chat group

**Wiring**:
Messaging Group と Agent Group のつなぎ。その Chat のどの発言で Agent を Engage するか、Session をどう分けるか、Thread を区別するかを持つ。
_Avoid_: binding, link, route

**Session**:
1 つの Agent Group が続ける 1 本の会話。Wiring によって、1 つの Chat や Thread に閉じることも、複数の Chat にまたがることもある。Mailbox を 1 つ持つ。
_Avoid_: conversation, container

**User**:
Platform 上の 1 つの identity。同じ人でも Platform が違えば別の User になる。
_Avoid_: person, account, member

**Unknown Sender**:
Chat で発言したが、その Agent Group の Member でも Admin でも Owner でもない User。
_Avoid_: unregistered sender, stranger

**Unknown Sender Policy**:
Messaging Group ごとに決める、Unknown Sender が Agent を Engage しようとした発言の扱い。黙って捨てる・Sender Admission にかける・断って Owner に知らせる・誰でも受け入れる、のいずれか。

**Sender Admission**:
Unknown Sender の発言を受け入れ、その User を Member にすること。Privileged Action の 1 つ。
_Avoid_: sender approval

**Chat Registration**:
Wiring の無い Chat で Agent が Mention されたとき、その Chat をどの Agent Group につなぐかを Owner に選んでもらう手続き。断られた Chat は以後無視される。
_Avoid_: channel registration

## Platform

**Platform**:
人がやり取りに使うメッセージングサービス。Slack、Discord、WhatsApp、email、GitHub などの外部のものと、Host が自ら配信する Console がある。
_Avoid_: channel, channel type, service

**Console**:
Host が自ら配信する、Owner だけが使う Platform。Agent Group を一覧に並べ、Agent Group ごとに 1 つの Chat を持ち、Owner が Group Chat を作れる。
_Avoid_: web UI, local-web, dashboard

**Inbox**:
Console の中で Owner の DM にあたる Chat。どの Agent Group の Chat にも属さない Approval Request や知らせが届く。
_Avoid_: notifications, DM

**Group Chat**:
Console の中で Owner が作り、複数の Agent Group が加わる Chat。Agent は Mention されたときだけ答える。
_Avoid_: room, multi-agent chat

**Library**:
Console で Agent Group ごとに見られる、その Agent が Console に届けたファイルの一覧。
_Avoid_: artifacts, files, workspace

**Channel**:
NanoClaw が 1 つの identity で Platform につなぐ連携。1 つの Platform に複数の Channel を持てる。
_Avoid_: adapter, adapter instance, bot, Platform の意味や Chat の意味で "channel" を使うこと

**Chat**:
Platform の中にある 1 つの会話の場。Slack の channel、WhatsApp の group、DM、email の thread など。
_Avoid_: channel, conversation, room

**Thread**:
Chat の中で話題ごとに分かれた小さな会話。Slack の thread や GitHub の PR comment thread など。Platform によっては無い。

## Wiring

Chat の発言を、どの Agent Group のどの Session に届け、いつ Agent を起こすかの決まり。

**Engage**:
Wiring が Chat Message を見て、Agent を起こすと決めること。Engage された発言が Triggering Message になる。
_Avoid_: trigger（動詞として）

**Mention**:
Chat の中で Agent を名指しすること。DM での発言は Mention として扱う。
_Avoid_: ping, @

**Engage Pattern**:
Wiring が発言の本文に当てる型。当たった発言を Engage する。すべての発言に当たる型にすれば、Agent は毎回起きる。
_Avoid_: trigger, trigger rule

**Sticky Thread**:
一度 Mention で Engage した Thread。その Session が続く間は、Mention の無い発言も Engage する。Accumulate だけで Session ができた Thread は Sticky Thread ではない。
_Avoid_: subscribed thread, mention-sticky

**Per-Chat Session**:
1 つの Chat に 1 つの Session を割り当てる分け方。
_Avoid_: shared session

**Per-Thread Session**:
1 つの Thread に 1 つの Session を割り当てる分け方。
_Avoid_: shared session

**Agent-Wide Session**:
その Agent Group につながる複数の Chat が 1 つの Session を共有する分け方。
_Avoid_: shared session

**Sender Scope**:
Wiring ごとに、Agent を Engage できる User を Member・Admin・Owner に絞る設定。

**Accumulate**:
Wiring が Engage しなかった Chat Message を、Context Message として Session に残すこと。Session が無ければ作るが、Agent は起こさない。
_Avoid_: background context, silent context, ambient

**Dropped Message**:
Agent を起こそうとしたのに、どの Agent にも届かず記録に残った Chat Message。Wiring が無いとき、どの Wiring も Engage しなかったとき、Unknown Sender だったときに起きる。
_Avoid_: unregistered sender

## Session Mailbox

Host と 1 つの Session の Agent との間でメッセージをやり取りする面。両者のやり取りはすべてここを通り、ほかの経路は無い。

### Mailbox

**Mailbox**:
Session の Host と Agent をつなぐ唯一の IO 面で、向きの決まった 2 本のキューの組。1 つの Session に Inbound Mailbox と Outbound Mailbox が 1 つずつある。
_Avoid_: session DB, mailbox DB, inbound.db / outbound.db

**Inbound Mailbox**:
Mailbox のうち、Agent へ向かう仕事を運ぶ側。書き込むのは Host だけ。
_Avoid_: inbound.db, inbound DB

**Outbound Mailbox**:
Mailbox のうち、Agent の出力を Host へ運ぶ側。書き込むのは Agent だけ。
_Avoid_: outbound.db, outbound DB

### Inbound Messages

**Inbound Message**:
Host が Inbound Mailbox に入れる、仕事または文脈の 1 単位。
_Avoid_: messages_in row, message_in

**Chat Message**:
Chat で人が発言した内容を運ぶ Inbound Message。
_Avoid_: chat-sdk message

**Task**:
後の時刻に実行するよう予約された Inbound Message。1 回きりのものと、繰り返すものがある。
_Avoid_: job, cron

**Recurring Task**:
予定に沿って繰り返す Task。Occurrence が連なってできている。
_Avoid_: series

**Occurrence**:
Recurring Task の 1 回分の実行。それぞれが独立した Inbound Message になる。
_Avoid_: run

**Agent Message**:
別の Session の Agent が送ってきた Inbound Message。返事は人ではなく、送り元の Session へ戻る。
_Avoid_: a2a message, cross-session message

**Webhook Message**:
外部サービスから push されたイベントを運ぶ Inbound Message。

**System Message**:
Host 自身が発する Inbound Message。Agent が出した質問や CLI 要求への答えなど。

**Triggering Message**:
Agent を起こして対応させる Inbound Message。

**Context Message**:
Agent が背景として目にするが、それ単独では Agent を起こさない Inbound Message。
_Avoid_: passive message, silent message, non-trigger message

**Wake Message**:
新しく起動した Container の Agent のためだけに取っておかれる Inbound Message。Restart で入れ替わる前の Container には拾われない。
_Avoid_: on_wake message, restart message

### Processing

**Pending**:
Agent に Claim されるのを待っている Inbound Message の状態。指定の時刻までは Claim されないこともある。

**Paused Task**:
Host が脇へ置いた Task。再開されるまで Claim されない。

**Cancelled Task**:
実行前に Host が取り下げた Task。以後 Claim されることは無い。

**Claim**:
Agent が Inbound Message を拾い、処理中であると表明すること。
_Avoid_: ack, processing ack

**Outcome**:
Agent が Claim した Inbound Message の処理を終えたという報告。
_Avoid_: ack

**Completed**:
Host がその Inbound Message を処理済みとみなした状態。Agent が Outcome で失敗と報告したものも含む。

**Failed**:
Host がその Inbound Message を諦めた状態。何度試しても Outcome に至らなかったときと、事前に走る script が error になったときに起きる。
_Avoid_: errored

### Outbound Messages

**Outbound Message**:
Agent が Outbound Mailbox に入れる出力の 1 単位。返信か、Host への依頼のどちらか。
_Avoid_: messages_out row, message_out

**System Action**:
Agent ができない操作を、代わりに Host に頼む Outbound Message。Agent Group の設定変更、Agent の作成、`ncl` コマンドの実行など。中には Privileged Action のものもある。
_Avoid_: outbound system message

**Question**:
Agent が Chat に出す、選択肢か入力欄を持つ問いかけ。人はいつ答えてもよく、答えは Agent に届く。Approver に向けた Approval Request とは別物。
_Avoid_: card, prompt, ask, form

**Run Log**:
Agent が Task を実行したときの経過を記録する Outbound Message。
_Avoid_: task_log

**Delivery**:
Host が Outbound Message を Chat か別の Agent へ届けること。結果は Delivered か Delivery Failed になる。System Action と Run Log は Host が処理するもので、Delivery の対象ではない。
_Avoid_: Inbound 側の出来事に "deliver" を使うこと

**Delivered**:
Host が Outbound Message を届け終えた状態。

**Delivery Failed**:
Host が何度試しても Outbound Message を届けられず、諦めた状態。
_Avoid_: Failed（Inbound Message の状態）

**Destination**:
Session の Agent が送信を許されている Chat または Agent。一覧に載っていることがそのまま許可になる。

**Bound Chat**:
Session が紐づく 1 つの Chat。宛先を指定しない問いかけやカードはここに出る。Session が Thread ごとに分かれていれば、その Thread まで含む。
_Avoid_: session routing, reply target

## Agent Group

1 つの Agent Group が持つものと、その中身を変える操作。

**Standing Instructions**:
その Agent Group の Agent に常に効く、役割や人格の指示。
_Avoid_: persona, personality, CLAUDE.md, system prompt

**Memory**:
Agent が自分で書き足し、Session をまたいで持ち越す知識。Agent Group ごとに 1 つ。
_Avoid_: notes, auto-memory

**Workspace**:
Agent Group ごとのファイル置き場。Memory もこの中にある。

**Agent Skill**:
Agent が Container の中で使える手順書。
_Avoid_: skill（単独で）, container skill

**Operator Skill**:
運用者が Install を変えるために使う手順書。Channel や Gateway を入れるものなど。
_Avoid_: skill（単独で）

**Template**:
Agent Group の雛形。Standing Instructions、Agent Skill、Task などを持ち、Credential と Agent Provider は持たない。
_Avoid_: plugin, agent plugin

**Stamp**:
Template から Agent Group を作ること、または作った Agent Group を Template の今の内容に合わせ直すこと。Memory と Wiring には触れない。
_Avoid_: restamp, instantiate

**Self-Modification**:
Agent が自分の Agent Group にパッケージや MCP server を足すよう Host に頼む System Action。必ず Hold になる。
_Avoid_: self-mod, self-customize

**CLI Scope**:
Agent が `ncl` で触れる範囲。使えない・自分の Agent Group だけ・Install 全体（Operator だけに許された操作を除く）、の 3 段階。

**Owner Agent Group**:
CLI Scope が Install 全体の Agent Group。いくつかの Privileged Action を承認なしで行える。
_Avoid_: main agent, primary agent, trusted group

**Restart**:
Container を止め、新しい Container で Agent を起こし直すこと。Agent Group 単位でも Session 単位でも行え、Wake Message を添えられる。

## Guard

Agent や人が起こす操作のうち、Host が実行してよいかを判断してから実行するものと、その判断に人が加わる流れ。

### Decision

**Privileged Action**:
実行する前に Guard の判断を要する操作。System Action、`ncl` コマンド、Agent Message、Sender Admission、Chat Registration など、出どころを問わない。
_Avoid_: guarded action, admin action

**Guard**:
Privileged Action に Allow・Hold・Deny のいずれかを下す、Host の唯一の判断役。
_Avoid_: gate, policy, check

**Actor**:
Privileged Action を起こした主体。Host、Agent、User、system のいずれか。
_Avoid_: caller

**Allow**:
Guard が Privileged Action をそのまま実行させる判断。

**Hold**:
Guard が Privileged Action を Approver の承認待ちにする判断。
_Avoid_: approval-pending, request approval, pending

**Deny**:
Guard が Privileged Action を実行させない判断。人の判断を介さない。
_Avoid_: reject

**Admin Command**:
Chat の中で Admin と Owner だけが使えるコマンド。`/clear` など。Guard を通らない。
_Avoid_: gated command

### Approval

**Approval Request**:
Approver に承認を求める依頼。Hold から生まれるものと、Credential Approval がある。
_Avoid_: pending approval, approval card

**Credential Approval**:
Gateway が Credential を使う request を保留したときに出る Approval Request。Guard を通らず、Approve されても Replay は無く、結果を Gateway に返すだけ。
_Avoid_: gateway request

**Approver**:
Approval Request に答える User。指定が無ければ、その Agent Group の Scoped Admin、Global Admin、Owner の順に選ばれる。

**Approve**:
Approver が Approval Request を受け入れること。

**Reject**:
Approver が Approval Request を断ること。
_Avoid_: deny

**Replay**:
Approve された Privileged Action を、Guard にもう一度通して実行すること。承認で満たせるのは Hold だけで、Deny に当たれば実行されない。
_Avoid_: grant, re-run

## Gateway

Agent の外向きの通信に Credential を差し込む仕組みと、それが使えないときの扱い。

**Gateway**:
Install に 1 つ置く、Agent の外向きの通信を仲介する外部の仕組み。Credential を持ち、通信のその場で差し込むので、Agent は Credential を見ない。
_Avoid_: credential gateway, gateway provider, proxy

**Credential**:
外部サービスに入るための秘密。Gateway だけが持ち、Agent には渡さない。API key や OAuth token など。
_Avoid_: secret, token

**Account Connection**:
Agent Group が外部サービスを続けて使えるよう、Gateway の側で Credential を用意する手続き。1 回の request を許すだけの Credential Approval とは別物。
_Avoid_: connect, OAuth approval

**Connected Account**:
Gateway が Credential を持っている、外部サービスのアカウント 1 つ。Account Connection の結果できる。
_Avoid_: connection, app, integration

**Gateway Outage**:
Gateway が使えない状態。その間 Host は Container を動かさず、届いた Inbound Message は Pending のまま待つ。
_Avoid_: session admission, gateway unavailable

## Access

Agent Group と Install を扱う人が持つ権限の段階。

**Owner**:
Install 全体に対して全権を持つ User。権限は常に全 Agent Group に及ぶ。

**Admin**:
Agent Group を管理する権限を持つ User。全 Agent Group に及ぶ Global Admin と、特定の Agent Group に限る Scoped Admin がある。
_Avoid_: operator, moderator

**Member**:
特権を持たず、Agent Group を使うことだけを許された User。
_Avoid_: user, participant

**Operator**:
Install のマシンで、Chat を介さずに Host を直接扱う人。Owner と同じ人であることが多いが、Owner は Chat の User を指す。
