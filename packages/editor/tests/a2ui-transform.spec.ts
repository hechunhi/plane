/**
 * BARSOUL: 審査カード spec → A2UI メッセージ変換の回帰テスト。
 *
 * ここで守りたいのは 2 つだけ:
 *   1. **決裁系ブロックが A2UI 側に漏れない**（承認は業務ゲート。描画実験の対象外）
 *   2. **字面が従来描画と一致する**（フラグを倒しても読み手には同じものが見える）
 * 変換は純関数なので DOM も React も要らない（environment: "node"）。
 */
import { describe, expect, it } from "vitest";
import { ATOMIC_ACTION_WHITELIST, safeExternalHref } from "../src/core/extensions/barsoul-card/a2ui/actions";
import { BARSOUL_PLANE_CATALOG_ID } from "../src/core/extensions/barsoul-card/a2ui/catalog";
import {
  buildPresentationMessages,
  leadingPresentationCount,
  type CardSpecBlock,
} from "../src/core/extensions/barsoul-card/a2ui/transform";

/** カタログに実装がある部品（catalog.tsx の登録一覧と一致していること）。 */
const KNOWN_COMPONENTS = new Set(["Text", "Row", "Column", "Card", "Button", "Badge", "Image", "Divider"]);

/** 決裁・入力・権限に関わる＝絶対に A2UI へ載せてはならない種別。 */
const FORBIDDEN_TYPES = ["chain", "timeline", "actions_grouped", "form", "closed", "authhint"];

const componentsOf = (blocks: CardSpecBlock[], detailOpen = false) => {
  const msgs = buildPresentationMessages({ surfaceId: "s", blocks, detailOpen });
  const update = msgs.find((m) => "updateComponents" in m) as any;
  return update.updateComponents.components as any[];
};
const byId = (blocks: CardSpecBlock[], detailOpen = false) =>
  Object.fromEntries(componentsOf(blocks, detailOpen).map((c) => [c.id, c]));

describe("leadingPresentationCount", () => {
  it("先頭から連続する表示専用ブロックだけを数える", () => {
    expect(leadingPresentationCount([{ type: "header" }, { type: "kv" }, { type: "badge" }])).toBe(3);
  });

  it("決裁系に当たった時点で止まる（順序は絶対に入れ替えない）", () => {
    const blocks = [{ type: "header" }, { type: "actions_grouped" }, { type: "badge" }];
    expect(leadingPresentationCount(blocks)).toBe(1);
  });

  it("先頭が表示専用でなければ 0（＝従来 UI が全部描く）", () => {
    expect(leadingPresentationCount([{ type: "chain" }, { type: "header" }])).toBe(0);
    expect(leadingPresentationCount([])).toBe(0);
  });

  it.each(FORBIDDEN_TYPES)("%s は表示専用に含めない", (ty) => {
    expect(leadingPresentationCount([{ type: ty }])).toBe(0);
  });

  it("未知の種別も載せない（Go 側が新ブロックを足しても従来描画に落ちる）", () => {
    expect(leadingPresentationCount([{ type: "brand-new-block-2027" }])).toBe(0);
  });
});

describe("buildPresentationMessages", () => {
  it("createSurface + updateComponents を返し、根は必ず id=root", () => {
    const msgs = buildPresentationMessages({
      surfaceId: "surf-1",
      blocks: [{ type: "header", title: "T" }],
      detailOpen: false,
    });
    expect(msgs).toHaveLength(2);
    expect((msgs[0] as any).createSurface).toMatchObject({ surfaceId: "surf-1", catalogId: BARSOUL_PLANE_CATALOG_ID });
    const comps = (msgs[1] as any).updateComponents.components;
    expect(comps[0]).toMatchObject({ id: "root", component: "Column" });
  });

  it("カタログに実装のある部品しか出さない", () => {
    const blocks: CardSpecBlock[] = [
      { type: "header", title: "請求書", badge: "経理" },
      { type: "kv", rows: [{ k: "取引先", v: "山下商事" }] },
      { type: "modebadge", mode: "ALL", label: "全員承認", note: "3名" },
      { type: "section", title: "内訳" },
      { type: "kvgrid", rows: [{ k: "小計", v: "¥100" }] },
      { type: "amount", label: "合計", value: "¥120,000" },
      { type: "callout", tone: "warn", text: "期限超過" },
      { type: "list", items: [{ done: true, text: "採番" }, "手入力"] },
      { type: "badge", tone: "ok", label: "検収済" },
      { type: "link", href: "https://example.com/x", label: "納品書" },
      { type: "image", src: "https://example.com/a.png", alt: "図", caption: "図1" },
      { type: "divider" },
      { type: "text", md: "備考" },
      { type: "detail", md: "一行目\n二行目" },
    ];
    for (const c of componentsOf(blocks)) expect(KNOWN_COMPONENTS.has(c.component)).toBe(true);
  });

  it("id は一意、root の children は全部実在する", () => {
    const blocks: CardSpecBlock[] = [
      {
        type: "kvgrid",
        rows: [
          { k: "a", v: "1" },
          { k: "b", v: "2" },
        ],
      },
      { type: "list", items: ["x", "y"] },
      { type: "divider" },
    ];
    const comps = componentsOf(blocks);
    const ids = comps.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cid of comps[0].children) expect(ids).toContain(cid);
  });

  it("空の内容は描かない（空 Row/Column を出さない）", () => {
    const empty: CardSpecBlock[] = [
      { type: "kv", rows: [] },
      { type: "section", title: "" },
      { type: "kvgrid", rows: [] },
      { type: "list", items: [] },
      { type: "link" },
      { type: "image" },
      { type: "text", md: "" },
      { type: "detail", md: "   " },
    ];
    expect(componentsOf(empty)[0].children).toEqual([]);
  });

  it("同じ入力なら同じ出力（決定的・LLM 非依存）", () => {
    const blocks: CardSpecBlock[] = [
      { type: "header", title: "T" },
      { type: "badge", label: "B" },
    ];
    expect(buildPresentationMessages({ surfaceId: "s", blocks, detailOpen: false })).toEqual(
      buildPresentationMessages({ surfaceId: "s", blocks, detailOpen: false })
    );
  });
});

