# NanoClaw

Platform の Chat と Agent の間を Host がつなぎ、Agent の操作を Host が判断する仕組みの語彙。

## Entity

**Host**:
install ごとに 1 つ動く NanoClaw の本体。Chat と Agent の間を取り持ち、Privileged Action を判断する。
_Avoid_: server, daemon, orchestrator

**Agent**:
Session ごとに隔離された container の中で動く AI。外とは Mailbox を通してしかやり取りしない。
_Avoid_: bot, assistant, container

**Agent Group**:
1 つの Agent の人格・記憶・workspace・container の設定のまとまり。複数の Session が同じ Agent Group を共有できる。
_Avoid_: agent, group, workspace

**Messaging Group**:
NanoClaw に登録された 1 つの Chat。
_Avoid_: channel, chat group

**Wiring**:
Messaging Group と Agent Group のつなぎ。その Chat のどの発言で Agent を起こすか、Session をどう分けるかを持つ。
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

**Sender Admission**:
Unknown Sender の発言を Agent に届くよう受け入れること。Privileged Action の 1 つ。
_Avoid_: sender approval

## Platform

**Platform**:
人がやり取りに使う外部のメッセージングサービス。Slack、Discord、WhatsApp、email、GitHub など。
_Avoid_: channel, channel type, service

**Channel**:
NanoClaw が 1 つの Platform につなぐための連携。
_Avoid_: Platform の意味や Chat の意味で "channel" を使うこと

**Chat**:
Platform の中にある 1 つの会話の場。Slack の channel、WhatsApp の group、DM、email の thread など。
_Avoid_: channel, conversation, room

**Thread**:
Chat の中で話題ごとに分かれた小さな会話。Slack の thread や GitHub の PR comment thread など。Platform によっては無い。

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
新しく起動した Agent container のためだけに取っておかれる Inbound Message。入れ替わる前の container には拾われない。
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

**Run Log**:
Agent が Task を実行したときの経過を記録する Outbound Message。
_Avoid_: task_log

**Delivery**:
Host が Outbound Message を Chat か別の Agent へ届けること。結果は Delivered か Delivery Failed になる。
_Avoid_: Inbound 側の出来事に "deliver" を使うこと

**Destination**:
Session の Agent が送信を許されている Chat または Agent。一覧に載っていることがそのまま許可になる。

**Bound Chat**:
Session が紐づく 1 つの Chat。宛先を指定しない問いかけやカードはここに出る。Session が Thread ごとに分かれていれば、その Thread まで含む。
_Avoid_: session routing, reply target

## Guard

Agent や人が起こす操作のうち、Host が実行してよいかを判断してから実行するものと、その判断に人が加わる流れ。

### Decision

**Privileged Action**:
実行する前に Guard の判断を要する操作。System Action、`ncl` コマンド、Agent Message、Sender Admission、Messaging Group の登録など、出どころを問わない。
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
gateway が credential を使う request を保留したときに出る Approval Request。Guard を通らず、Approve されても Replay は無く、結果を gateway に返すだけ。
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

## Access

User が Agent Group に対して持つ権限の段階。

**Owner**:
install 全体に対して全権を持つ User。権限は常に全 Agent Group に及ぶ。

**Admin**:
Agent Group を管理する権限を持つ User。全 Agent Group に及ぶ Global Admin と、特定の Agent Group に限る Scoped Admin がある。
_Avoid_: operator, moderator

**Member**:
特権を持たず、Agent Group を使うことだけを許された User。
_Avoid_: user, participant
