/**
 * A small lookup of UN/CEFACT Recommendation 20 unit-of-measure codes —
 * the scheme GS1 vocabularies use for schema:unitCode (e.g. "KMH" for
 * rail:en15654Speed, "TNE" for a tare weight in tonnes). Intentionally
 * covers only the codes actually observed in GS1's published vocabularies
 * plus other very common ones, not the full ~2000-entry UN/CEFACT list —
 * this is a display nicety, not a validation source. An unrecognised code
 * is still shown as-is (see describeUnitCode()), just without the
 * human-readable suffix.
 */
const UN_CEFACT_UNIT_LABELS: Record<string, string> = {
  KMH: "kilometre per hour",
  MTS: "metre per second",
  KGM: "kilogram",
  TNE: "tonne",
  GRM: "gram",
  MMT: "millimetre",
  CMT: "centimetre",
  MTR: "metre",
  KTM: "kilometre",
  SEC: "second",
  MIN: "minute",
  HUR: "hour",
  DAY: "day",
  CEL: "degree Celsius",
  B47: "kilonewton",
  NEW: "newton",
  BAR: "bar",
  PAL: "pascal",
  VLT: "volt",
  AMP: "ampere",
  HTZ: "hertz",
  PGL: "percent",
  P1: "percent",
  MMK: "square millimetre",
  MTK: "square metre",
  MTQ: "cubic metre",
  LTR: "litre",
  MLT: "millilitre",
};

/** Formats a unit code for display, e.g. "KMH" -> "KMH (kilometre per hour)". Unrecognised codes are shown as-is. */
export function describeUnitCode(code: string): string {
  const label = UN_CEFACT_UNIT_LABELS[code.toUpperCase()];
  return label ? `${code} (${label})` : code;
}
