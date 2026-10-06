/**
 * BARSOUL: 共有チェックリスト（sharedlist）の純関数。
 */
import { describe, expect, it } from "vitest";
import { inlineMd, sharedOn, sharedProgress, tagTone } from "../src/core/extensions/barsoul-card/form-helpers";

describe("inlineMd", () => {
  it("太字・code・リンクを分け、残りは原文のまま", () => {
    expect(inlineMd("数量：**1,104 pcs** / `B-1` [見る](https://x.jp)")).toEqual([
      { t: "数量：" },
      { t: "1,104 pcs", b: true },
      { t: " / " },
      { t: "B-1", code: true },
      { t: " " },
      { t: "見る", href: "https://x.jp" },
    ]);
  });
  it("javascript: リンクは文字のまま", () => {
    expect(inlineMd("[x](javascript:alert(1))")[0].href).toBeUndefined();
  });
  it("掛け算の * や単独の * は斜体にしない", () => {
    expect(inlineMd("2*3*4")).toEqual([{ t: "2*3*4" }]);
    expect(inlineMd("*注意* です")[0]).toEqual({ t: "注意", i: true });
  });
  it("<b> は解釈しない", () => {
    expect(inlineMd("<b>x</b>")).toEqual([{ t: "<b>x</b>" }]);
  });
});

describe("sharedProgress / sharedOn", () => {
  const sections = [
    {
      parts: [
        { kind: "task", id: "t0", checked: true },
        { kind: "text", text: "注" },
        { kind: "task", id: "t1" },
      ],
    },
    { parts: [{ kind: "table", head: [], rows: [] }] },
  ];
  it("原文の [x] が初期値、cards の値が上書き、楽観値が最優先", () => {
    expect(sharedProgress(sections, {}).done).toBe(1);
    const items = { t0: { on: false, by: "山下" }, t1: { on: true } };
    expect(sharedProgress(sections, items)).toEqual({
      done: 1,
      total: 2,
      bySec: [
        { done: 1, total: 2 },
        { done: 0, total: 0 },
      ],
    });
    expect(sharedOn("t0", sections[0].parts[0], items, { t0: true })).toBe(true);
    expect(sharedProgress(sections, items, { t0: true }).done).toBe(2);
  });
});

describe("tagTone", () => {
  it("確定済み=done / 重要=warn / TODO=plain", () => {
    expect(tagTone("確定済み")).toBe("done");
    expect(tagTone("重要")).toBe("warn");
    expect(tagTone("TODO")).toBe("plain");
  });
});
