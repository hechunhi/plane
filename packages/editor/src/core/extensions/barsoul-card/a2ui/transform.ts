/**
 * BARSOUL: 審査カード spec → A2UI v0.9 メッセージ の **決定的** 変換。
 *
 * 第一版は LLM を一切通さない。ここは純粋な TypeScript 関数で、
 *   入力 = Go 側 cards サービスが返す既存 spec ブロック（`GET /c/{ref}?as=spec`）
 *   出力 = A2UI メッセージ配列（createSurface / updateComponents）
 * だけを行う。データ取得・権限・業務判断は一切しない（すべて呼び出し側＝既存経路のまま）。
 *
 * 対象は **表示専用ブロックのみ**（block.tsx の「R4: presentation-only、主題駆動」の系列）。
 * chain / timeline / actions_grouped / form / closed / authhint —— つまり
 * **決裁に関わる系統は一切載せない**。承認は業務ゲートであって描画実験の場ではない。
 */
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { BARSOUL_PLANE_CATALOG_ID } from "./catalog";

/** Go 側 spec のブロック。型は意図的に緩い（SoR は Go 側、こちらは読むだけ）。 */
export type CardSpecBlock = Record<string, any>;

/**
 * A2UI に載せ替えてよい **表示専用** ブロック種別。
 *
 * ここに無いものは従来描画に残る。特に載せない理由:
 *   chain / timeline / actions_grouped / form … 決裁・入力（業務ゲート）
 *   closed / authhint                        … 決裁結果と権限の告知
 *   table / compare                          … 公式カタログに表コンポーネントが無い
 *                                              （自前 Table API を生やすのは別議題）
 */
const PRESENTATION_TYPES = new Set([
  "header",
  "kv",
  "modebadge",
  "detail",
  "section",
  "kvgrid",
  "amount",
  "callout",
  "list",
  "badge",
  "link",
  "ref",
  "image",
  "divider",
  "text",
]);

/**
 * 先頭から連続する表示専用ブロックの個数を返す。
 * 「先頭から連続」に限るのは、順序を絶対に入れ替えないため —— A2UI 区画と
 * 従来区画が上下に分かれるだけで、カード内の並びは元のままになる。
 */
export function leadingPresentationCount(blocks: readonly CardSpecBlock[]): number {
  let n = 0;
  while (n < blocks.length && PRESENTATION_TYPES.has(String(blocks[n]?.type ?? ""))) n++;
  return n;
}

type Component = Record<string, unknown> & { id: string; component: string };
type TextVariant = "h1" | "h2" | "h3" | "h4" | "h5" | "caption" | "body";
type Tone = "neutral" | "info" | "ok" | "warn";

/** 従来と同じ tone 語彙（badge / callout 共通）。 */
const toTone = (raw: unknown): Tone => {
  const v = String(raw ?? "");
  return v === "warn" || v === "ok" || v === "info" ? v : "neutral";
};

export type PresentationTransformInput = {
  surfaceId: string;
  /** spec のブロック列（先頭の表示専用区間だけを読む）。 */
  blocks: readonly CardSpecBlock[];
  /** 詳細(md)が開いているか。従来の `openDetail` state をそのまま渡す。 */
  detailOpen: boolean;
};

/**
 * 表示専用区間を A2UI メッセージ列に変換する。
 * 副作用なし・非同期なし・同じ入力なら同じ出力（tests/a2ui-transform.spec.ts）。
 */
