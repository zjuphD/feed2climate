# Model Card — Feed2Climate

Version: repository state at the time of submission (see git tag or commit hash). Code: MIT license. Contact: repository owner.

## Model details

Feed2Climate is not one model. It is a chain of four components, described in `docs/data_ai_statement.md`:

1. **Batch and per-pig state-space forecast** (`app/forecast.js`): estimates body weight and feed intake for a target day, with a standard deviation, from weighings and weekly feed totals. Population curves are learned from other batches.
2. **Requirement calculation** (`app/formulation.js`, `app/engine.js`): converts the forecast into energy and standardized ileal digestible lysine density per kg feed, using maintenance and gain requirements.
3. **Least-cost formulation** (`app/formulation.js`, linear programming): corn, soybean meal and synthetic amino acids, with ideal-protein ratios relative to actual lysine and inclusion caps.
4. **Grouping** (`app/ai.js`, k-means): groups pens for group-level rations; the batch version of the tool uses a single ration.

No deep learning, no large language model, no pretrained weights. Training data: none in the machine-learning sense; the forecast's population curves are fitted from the research records at run time.

## Intended use

- Decision support for pig nutritionists and production managers, to compare next-week feed options against requirements, cost and modeled emissions.
- Teaching and evaluation of precision-feeding methods on public data.

## Out-of-scope use

- Automatic control of feeders, mixers or farm equipment.
- Decisions without nutritionist review.
- Commercial or regulatory emission claims (the emission numbers are modeled, not measured; the farm boundary is partial).
- Pigs outside the growing–finishing range covered by the records (about 25–100 kg, 1–69 days on feed).
- Breeds, genetics or feed sources different from those in the parameter file, without recalibration.

## Factors

- Batch and pig (by design: leave-one-batch-out evaluation).
- Decision week (10 weeks per batch; targets on days 4–67).
- Manure system and climate zone (IPCC factors, selectable).
- Soybean-meal deforestation scenario (sensitivity analysis).

## Metrics and results

Replay evaluation (13 batches, 30 replicates; see `docs/replay/README.md`):

| Quantity | Batch level | Per-pig level |
|---|---|---|
| Forecast mean absolute error, body weight (target day) | 2.2% (AI) vs 5.3% (lookup) | 1.1% (AI) vs 1.2% (rolling) |
| Excess lysine at matched 10% undernourished pig-days | 14.0% (AI) = 14.0% (lookup); three-phase 20.0% | 12.0% (AI) vs 15.7% (rolling) |
| Nitrogen excretion vs three-phase | −10.0% (AI) = −10.0% (lookup) | −13.0% (AI) vs −5.5% (rolling) |
| Modeled CO₂e vs three-phase | −2.1% (AI) = −2.1% (lookup) | −2.8% (AI) vs −1.4% (rolling) |
| Feed cost vs three-phase | −0.8% (AI) = −0.8% (lookup) | −1.1% (AI) vs −0.5% (rolling) |

Forecast interval coverage (130 leave-one-batch-out cases): body weight 86.2% of observations inside the stated 95% interval; feed intake 94.6% (reproduce with `node tools/forecast-coverage.js`).

Success criteria set in our replay code (not externally pre-registered; see replay README): none of the four AI variants met both.

## Evaluation data

Public records: Zenodo 6626445 (Lenoir et al., 2022), CC BY 4.0: 100 fattening pigs, grouped into 13 batches by pen-code prefix (4–14 pigs each). The data page does not state breed, test station or year. Evaluation used days 1–69.

## Training data

None beyond the evaluation records; population curves for each evaluation fold come from the other 12 batches.

## Ethical considerations

- Animal welfare: the tool recommends feed changes that a nutritionist must approve; a bad recommendation could cause under-feeding. The tool reports the undernourished-day rate so that the trade-off is visible.
- Environmental claims: emission numbers cover only feed production, manure methane and nitrous oxide. Other sources are not counted and are not treated as zero.
- Data: no personal or farm data. Research animal records are published under CC BY 4.0 with attribution.

## Caveats and recommendations

- Body-weight intervals are too narrow: observed coverage is 86% for a stated 95%. Calibrate before any safety-relevant use, or report the observed coverage (the tool does).
- Requirement values, inclusion caps, nitrogen retention and the volatile-solids algorithm are illustrative until confirmed by a nutritionist.
- Amino-acid prices are unverified.
- Energy cannot meet the standard in the first feeding week with corn and soybean meal alone (about 91%), so the tool flags it.
- Forecasts use two different ADG bounds in different modules (0.3–1.4 kg/day in the forecast, 0.7–1.1 kg/day for group targets); this is open and should be harmonized before field use.
- Re-run the replay after any change to formulation or forecast code, and regenerate the story and report from the results file.
