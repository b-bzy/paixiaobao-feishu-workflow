/**
 * Business users paste values out of chat messages, slide decks and legacy
 * systems, so workbook cells and card inputs carry full-width digits,
 * thousands separators, currency marks and 万/亿 multipliers instead of bare
 * numbers. One shared parser keeps workbook recognition and card input
 * normalization consistent; anything it cannot read stays undefined so the
 * caller can surface a field-level error instead of a guessed value.
 */

export function foldFullWidth(value: string): string {
  return value.replace(/[\uFF01-\uFF5E]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
}

const trailingCountingUnits = /(元|张|枚|份|件|个|人|次|单|名|条|家|台|只)+$/;
const leadingPrefixes = /^[约共计满￥¥$€＋+]/;
const plainNumber = /^[+]?(\d+(?:\.\d+)?|\.\d+)$/;

export function parseFlexibleNumber(value: string): number | undefined {
  let text = foldFullWidth(value).trim();
  if (!text) return undefined;
  text = text.replace(/[,，\s_]/g, "");
  text = text.replace(leadingPrefixes, "");
  let multiplier = 1;
  const magnitude = text.match(/(万|亿)/);
  if (magnitude) {
    multiplier = magnitude[1] === "万" ? 10_000 : 100_000_000;
    text = text.replace(/(万|亿)/, "");
  }
  text = text.replace(trailingCountingUnits, "");
  if (!plainNumber.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed * multiplier : undefined;
}
