# Label と Avatar は Console の store に持つ

Agent Group の Label と Avatar は、中央 DB の `agent_groups` に列を足さず、Console の store に持つ。どちらも Console だけが使う見た目の情報で、upstream を取り込み続けるこの fork では、core の schema と migration に手を入れると衝突の元になるため。ADR 0001 と同じく、Console が表すものの正本は Console が持つ。

## Consequences

- Slack と `ncl` からは Label と Avatar が見えない。Agent の prompt にも入らない。
- 後で他の Platform と共有したくなったら、Console の store から中央 DB へ移す作業が要る。
