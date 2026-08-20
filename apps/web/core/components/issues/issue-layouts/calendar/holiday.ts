/**
 * BARSOUL 2026-08: カレンダーの「赤い日」判定。
 *
 * 日本の暦では休みの日は赤い。祝日のカードを入れても日付が真っ黒のままだと
 * 「カレンダー」に見えず、せっかく入れた祝日データが目に入らない。
 *
 * 判定は **プロジェクト id ではなくラベル名**で行う。CAL(予定表)に限定すると
 * 他のプロジェクトのカレンダーでは死ぬし、会社独自の休み(年末年始など)を
 * 後から足す時にコードを触る羽目になる。ラベル命名の規約だけで赤くなる。
 *
 * 「休日出勤」「休日当番」のような **休みの日に働く** ラベルは除外する。
 * 語としては休日を含むが、意味は逆。
 */

const HOLIDAY_RE = /(祝日|祝祭日|休日|休暇|公休|假日|假期|節假日|节假日|holiday)/i;
const WORKING_RE = /(出勤|勤務|当番|対応|シフト|值班|加班|轮班)/;

/** このラベル名は「その日は休み」を意味するか。 */
export const isHolidayLabelName = (name: string | undefined | null): boolean => {
  const n = (name || "").trim();
  if (!n) return false;
  return HOLIDAY_RE.test(n) && !WORKING_RE.test(n);
};

/**
 * カレンダーの日付セル / カードに使う色。テーマ変数なので暗色でも読める。
 * 日曜=赤 / 土曜=青 は日本の暦の作法。祝日はそれに乗るだけ。
 */
export const HOLIDAY_TEXT = "var(--label-crimson-text)";
export const HOLIDAY_TINT = "var(--label-crimson-bg)";
export const SATURDAY_TEXT = "var(--label-indigo-text)";

/** 日付セルの数字の色。赤日でも土日でもなければ undefined(既定色のまま)。 */
export const dayNumberColor = (date: Date, isHoliday: boolean): string | undefined => {
  if (isHoliday) return HOLIDAY_TEXT;
  const day = date.getDay();
  if (day === 0) return HOLIDAY_TEXT;
  if (day === 6) return SATURDAY_TEXT;
  return undefined;
};
