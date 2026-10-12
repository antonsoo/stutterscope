import type uPlot from "uplot";

/** Insert a null separator without discarding either observed endpoint or inventing elapsed time. */
export function traceData(timeSec: Float64Array, values: Array<Float64Array | Array<number | null>>, gapBefore?: Uint8Array): { data: uPlot.AlignedData; isolated: number[] } {
  if (!gapBefore?.subarray(1).includes(1)) {
    return { data: [timeSec, ...values], isolated: timeSec.length === 1 ? [0] : [] };
  }
  const times: number[] = [];
  const columns: Array<Array<number | null>> = values.map(() => []);
  const isolated: number[] = [];
  for (let i = 0; i < timeSec.length; i++) {
    if (i > 0 && gapBefore[i] === 1) {
      // This midpoint is only a drawing separator on the accumulated-time axis.
      times.push(timeSec[i - 1]! + (timeSec[i]! - timeSec[i - 1]!) / 2);
      for (const column of columns) column.push(null);
    }
    if ((i === 0 || gapBefore[i] === 1) && (i === timeSec.length - 1 || gapBefore[i + 1] === 1)) isolated.push(times.length);
    times.push(timeSec[i]!);
    values.forEach((column, j) => columns[j]!.push(column[i]!));
  }
  return { data: [times, ...columns], isolated };
}
