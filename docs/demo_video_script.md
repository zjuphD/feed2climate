# Demo Video — Script and Storyboard (3 minutes maximum)

Target length: 2 min 50 s, to leave margin. Narration in English, about 380 words. Screen recordings use the offline files only:

- `dist/feed2climate-story.html` (story page)
- `dist/feed2climate-standalone.html` (tool; open it in a browser)

Before recording: set the browser window to 1280 × 800; open the tool (it starts on the "开始分析" / Start analysis tab) and keep its default example, batch 202001, week 43–49; clear any browser history or notifications; keep the pig records and sources page unchanged.

## Storyboard

| Time | Screen | Action | Narration |
|---|---|---|---|
| 0:00–0:20 | Story page, hero section | Show the feed-step ladder chart | "Growing pigs need less protein every day, but most farms feed in fixed steps. In our replay, that step feeding gave about one fifth more lysine than the pigs needed." |
| 0:20–0:40 | Story page, "same pen, different needs" | Hover over the pig dots | "Within one pen, pigs differ. A single feed level cannot match every pig's need. Individual feeding stations could, if farms have them." |
| 0:40–1:05 | Tool, Start analysis tab, input panel | Point at the three steps, then at the weighing and weekly-feed inputs and the week selector; click "生成下周方案" | "In the tool you enter what a farm really has: the average weight at each weighing and the weekly feed per pig, and you pick the week you are deciding feed for. Here we use a public batch. Then one click." |
| 1:05–1:35 | Tool, result: headline card and weight chart | Show lysine, energy and cost; point at the forecast point, its band and the "事后实际" marker | "The AI forecasts next week's weight and intake. The shaded band is ±1.96 standard deviations. In our tests the weight band covered about 86% of outcomes, not 95%, and the tool says so. From the forecast it computes the lysine each kilogram of feed must supply, adds a safety margin, and finds the cheapest corn–soybean meal ration." |
| 1:35–2:00 | Tool, recipe panel and comparison panel; then switch the week selector to the first week | Show the step chart and the cumulative bars; then show the orange energy notice for week 1 | "Three-phase feeding is a staircase; the weekly plan follows the pigs' falling needs. Over the weeks so far, modeled nitrogen, CO₂e and cost come out lower for this batch; the 13-batch replay average is on the page. In the first week this ration has no added fat, so energy falls short, and the tool shows a notice rather than hiding it." |
| 2:00–2:25 | Story page, replay table and criteria | Scroll to the replay results and the correction note | "Tested on 13 batches of pigs, a simple lookup table gave the same batch-level decisions as the forecast. Per-pig forecasts did better, but did not meet both of our criteria. We report the correction to our ideal-protein calculation, before and after." |
| 2:25–2:45 | Tool, page 04 (sources and validation) | Show the sources table with unverified items and the forecast-error panel | "Every source and every unverified value is listed. Nothing here is field evidence yet." |
| 2:45–2:50 | Story page, next-step section or title card | Show the 90-day shadow pilot plan | "The next step is a 90-day shadow pilot on a partner farm, with a nutritionist making every decision." |

## Recording checklist

- Record the screen at 1280 × 800 with system audio off; add the narration afterwards.
- Do not show any unverified price as a fact: when the price panel appears, say that amino-acid prices are unverified.
- Do not read out emission numbers as farm results; say "modeled" every time.
- If a page takes more than a second to respond, cut the wait out in editing.
- Total length must be under 3:00 (check the export length before submitting).
- Keep the narration consistent with `docs/project_statement.md`.
