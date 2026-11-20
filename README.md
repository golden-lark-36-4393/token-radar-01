# Token Radar — token-radar-01 entry (radar-2)

Ranks all 758 protocols in the sealed DefiLlama snapshot by the implied value of a
token they do not yet record, and shows how to farm each one.

## Model (computed at run time from the snapshot; no name is special-cased)

`implied = round(TVL x peer_multiple(category) x growth x maturity x odds)`

- `peer_multiple` — median mcap/TVL of the token-bearing protocols in the same
  category; fewer than 3 peers falls back to the global median (x0.214 here).
- `growth` — `1 + 0.5 x clamp(change_7d, -30, +100) / 100`.
- `maturity` — `clamp((log(age_days+1) / log(366)) ^ 0.5, 0.7, 1.5)`.
- `odds` — `0.8 + 0.4 x peer launch rate` (share of the category's protocols older
  than 1 year that record a token).

Holdout validation (train oldest 70%, test newest 30%, n=29): Spearman 0.254,
median absolute error 97.6% — stated honestly on the page. OLS cross-check:
`log(mcap) ~ -1.9053 + 0.5689·log(TVL) - 0.0111·change_7d + 1.0931·log(age+1)`
(n=95); the growth term fits slightly negative on 95 noisy rows, so growth enters
with a small positive weight instead of paying a protocol for shrinking.

## Board

758 rows: 198 genuine launch candidates (the radar view), 342 pre-token in all,
416 that record a token. The radar view leaves out wrapped, staked and bridged
products, versioned pools and exchange products, the same rule the watchlist uses.
All 40 watchlist protocols are covered and are launch candidates. Live rows carry
the market's own mcap next to the model's implied value. Every row has a 6-step
farm plan sized to $100 / $500 / $1,000 deposits, with cost and time per step.

## Build

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Two runs are byte-identical; all 7 gate rows pass
locally (see `../token-radar-01-work/verify.mjs`).

## Layout

- `main.ts` — entrypoint; `lib/model.ts` — model, board, farm plans, compact data.js
- `vendor/makefun-board.ts` — kit library, unchanged
- `dashboard/` — index.html, app.css, app.js (no network)
- `screenshots/` — 1-board, 2-detail (Steakhouse Financial), 3-filtered (token on record)
