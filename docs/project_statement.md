# Feed2Climate — Project Statement

**Feed2Climate** is a transparent decision-support tool for pig nutritionists. It sets the feed lysine supply to what each group of growing–finishing pigs needs next week, and reports the feed-cost and modeled emission consequences of that choice. It is read-only: it recommends, and a nutritionist decides.

## Problem

Growing–finishing pigs' nutrient requirements change every day with body weight and feed intake, but most farms change feed in fixed phases. In a replay of 13 batches (100 fattening pigs, public records), three-phase feeding supplied about 20% more lysine than the pigs needed, at a matched rate of 10% undernourished pig-days. The excess protein is excreted as nitrogen, and the extra soybean meal carries feed-chain emissions.

## Users

Pig nutritionists and production managers at integrated farms and feed-advisory services, who set feed formulas one to two weeks ahead.

## What the tool does

1. **Forecasts** next week's body weight and feed intake for a batch from weighings and weekly feed records, with uncertainty.
2. **Computes** the energy and standardized ileal digestible lysine density that the next-week feed must provide.
3. **Formulates** the least-cost ration of corn, soybean meal and synthetic amino acids that meets those densities under ideal-protein ratios and inclusion caps.
4. **Reports** feed cost, modeled CO₂e (feed, manure CH₄, direct and indirect N₂O) and nitrogen excretion, with the source of every input shown. Values that are not yet confirmed are labelled as such.

## Where AI is used, and where it is not needed

The AI components are a statistical state-space filter for forecasts, k-means clustering for grouping pens, and linear programming for formulation. We do not claim AI is needed for everything.

In the replay, a batch-level AI forecast gave the same feeding decisions as a simple weekly lookup table (both: 14.0% excess lysine, −10.0% nitrogen excretion, −2.1% CO₂e). AI forecasts were more accurate for body weight, but that did not change the decision. Per-pig AI forecasts did improve on rolling per-pig estimates (12.0% vs 15.7% excess lysine; −13.0% vs −5.5% nitrogen excretion), but only where individual feeding stations exist. We therefore position the AI as useful for per-pig feeding, and the batch-level value of the tool as transparent, checkable calculation.

## Climate value (what is quantified)

All figures are modeled, per head per day, at a matched 10% undernourished-pig-day rate, relative to three-phase feeding (baseline: 2.25 kg CO₂e, 31.8 g nitrogen excreted, 523 g soybean meal):

- Nitrogen excretion: −10.0% (batch-level, lookup or AI) and −13.0% (per-pig AI).
- Modeled CO₂e: −2.1% (batch-level) and −2.8% (per-pig AI). Sensitivity to the soybean-meal deforestation scenario: −0.8% to −3.1% (batch) and −1.1% to −4.1% (per pig).
- Feed cost: −0.8% (batch) and −1.1% (per pig).

Farm energy, transport, enteric methane and animal-level effects are not counted, and they are not netted to zero.

## Validation

Leave-one-batch-out replay over 13 batches with 30 observation-noise replicates, with success criteria set in our replay code (not externally pre-registered) (see `docs/replay/README.md`). None of the four AI variants met both criteria. The per-pig AI beat the best simple method by 2.9 percentage points, just short of the required 3.0, and its 13.0% nitrogen reduction was below half of the 34.4% upper bound (17.2% required). The replay is a method demonstration on public records of 100 fattening pigs; it is not field evidence.

A correction is recorded there as well: the ideal-protein ratios were originally computed against target lysine rather than actual lysine. The correction changed the per-pig margin from 3.1 to 2.9 points, and it is reported before and after.

Forecast intervals are not yet calibrated. Across 130 leave-one-batch-out cases, the stated 95% body-weight interval covered 86% of observations (feed intake: 95%). The tool shows this coverage and does not claim 95% for body weight.

## Limitations

- No farm data yet. All evidence comes from one public research dataset.
- Requirement values, inclusion caps and several conversion factors have not been confirmed by a nutritionist.
- Amino-acid prices are not verified; the price date is recorded as unverified.
- In week one, the corn–soybean meal ration has no added fat, so energy cannot meet the standard (about 91%); the tool shows a notice.
- Protein-restriction effects on growth are not modeled.

## Next step

A 90-day shadow pilot on one partner farm, comparing the tool's recommendations with the nutritionist's decisions and recording outcomes without changing feeding (see `docs/validation_plan.md`).

## Status and access

Runnable offline web tool (`dist/feed2climate-standalone.html`), evidence story page (`dist/feed2climate-story.html`), replay evidence, verification scripts, and documentation. Code is released under the MIT license; the research data remain under their original CC BY 4.0 license (Zenodo 6626445).
