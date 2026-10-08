# Data & AI Statement

This statement lists every data source, what each one is used for, its license, what is verified and what is not, and what the AI components do and do not do.

## 1. Data sources

| Data | Used for | Source and license | Status |
|---|---|---|---|
| Growth and feed records: 100 growing–finishing boars, 13 batches (4–14 pigs each), 2020, one test station, one breed; daily body weight and feed intake for days 1–76 (days 1–69 used) | Forecast training and replay evaluation; the "history" page | Zenodo record 6626445 (Lenoir et al., 2022), CC BY 4.0, MD5 `18af2d0b87fe0d020c5190019cff921b`. Attribution is shown in the tool (sources page) and the story page. | Structure checked by `tools/prepare-records.js`; checksum as recorded in `demo_sources/zenodo_6626445/SOURCE.md` (not re-computed in this review) |
| Energy maintenance conversion (NE = 1.05 × 0.74 × BW^0.6) and energy-to-gain framework | Requirements and forecast | Data authors' script `DLM_script.R`, distributed with Zenodo 6626445 | Taken from the parameter file's citation; the script itself not re-read in this review |
| Feed composition and carbon values for corn, soybean meal, synthetic amino acids | Ration formulation and feed emissions | INRA-CIRAD-AFZ feed tables (feedtables.com); carbon values are labelled "Climate change (ILCD)" and attributed to ECOALIM (Wilfart et al., 2016, doi:10.1371/journal.pone.0167343) | Not re-checked line by line in this review. **Needs nutritionist and data-owner review.** |
| Soybean-meal deforestation scenarios (0.541 / 1.138 / 1.690 kg CO₂e/kg) | Sensitivity of feed emissions | Same feed-table source | As above |
| Ideal-protein ratios (threonine, methionine + cystine, tryptophan, valine, isoleucine relative to lysine) | Formulation constraints | van Milgen & Dourmad (2015), J Anim Sci Biotechnol 6:15, doi:10.1186/s40104-015-0016-1 | Taken from the paper; not recalibrated to Chinese genetics |
| Lysine requirement (0.036 g/kg BW^0.75 maintenance; 20 g SID lysine per kg gain) | Requirements | K-State swine nutrition guide, citing Rostagno (2017) | Literature value; **not nutritionist-confirmed** |
| Gain target (0.90 kg/day), net energy per kg gain (9.0 MJ/kg), nitrogen retention (28 g N/kg gain), volatile-solids algorithm, amino-acid inclusion caps | Requirements and manure model | Explicit assumptions and illustrative values, labelled in the parameter file | **Assumptions; need nutritionist confirmation** |
| Manure methane and nitrous-oxide factors (MCF, B₀, EF₃, EF₄, EF₅, FracGas, FracLeach) | Manure emissions | IPCC (2019) Refinement, Vol. 4, Ch. 10–11, tables 10.16A, 10.17, 10.21, 10.22, 11.3. GWP100 from IPCC AR6 (CH₄ = 27, N₂O = 273). | Tables cited; values transcribed from the parameter file |
| Corn and soybean-meal prices | Feed cost | Ministry of Agriculture and Rural Affairs (MARA) weekly feed market report. **Week 2 (sample date 13 Aug 2026) verified against the official page: corn 2.46, soybean meal 3.23 yuan/kg. The value used (soybean meal 3.25, week 3, 20 Aug) was found only in re-published copies; not yet verified against the official page.** | Partly verified |
| Synthetic amino-acid prices (lysine HCl, threonine, methionine, tryptophan, valine) | Feed cost | Recorded as "2026-02-27 domestic quotes". **The source could not be verified** (a cited broker report was not found). Market reports for March–May 2026 show large price moves (98% lysine about 6.6 to 8.8 yuan/kg), so the date matters. | **Unverified; replace or verify before use** |
| Study-day definitions, forecast settings (weighing days 1, 22, 43, 64; 3% weighing error; 4% feed error; 3-day lead time) | Simulating farm-grade observations | Study design in `tools/replay-eval.js`; these are simulation assumptions, not measurements from a farm | Simulation assumption |

**No personal data and no farm data are used.** The research animals are not identifiable from the released records. No external API is called at run time.

## 2. AI components

| Component | What it does | What it does not do |
|---|---|---|
| **State-space forecast** (hierarchical prior and recursive filter, in `app/forecast.js`) | Estimates each batch's body weight and intake on a target day from weighings and weekly feed totals, starting from population curves learned from other batches. Gives a standard deviation for each estimate. | It does not use deep learning, large language models or any pretrained model. It does not forecast feed conversion ratio or carcass traits. |
| **Population curves** (fitted from other batches; leave-one-batch-out in the evaluation) | Provides the prior for the forecast and the "lookup table" baseline. | It is not a farm-specific model; a farm would need its own history. |
| **k-means clustering** (`app/ai.js`) | Groups pens by mean daily gain, mean intake and intake variation, to design group-level rations. Seeded, so results repeat exactly. | It is descriptive, not predictive. |
| **Linear programming** (two-phase simplex, Bland's rule, `app/formulation.js`) | Finds the least-cost ration that meets energy and lysine density, ideal-protein ratios and inclusion caps; can weight cost against modeled CO₂e. | It does not learn from data. It does not check palatability, mixing, or pellet quality. |

**Human oversight.** The tool produces recommendations. It does not connect to feeders, mixers or control systems. Every recommendation must be reviewed by a nutritionist before any change to feeding.

## 3. Evaluation

- Method: leave-one-batch-out replay. For each of the 13 batches, the forecast uses only the other 12 batches for learning and only observations available on the decision day.
- Replicates: 30 observation-noise draws; success criteria fixed in advance (`docs/replay/README.md`).
- Results (undernourished-pig-day rate matched at 10%, relative to three-phase feeding): see `docs/replay/README.md` and `docs/validation_plan.md`.
- Forecast interval coverage: body weight 86.2%, feed intake 94.6% (130 cases). Body-weight intervals are too narrow for a 95% claim.

## 4. Known limitations of the data and the AI

- One test station and one breed. Batches are small (4–14 pigs). Between-batch differences are likely smaller than on commercial farms.
- The "true" target value used for scoring is a smoothed full-record estimate, not a direct measurement.
- Lysine requirements and ideal-protein ratios are literature values, not recalibrated to Chinese genetics or feed.
- Energy is taken from the standard table in the replay. In week one, the corn–soybean meal ration cannot meet the energy standard without fat (about 91% achieved). The tool shows this; the replay does not count it.
- The forecast's body-weight interval under-covers (86% instead of 95%).
- Farm-scale emissions and cost are linear extrapolations of per-head values.

## 5. Reproducibility and licenses

- Code: MIT (see `LICENSE`). Documentation: same repository.
- Research data: CC BY 4.0 (Zenodo 6626445). Please cite Lenoir et al. (2022) when reusing the records.
- To reproduce: `node tools/verify-calc.js`, `node tools/verify-ai.js`, `node tools/verify-forecast.js`, `node tools/verify-formulation.js`, and `node tools/replay-eval.js --json out.json` (about one minute).
