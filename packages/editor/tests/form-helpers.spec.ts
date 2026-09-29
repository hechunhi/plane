/**
 * BARSOUL: form 原子の純関数テスト（読み取り表示・summary 式）。
 */
import { describe, expect, it } from "vitest";
import {
  addTags,
  countdownText,
  evalSummary,
  fieldText,
  isRequired,
  matchWhen,
  pct,
  resolveQuick,
  stepBy,
} from "../src/core/extensions/barsoul-card/form-helpers";

describe("fieldText", () => {
  it("未入力は — （空文字・null・空白のみ）", () => {
    expect(fieldText("")).toBe("—");
    expect(fieldText(null)).toBe("—");
    expect(fieldText(undefined)).toBe("—");
    expect(fieldText("   ")).toBe("—");
  });

  it("0 は未入力ではない", () => {
    expect(fieldText(0)).toBe("0");
  });

  it("select は value ではなく見出しを出す", () => {
    expect(fieldText("sg", { options: [{ value: "sg", label: "佐川" }] })).toBe("佐川");
  });

  it("unit を後置", () => {
    expect(fieldText(1.5, { unit: "kg" })).toBe("1.5 kg");
  });
});

describe("evalSummary", () => {
  const st = {
    items: [
      { sku: "A", qty: 2, kg: 0.1 },
      { sku: "B", qty: 3, kg: 0.2 },
      { sku: "", qty: 1, kg: null },
    ],
  };

  it("sumprod = Σ 数量×単重量（浮動小数誤差を出さない）", () => {
    expect(evalSummary(st, "sumprod(state.items, qty, kg)")).toBe(0.8);
  });

  it("sum / count / len", () => {
    expect(evalSummary(st, "sum(state.items[].qty)")).toBe(6);
    expect(evalSummary(st, "count(state.items[].sku)")).toBe(2);
    expect(evalSummary(st, "len(state.items[].sku)")).toBe(3);
  });

  it("未知の式・空配列", () => {
    expect(evalSummary(st, "avg(state.items[].qty)")).toBe("");
    expect(evalSummary({}, "sumprod(state.items, qty, kg)")).toBe(0);
  });
});

describe("fieldText 複数選択・真偽", () => {
  it("配列は見出しを「、」で連結", () => {
    expect(fieldText(["a", "c"], { options: [{ value: "a", label: "甲" }, "b", { value: "c", label: "丙" }] })).toBe("甲、丙");
  });
  it("toggle の真偽", () => {
    expect(fieldText(true)).toBe("はい");
    expect(fieldText(false)).toBe("いいえ");
  });
});

describe("matchWhen（cards formWhen と同義）", () => {
  const st = { kind: "return", n: 0, ok: true, tags: [], rows: [{ t: "x" }] };
  it("eq / ne / in", () => {
    expect(matchWhen(st, { path: "state.kind", eq: "return" })).toBe(true);
    expect(matchWhen(st, { path: "state.kind", ne: "return" })).toBe(false);
    expect(matchWhen(st, { path: "state.kind", in: ["sale", "return"] })).toBe(true);
  });
  it("truthy 既定: 0 / 空配列 / 未定義は偽", () => {
    expect(matchWhen(st, { path: "state.n" })).toBe(false);
    expect(matchWhen(st, { path: "state.ok" })).toBe(true);
    expect(matchWhen(st, { path: "state.tags", truthy: false })).toBe(true);
    expect(matchWhen(st, { path: "state.nope" })).toBe(false);
  });
  it("「.」始まりは repeater 行の相対パス", () => {
    expect(matchWhen(st, { path: ".t", eq: "x" }, "state.rows[0]", (s, p) => [p === "state.rows[0].t" ? s.rows[0].t : undefined])).toBe(true);
  });
  it("when なしは常に表示", () => {
    expect(matchWhen(st, undefined)).toBe(true);
  });
});

describe("isRequired", () => {
  const rules = [
    { assert: "required", on: "state.carrier" },
    { each: "state.items", fields: ["sku", "qty"] },
    { assert: "min", on: "state.fee", value: 0 },
  ];
  it("単体・repeater 行・非必須", () => {
    expect(isRequired(rules, "carrier")).toBe(true);
    expect(isRequired(rules, "state.items[2].sku")).toBe(true);
    expect(isRequired(rules, "state.items[2].kg")).toBe(false);
    expect(isRequired(rules, "fee")).toBe(false);
  });
});

describe("resolveQuick", () => {
  const now = new Date(2026, 8, 29, 23, 30); // 2026-09-29 夜
  it("today / tomorrow / +Nd / eom", () => {
    expect(resolveQuick("today", now)).toBe("2026-09-29");
    expect(resolveQuick("tomorrow", now)).toBe("2026-09-30");
    expect(resolveQuick("+7d", now)).toBe("2026-10-06");
    expect(resolveQuick("eom", now)).toBe("2026-09-30");
    expect(resolveQuick("SF", now)).toBe("SF");
  });
});

describe("stepBy", () => {
  it("刻み誤差なし・範囲内", () => {
    expect(stepBy(0.1, 1, { step: 0.2 })).toBe(0.3);
    expect(stepBy(1, -1, { min: 1 })).toBe(1);
    expect(stepBy(9, 1, { max: 10, step: 5 })).toBe(10);
    expect(stepBy(null, 1, { min: 1 })).toBe(2);
  });
});

describe("addTags", () => {
  it("区切り・重複・上限", () => {
    expect(addTags(["赤"], "青, 赤、緑\n")).toEqual(["赤", "青", "緑"]);
    expect(addTags([], "a,b,c", { max: 2 })).toEqual(["a", "b"]);
    expect(addTags(["A"], "a")).toEqual(["A"]);
  });
});

describe("pct / countdownText", () => {
  it("pct は 0..100 に丸める", () => {
    expect(pct(3, 4)).toBe(75);
    expect(pct(5, 4)).toBe(100);
    expect(pct(1, 0)).toBe(0);
  });
  it("残り・超過・24h 以内", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    expect(countdownText("2026-10-01T03:00:00Z", now)).toEqual({ text: "あと 2日3時間", overdue: false, soon: false });
    expect(countdownText("2026-09-29T05:30:00Z", now).soon).toBe(true);
    expect(countdownText("2026-09-28T23:00:00Z", now)).toEqual({ text: "1時間0分 超過", overdue: true, soon: false });
    expect(countdownText("", now).text).toBe("—");
  });
});
