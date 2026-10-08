# Validation Plan

This document has two parts. Part A lists what has been validated so far, with the evidence. Part B is the plan for a 90-day shadow pilot on a partner farm. **Part B has not started. It needs a partner farm, a nutritionist and agreed success criteria before any data are collected.**

## Part A — Validation completed

| Check | What it tests | Result | Evidence |
|---|---|---|---|
| Hand-calculation checks | Mixing, requirements, nitrogen balance, IPCC emission formulas, ration search compared with exhaustive grid search, herd totals, capacity limits | 65 of 65 pass | `node tools/verify-calc.js` |
| Optimizer checks | LP solver on known problems, ration optimality against random feasible rations (60,000 random candidates sampled, feasible subset compared), clustering reproducibility, Pareto front monotonicity | 50 of 50 pass | `node tools/verify-ai.js` |
| Forecast checks | Decision timing, 3-day lead time, uncertainty shrinking as weighings arrive | 19 of 19 pass | `node tools/verify-forecast.js` |
| Formulation checks | Ideal-protein constraints against actual lysine, caps, energy relaxation only when infeasible, manure factors, indirect N₂O | 28 of 28 pass | `node tools/verify-formulation.js` |
| Leave-one-batch-out replay | Whether forecasts change feeding decisions compared with a simple lookup table and with rolling per-pig estimates; success criteria set in our replay code (not externally pre-registered); 30 observation-noise replicates; carbon-scenario sensitivity | Reported in `docs/replay/README.md` (including the correction record). None of the four AI variants met both criteria. | `node tools/replay-eval.js` |
| Forecast interval coverage | Whether stated 95% intervals cover observed values | Body weight 86.2%, feed intake 94.6% (130 cases) | `node tools/forecast-coverage.js` |
| Browser end-to-end test | Five tool pages, a sample calculation, an infeasible case, the energy notice, the sensitivity table, the forecast card for 13 batches × 10 decision weeks | All pass; no runtime errors in the offline single-file build | Headless Chrome test (DevTools protocol) |
| Start-page interaction test | The guided "开始分析" page: default result, changing batch and week, edit prompts, invalid input, safety margin, all tabs, no runtime errors | 31 of 31 pass | `node tools/ui-test-start.js` |
| Weekly comparison check | The page's cumulative comparison with three-phase feeding, against the replay averages | 13-batch cumulative: lysine supply −3.0%, cost −0.5%, nitrogen −7.1%, CO₂e −1.3% (one noise draw, forecast pigs; same direction and order as the replay averages, not identical). A single week is cheaper than three-phase in only 59 of 130 batch-weeks, so the page shows cumulative values | `node tools/weekly-compare.js` |
| Report reproducibility | Whether the replay report is generated from the results file rather than typed by hand | Generated report matches the committed README | `node tools/replay-report.js ...` |

**Not yet validated:** nutritionist review of requirements, feed composition and caps; verified amino-acid prices; calibrated forecast intervals; field outcomes.

## Part B — 90-day shadow pilot (planned)

### Objectives

1. Test whether the tool's next-week forecasts and recommended lysine densities are accurate on a commercial farm.
2. Test whether recommendations reduce undernourished pig-days and excess lysine without slowing growth.
3. Learn what information the nutritionist needs, and what is missing from farm records.

### Design

- **Partner:** one commercial growing–finishing farm with individually weighed or pen-weighed pigs and weekly feed records. Two pens per arm (about 12–14 pigs each) from one batch.
- **Phase 1, weeks 1–4 — shadow mode.** The tool runs on the farm's records each week and logs its recommendation. The nutritionist keeps current feeding. This phase tests forecast accuracy and coverage on farm data.
- **Phase 2, weeks 5–12 — controlled comparison.** The nutritionist implements the tool's recommendation in the intervention pens, and keeps current practice in the control pens, with random assignment of pens to arms.
- **Phase 3, weeks 13–14 — analysis and report.**

### Measures

| Measure | Type | How measured |
|---|---|---|
| Undernourished pig-days (supply < 97% of requirement) | Primary | Tool's requirement calculation from recorded weights and intakes |
| Excess lysine relative to requirement | Primary | Same |
| Average daily gain | Safety | Pen weighings |
| Feed cost per pig-day | Secondary | Farm feed records and ration prices |
| Nitrogen excretion | Secondary | Modeled from intake and retention (not measured); manure sampling only if the farm agrees |
| Forecast error and interval coverage | Secondary | Forecast against the next weighing |
| Nutritionist acceptance | Process | Proportion of weekly recommendations accepted without change |
| Welfare signals | Safety | Daily check by farm staff; veterinary review of any health event |

### Pre-registered success criteria (to be agreed before Phase 1)

1. Undernourished pig-day rate in intervention pens is not more than 2 percentage points higher than in control pens (non-inferiority).
2. Average daily gain difference is not below −0.03 kg/day (lower one-sided 95% bound; margin to be confirmed by the nutritionist).
3. Observed 95% interval coverage for body weight is at least 90%. If not, the tool's uncertainty labels are revised before any further use.
4. Excess lysine is reduced by at least 5 percentage points in intervention pens (illustrative; to be agreed).
5. Recommendations are accepted by the nutritionist in at least 70% of weeks (illustrative; to be agreed).

Criteria 1 and 2 are safety criteria. If either fails, the intervention stops and the reason is reported.

### Stop rules

- Any welfare alert linked to feeding: stop intervention and notify the veterinarian.
- Undernourished pig-day rate more than 2 percentage points above control for two consecutive weeks: stop intervention.
- Loss of feed-price or feed-composition data for more than one week: pause recommendations.

### Timeline

| Days | Activity |
|---|---|
| 0–14 | Agreement, data sharing terms, baseline records, tool installation (offline), nutritionist training |
| 15–28 | Phase 1: shadow mode |
| 29–84 | Phase 2: controlled comparison |
| 85–90 | Analysis, report to partner farm, documentation update |

### Roles

- **Nutritionist (external):** makes all feeding decisions; approves requirements and rations; reviews the report.
- **Farm manager:** provides records and implements approved rations.
- **Analyst (project):** runs the tool, prepares weekly outputs, performs the analysis.
- **Veterinarian (external):** welfare oversight and stop decisions.

### Data governance

- Written consent and data-sharing terms with the farm before any records leave the farm.
- Records are pseudonymized (pen and pig codes only). The tool runs offline on local files; no farm data are uploaded to external services.
- Raw records are deleted after the analysis, as agreed. Aggregated results may be published with the farm's permission.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Small sample (two pens per arm) | Report effect sizes with intervals; treat results as feasibility evidence, not efficacy |
| Disease or heat events confound growth | Record events; pre-specify exclusion rules; stop rules above |
| Forecast under-covers body weight | Criterion 3; labels already state observed coverage |
| Amino-acid price changes | Record price date with every ration; re-run costs when prices change |
| Nutritionist disagreement with recommendations | Recommendations are advisory; disagreements are recorded as data |
| Missing farm records | Checklist for weekly records agreed before Phase 1 |

### Deliverables

- Weekly log of recommendations, decisions and records (Phases 1–2).
- Final report with measures, criteria results, deviations and limitations.
- Updated model card and data statement with farm-scale numbers.
