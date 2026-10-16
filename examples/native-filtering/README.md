# Filtered native presents

`filtered-presents.csv` is Intel's pinned PresentMon `test_case_5_v1.csv`
with `Dropped=1` rows removed, matching its documented `-exclude_dropped`
output behavior. Native cells and line endings are retained. This is a test
capture, not a game benchmark or newly recorded hardware measurement.

The default selected stream retains 175 frames and 83 clock discontinuities.
Only 91 pairs remain observed adjacent presents. The analyzer does not infer
missing frame counts, restore dropped-frame totals, or invent durations.

Source, hashes, transformation, independent ordinal oracle and the separate
untouched FrameView counterexample are in
[`studies/present-clock`](https://github.com/antonsoo/stutterscope/tree/main/studies/present-clock).
Regenerate with `python3 studies/present-clock/generate.py` from a source
checkout with the pinned capture cache, or add `--fetch` to download it.
The [Intel MIT license](LICENSE.txt) applies to this capture data.