describe("従来描画との字面一致", () => {
  it("header は eyebrow『審査 · badge』＋ title", () => {
    const m = byId([{ type: "header", title: "請求書 #1042", badge: "経理" }]);
    expect(m["hdr-eyebrow-0"].text).toBe("審査 · 経理");
    expect(m["hdr-title-0"].text).toBe("請求書 #1042");
  });

  it("badge 無しの header は『審査』だけ", () => {
    expect(byId([{ type: "header", title: "X" }])["hdr-eyebrow-0"].text).toBe("審査");
  });

  it("kv は全角なかぐろで連結", () => {
    const m = byId([
      {
        type: "kv",
        rows: [
          { k: "取引先", v: "山下商事" },
          { k: "金額", v: "¥120,000" },
        ],
      },
    ]);
    expect(m["meta-0"].text).toBe("取引先：山下商事　·　金額：¥120,000");
  });

  it("modebadge は mode=ALL のときだけ accent", () => {
    expect(byId([{ type: "modebadge", mode: "ALL", label: "全員" }])["mode-badge-0"].tone).toBe("info");
    expect(byId([{ type: "modebadge", mode: "ANY", label: "誰か" }])["mode-badge-0"].tone).toBe("neutral");
  });

  it("list は done で ✓ / ○ を前置し、文字列要素はそのまま", () => {
    const m = byId([{ type: "list", items: [{ done: true, text: "採番" }, { done: false, text: "検収" }, "素の行"] }]);
    expect(m["list-item-0-0"].text).toBe("✓ 採番");
    expect(m["list-item-0-1"].text).toBe("○ 検収");
    expect(m["list-item-0-2"].text).toBe("素の行");
  });

  it("badge の tone 語彙は従来と同じ、未知値は neutral に落ちる", () => {
    expect(byId([{ type: "badge", tone: "warn", label: "x" }])["badge-0"].tone).toBe("warn");
    expect(byId([{ type: "badge", tone: "ok", label: "x" }])["badge-0"].tone).toBe("ok");
    expect(byId([{ type: "badge", tone: "???", label: "x" }])["badge-0"].tone).toBe("neutral");
  });

  it("link はラベル省略時 href を出す", () => {
    expect(byId([{ type: "link", href: "https://example.com/a" }])["link-label-0"].text).toBe("https://example.com/a");
  });

  it("detail は開閉でラベルが反転し、本文の改行が保たれる", () => {
    const closed = byId([{ type: "detail", md: "一行目\n二行目" }], false);
    expect(closed["detail-label-0"].text).toBe("詳細を見る ▼");
    expect(closed["detail-body-0"]).toBeUndefined();
    expect(closed["detail-toggle-0"].action.event.context.open).toBe(true);

    const open = byId([{ type: "detail", md: "一行目\n二行目" }], true);
    expect(open["detail-label-0"].text).toBe("詳細を隠す ▲");
    expect(open["detail-body-0"].text).toBe("一行目\n二行目");
    expect(open["detail-toggle-0"].action.event.context.open).toBe(false);
  });
});

describe("Action の封じ込め", () => {
  it("生成される action は全部ホワイトリスト内", () => {
    const blocks: CardSpecBlock[] = [
      { type: "detail", md: "本文" },
      { type: "link", href: "https://example.com", label: "外部" },
    ];
    const names = componentsOf(blocks)
      .filter((c) => c.action)
      .map((c) => c.action.event.name);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(ATOMIC_ACTION_WHITELIST).toContain(n);
  });

  it("遷移は必ず Button + action 経由（生 href を部品 props に置かない）", () => {
    const link = byId([{ type: "link", href: "https://example.com/x", label: "L" }])["link-0"];
    expect(link.component).toBe("Button");
    expect(link.href).toBeUndefined();
    expect(link.action.event.context.href).toBe("https://example.com/x");
  });
});

describe("safeExternalHref", () => {
  it("http/https だけ通す", () => {
    expect(safeExternalHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalHref("http://example.com/a")).toBe("http://example.com/a");
  });

  it("実行経路になりうる scheme は落とす", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("data:text/html,<script>")).toBeNull();
    expect(safeExternalHref("file:///etc/passwd")).toBeNull();
  });

  it("空・非文字列・壊れた URL は null", () => {
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref("   ")).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
    expect(safeExternalHref(42)).toBeNull();
  });

  it("相対 URL はオリジン基準で解決して通す", () => {
    expect(safeExternalHref("/c/abc?as=view")).toBe("https://localhost/c/abc?as=view");
  });
});