export function buildPresentationMessages(input: PresentationTransformInput): A2uiMessage[] {
  const { surfaceId, blocks, detailOpen } = input;
  const take = leadingPresentationCount(blocks);

  const components: Component[] = [];
  const rootChildren: string[] = [];

  /** 部品を登録して id を返す。root の直下に置くものは push した id を rootChildren へ。 */
  const add = (c: Component): string => {
    components.push(c);
    return c.id;
  };
  const text = (id: string, value: string, variant: TextVariant): string =>
    add({ id, component: "Text", text: value, variant });

  for (let i = 0; i < take; i++) {
    const b = blocks[i];
    const ty = String(b?.type ?? "");

    if (ty === "header") {
      const badge = b.badge ? ` · ${String(b.badge)}` : "";
      rootChildren.push(text(`hdr-eyebrow-${i}`, `審査${badge}`, "caption"));
      rootChildren.push(text(`hdr-title-${i}`, String(b.title ?? ""), "h3"));
      continue;
    }

    if (ty === "kv") {
      // 従来と同じ連結（全角なかぐろ区切り）。空なら何も出さない。
      const line = (Array.isArray(b.rows) ? b.rows : [])
        .map((r: CardSpecBlock) => `${String(r?.k ?? "")}：${String(r?.v ?? "")}`)
        .join("　·　");
      if (!line) continue;
      rootChildren.push(text(`meta-${i}`, line, "caption"));
      continue;
    }

    if (ty === "modebadge") {
      const children = [
        add({
          id: `mode-badge-${i}`,
          component: "Badge",
          label: String(b.label ?? ""),
          // 従来は mode === "ALL" のときだけ accent 色。それ以外は地味な chip。
          tone: b.mode === "ALL" ? "info" : "neutral",
        }),
      ];
      if (b.note) children.push(text(`mode-note-${i}`, String(b.note), "caption"));
      rootChildren.push(add({ id: `mode-row-${i}`, component: "Row", children, align: "center" }));
      continue;
    }

    if (ty === "detail") {
      const body = String(b.md ?? b.text ?? "");
      if (!body.trim()) continue;
      const labelId = text(`detail-label-${i}`, detailOpen ? "詳細を隠す ▲" : "詳細を見る ▼", "caption");
      rootChildren.push(
        add({
          id: `detail-toggle-${i}`,
          component: "Button",
          child: labelId,
          variant: "borderless",
          action: { event: { name: "editAtomicComponent", context: { open: !detailOpen } } },
        })
      );
      if (detailOpen) {
        const bodyId = text(`detail-body-${i}`, body, "body");
        rootChildren.push(add({ id: `detail-card-${i}`, component: "Card", child: bodyId }));
      }
      continue;
    }

    /* ── ここから R4「presentation-only」系 ───────────────────────────── */

    if (ty === "section") {
      const title = String(b.title ?? "");
      if (!title) continue;
      rootChildren.push(text(`section-${i}`, title, "h4"));
      continue;
    }

    if (ty === "kvgrid") {
      const rows: CardSpecBlock[] = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) continue;
      const rowIds = rows.map((r, j) =>
        add({
          id: `kvgrid-${i}-${j}`,
          component: "Row",
          children: [
            text(`kvgrid-k-${i}-${j}`, String(r?.k ?? ""), "caption"),
            text(`kvgrid-v-${i}-${j}`, String(r?.v ?? ""), "body"),
          ],
          align: "start",
        })
      );
      rootChildren.push(add({ id: `kvgrid-${i}`, component: "Column", children: rowIds }));
      continue;
    }

    if (ty === "amount") {
      rootChildren.push(
        add({
          id: `amount-${i}`,
          component: "Row",
          children: [
            text(`amount-label-${i}`, String(b.label ?? ""), "caption"),
            // 従来は 18px/800。手持ちの最大見出しに寄せる。
            text(`amount-value-${i}`, String(b.value ?? ""), "h1"),
          ],
          align: "center",
        })
      );
      continue;
    }

    if (ty === "callout") {
      const body = String(b.text ?? "");
      if (!body) continue;
      const tone = b.tone === "warn" ? "warn" : "info";
      const rowId = add({
        id: `callout-row-${i}`,
        component: "Row",
        children: [
          add({
            id: `callout-badge-${i}`,
            component: "Badge",
            label: tone === "warn" ? "注意" : "情報",
            tone,
          }),
          text(`callout-text-${i}`, body, "body"),
        ],
        align: "start",
      });
      rootChildren.push(add({ id: `callout-${i}`, component: "Card", child: rowId }));
      continue;
    }

    if (ty === "list") {
      const items: unknown[] = Array.isArray(b.items) ? b.items : [];
      if (!items.length) continue;
      const itemIds = items.map((it, j) => {
        // 従来と同じ字面（オブジェクトなら done で ✓ / ○ を前置）。
        const line =
          it && typeof it === "object"
            ? `${(it as CardSpecBlock).done ? "✓" : "○"} ${String((it as CardSpecBlock).text ?? "")}`
            : String(it);
        return text(`list-item-${i}-${j}`, line, "body");
      });
      rootChildren.push(add({ id: `list-${i}`, component: "Column", children: itemIds }));
      continue;
    }

    if (ty === "badge") {
      rootChildren.push(
        add({ id: `badge-${i}`, component: "Badge", label: String(b.label ?? ""), tone: toTone(b.tone) })
      );
      continue;
    }

    if (ty === "link" || ty === "ref") {
      const href = String(b.href ?? "");
      if (!href) continue;
      const labelId = text(`link-label-${i}`, String(b.label ?? href), "body");
      rootChildren.push(
        add({
          id: `link-${i}`,
          component: "Button",
          child: labelId,
          variant: "borderless",
          // 遷移も必ずホワイトリスト経由。生 <a> を A2UI 側に生やさないのが要点で、
          // href の妥当性（scheme 検査）はハンドラ側（actions.ts）で行う。
          action: { event: { name: "openAtomicComponent", context: { href, label: String(b.label ?? "") } } },
        })
      );
      continue;
    }

    if (ty === "image") {
      const src = String(b.src ?? "");
      if (!src) continue;
      const imgId = add({
        id: `image-${i}`,
        component: "Image",
        url: src,
        fit: "contain",
        accessibility: { label: String(b.alt ?? "参照画像") },
      });
      if (b.caption) {
        rootChildren.push(
          add({
            id: `image-fig-${i}`,
            component: "Column",
            children: [imgId, text(`image-caption-${i}`, String(b.caption), "caption")],
          })
        );
      } else {
        rootChildren.push(imgId);
      }
      continue;
    }

    if (ty === "divider") {
      rootChildren.push(add({ id: `divider-${i}`, component: "Divider", axis: "horizontal" }));
      continue;
    }

    if (ty === "text") {
      const body = String(b.md ?? "");
      if (!body) continue;
      rootChildren.push(text(`text-${i}`, body, "caption"));
      continue;
    }
  }

  // 根は必ず id="root"（A2uiSurface が "root" を起点に描画する）。
  components.unshift({ id: "root", component: "Column", children: rootChildren });

  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: BARSOUL_PLANE_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
}
