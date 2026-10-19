# Agent が待っていない Question への答えは Chat Message として届ける

Console では、Agent が待つのをやめた後の Question への答えと、最初から待たない Question への答えを、Console の adapter が Owner の Chat Message に変換して届ける。答えを System Message として届ける core の経路はあるが、Agent の poll loop は System Message を読み飛ばすので、Agent には届かない。それを Agent に見せるには poll loop と formatter を変えることになり、upstream を取り込み続けるこの fork では衝突の元になるため採らなかった。

## Consequences

- 答えの Chat Message は、どの Question への答えかを本文で示す。Agent から見ると、ふつうの会話の続きになる。
- `ask_user_question` が待っている間の答えは、従来どおり `onAction` で返す。
