# Agent が待っていない Question への答えは Chat Message として届ける

Console では、Agent が待つのをやめた後の Question への答えと、最初から待たない Question への答えを、Console の adapter が Owner の Chat Message に変換して届ける。答えを System Message として届ける core の経路はあるが、Agent の poll loop は System Message を読み飛ばすので、Agent には届かない。それを Agent に見せるには poll loop と formatter を変えることになり、upstream を取り込み続けるこの fork では衝突の元になるため採らなかった。

## Consequences

- 答えの Chat Message は、どの Question への答えかを本文で示す。Agent から見ると、ふつうの会話の続きになる。
- Host が `pending_questions` に残している Question への答えは、Console の adapter が `question_response` の System Message として Session に書き、`ask_user_question` が取ったか（`processing_ack` が completed になったか）を数秒見届ける。取られなければその行を failed にして、Chat Message で届け直す。`ask_user_question` の `timeout` は Host から見えず、途中で取り消されることもあるので、経過時間では待っているかを判断できないため。`onAction` を通すと、取られなかった行の id が分からず、Agent を起こし続ける trigger の行が残る。
