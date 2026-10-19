# Triage label

skill は 5 つの triage role の名前で label を指す。この file は、その role とこの repo の issue tracker で実際に使う label 名を対応づける。

| mattpocock/skills の label | この tracker の label | 意味                                     |
| -------------------------- | --------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`        | maintainer の判断を待っている            |
| `needs-info`               | `needs-info`          | 起票者からの追加情報を待っている         |
| `ready-for-agent`          | `ready-for-agent`     | spec が揃い、AFK の agent に任せられる   |
| `ready-for-human`          | `ready-for-human`     | 人間が実装する必要がある                 |
| `wontfix`                  | `wontfix`             | 対応しない                               |

skill が role を名指ししたら（例「AFK-ready の triage label を付ける」）、この表の右の label 名を使う。

実際に使う label 名が変わったら、「この tracker の label」の列を書き換える。
