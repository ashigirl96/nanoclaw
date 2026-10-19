# Console は Connected Account を OneCLI から直接読む

Console の Connected Account の一覧は、Console の adapter が OneCLI の REST を直接読んで作り、Gateway が OneCLI でない Install では画面ごと出さない。Gateway の seam（`GatewayProviderDefinition.connections`）に一覧の口を足せば Gateway に依存しない形になるが、core と `add-onecli` の payload に手が入り、upstream を取り込み続けるこの fork では衝突の元になるため採らなかった。OneCLI の dashboard へのリンクだけを置く案は、Console の中で何がつながっているかが見えないため採らなかった。

## Consequences

- Console は OneCLI から読むだけで、書き込まない。接続を始めるときは OneCLI の dashboard を開く。
- OneCLI の API は認証なしで agent の token まで返すので、browser に渡す値は host 側で絞る。
- Gateway を OneCLI から替えたら、この画面は消える。
