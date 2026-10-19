# Domain docs

engineering skill が codebase を調べるときに、この repo の domain の文書をどう読むかを決める。

## 調べ始める前に読むもの

- repo root の **`GLOSSARY.md`**
- repo root に **`GLOSSARY-MAP.md`** があればそれを読む。context ごとの `GLOSSARY.md` を指しているので、扱う話題に関係するものを読む。
- **`docs/adr/`**: これから触る領域に関わる ADR を読む。multi-context の repo では、context に閉じた決定を `src/<context>/docs/adr/` も見る。

これらの file が無くても **何も言わずに進む**。無いことを指摘せず、先回りして作ることも勧めない。`/domain-modeling` skill（`/grill-with-docs` と `/improve-codebase-architecture` から呼ばれる）が、用語や決定が実際に固まったときに作る。

## file の配置

この repo は single-context で、次の形をとる。

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

multi-context の repo（root に `GLOSSARY-MAP.md` がある）は次の形になる。

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system 全体の決定
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← context に閉じた決定
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## glossary の語彙を使う

出力で domain の概念を名指しするとき（issue の title、refactor の提案、仮説、テスト名）は、`GLOSSARY.md` が定義する語を使う。glossary が _Avoid_ に挙げた言い換えに流れない。

必要な概念が glossary に無いときは、次のどちらかを疑う。project が使わない言葉を作っている（考え直す）か、glossary に本当に穴がある（`/domain-modeling` 向けに書き留める）。

## ADR との矛盾を明示する

出力が既存の ADR と矛盾するときは、黙って上書きせずに明示する。

> _ADR-0007（event-sourced orders）と矛盾するが、…の理由で見直す価値がある_
