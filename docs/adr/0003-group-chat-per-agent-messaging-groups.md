# Group Chat は Agent ごとの Messaging Group に分け、Mention は Console が判定する

Console の Group Chat は、1 つの Chat に参加する Agent Group の数だけ Messaging Group と Wiring を持つ。Owner が発言すると、Console の adapter は参加者ごとに `onInbound` を呼び、`@` で名指しされた Agent にだけ `isMention` を立てる。core の `deliver` は返信した Agent を adapter に伝えず、router は Mention を発言ごとに 1 つの flag でしか受け取らない。そのため 1 つの Chat を 1 つの Messaging Group にすると、返信が誰のものか分からず、Mention をどの Agent に向けたかも区別できない。この形なら platform id だけで両方が決まり、upstream を取り込み続けるこの fork で core を変えずに済む。

## Considered Options

- 1 つの Messaging Group に複数の Wiring を張り、Engage Pattern `@{name}` で呼び分ける: 返信した Agent が分からない。Agent の返信を他の参加者の文脈に回すと、本文の `@` に Pattern が合って Agent が起きてしまう。
- core の adapter 契約を広げ、Mention された Agent Group の一覧を渡す: router と全 adapter に差分が広がる。

## Consequences

- Group Chat の platform id は `web:gc:<chatId>:<agentGroupId>`。`console.db` の履歴と既読位置は、Agent Group ではなく Chat を key にする。
- Agent の返信は、Console が `isMention: false` で他の参加者に回し、Context Message として積む。Agent が Agent を起こすことはないので、往復の上限は持たない。
