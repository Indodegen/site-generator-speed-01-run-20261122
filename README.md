# Site Generator Speed — a faster drop-in for makefun-site 1.0.0

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Indodegen/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Indodegen/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

Entry for the [make.fun bounty "Build a static site faster"](https://make.fun/bounty/site-generator-speed-01-run-20261122): a faster drop-in for makefun-site 1.0.0.

## What it is

- `solve.js` — a dependency-free ES module. `run(input)` returns exactly the answer makefun-site 1.0.0's build returns for the case's site, as a JSON object of every path it writes and that file's text, byte for byte.
- `main.ts` — the program the harness runs: reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

The approach: a regex-based inline scanner (one pass that jumps between special characters instead of per-character scanning), lean template rendering (one scope object per loop, slim lookups), and no warm-up pass — the code is fast even before JIT kicks in, which is what the cold-process timing measures.

## Measured results (lab, cold process, median CPU, net of the null-entry control)

Correct on every set, byte-identical to makefun-site 1.0.0 on all cases:

| Set | Correct | Entry | Baseline | Speedup |
|---|---|---|---|---|
| Practice | 3/3 | 468 ms | 1,097 ms | 2.34x |
| Fresh seed 1 | 3/3 | 608 ms | 1,330 ms | 2.19x |
| Fresh seed 2 | 3/3 | 534 ms | 1,252 ms | 2.35x |

Honest note: this is 2.19x–2.35x in a cold process — below the ~2.7x the original bar aimed for, and estimated around rank 6–8 on the server (inside the top-10 paid places, $10 each).

## Run it

Node 22.18+:

```sh
node main.ts
```

`main.ts` reads `/input/cases.json` and writes `/output/answers.json`. No dependencies, no network, no build step.

## License

MIT — see [LICENSE](LICENSE).
