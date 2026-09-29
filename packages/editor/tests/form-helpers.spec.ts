/**
 * BARSOUL: form 原子の純関数テスト（読み取り表示・summary 式）。
 */
import { describe, expect, it } from "vitest";
import { evalSummary, fieldText } from "../src/core/extensions/barsoul-card/form-helpers";

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
