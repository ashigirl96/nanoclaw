# Console は自分の履歴の store を持つ

Console は Host が配信する Platform なので、Slack のサーバーと同じ立場で Chat の履歴の正本を自分の store に持つ。Session の Mailbox から毎回組み直す案もあったが、1 つの Chat が複数の Session にまたがるうえ、edit の反映、未読の位置、Library、Agent が待つのをやめた後の Question への答えを一貫して扱えないため採らなかった。

## Consequences

- Console の adapter は届けた Outbound Message ごとに自分の message id を返す。返さないと edit と Approval Request の更新が対象を見つけられない。
- Mailbox と Console の store には同じ内容が二重に残る。正本は、Agent から見れば Mailbox、人から見れば Console の store。
