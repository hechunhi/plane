/**
 * BARSOUL: A2UI v0.9 カタログ —— Plane デザインシステムへの写像。
 *
 * 方針:プロトコルは Google 公式のまま(`@a2ui/web_core/v0_9/basic_catalog` の
 * ComponentApi / Zod スキーマを **そのまま** 使う)、描画実装だけ Plane の
 * `@plane/ui` + Tailwind トークンに差し替える。こうすると
 *   - A2UI メッセージは公式スキーマ準拠のまま(将来 agent が書いても通る)
 *   - 見た目は Plane 一本 —— A2UI 既定 CSS(`@a2ui/react/styles`)は **読み込まない** ので
 *     第二の UI 様式が混ざらない
 * Badge だけ basic catalog に無いため、本カタログ固有の API として定義する。
 */
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog } from "@a2ui/web_core/v0_9";
import { AccessibilityAttributesSchema, DynamicStringSchema } from "@a2ui/web_core/v0_9";
import {
  ButtonApi,
  CardApi,
  ColumnApi,
  DividerApi,
  ImageApi,
  RowApi,
  TextApi,
} from "@a2ui/web_core/v0_9/basic_catalog";
import React from "react";
import { z } from "zod";
// plane imports
import { Badge, Button, Card, ECardSpacing, ECardVariant } from "@plane/ui";
import { cn } from "@plane/utils";

export const BARSOUL_PLANE_CATALOG_ID = "https://barsoul.jp/a2ui/catalogs/plane-atoms/v1.json";

type BuildChild = (id: string, basePath?: string) => React.ReactNode;

/** 公式 basic catalog の ChildList と同じ解決(文字列配列 / テンプレート由来 {id,basePath})。 */
const renderChildren = (childList: unknown, buildChild: BuildChild): React.ReactNode => {
  if (!Array.isArray(childList)) return null;
  return childList.map((item, i) => {
    if (item && typeof item === "object" && "id" in (item as Record<string, unknown>)) {
      const node = item as { id: string; basePath?: string };
      return <React.Fragment key={`${node.id}-${i}`}>{buildChild(node.id, node.basePath)}</React.Fragment>;
    }
    if (typeof item === "string") return <React.Fragment key={`${item}-${i}`}>{buildChild(item)}</React.Fragment>;
    return null;
  });
};

/** Row/Column 内での相対伸長。公式の getWeightStyle 相当。 */
const weightStyle = (weight?: number): React.CSSProperties | undefined =>
  typeof weight === "number" ? { flexGrow: weight, flexBasis: 0 } : undefined;

/** accessibility.label は DynamicString(束縛式も取りうる)。文字列に解決済みのときだけ使う。 */
const a11yLabel = (a11y: unknown): string | undefined => {
  const label = (a11y as { label?: unknown } | undefined)?.label;
  return typeof label === "string" ? label : undefined;
};

/* ── Text ─────────────────────────────────────────────────────────────── */
const TEXT_VARIANT_CLASS: Record<string, string> = {
  h1: "text-15 font-semibold text-primary",
  h2: "text-15 font-semibold text-primary",
  h3: "text-13 font-semibold text-primary",
  h4: "text-13 font-medium text-primary",
  h5: "text-11 font-medium text-primary",
  caption: "text-11 text-tertiary",
  body: "text-13 text-secondary",
};

const PlaneText = createComponentImplementation(TextApi, ({ props }) => (
  <span
    // pre-wrap は必須:詳細(md)本文の改行を従来どおり保つ。1 行テキストには無害。
    className={cn(
      "leading-relaxed whitespace-pre-wrap",
      TEXT_VARIANT_CLASS[props.variant ?? "body"] ?? TEXT_VARIANT_CLASS.body
    )}
    style={weightStyle(props.weight)}
  >
    {typeof props.text === "string" ? props.text : String(props.text ?? "")}
  </span>
));

/* ── Row / Column ─────────────────────────────────────────────────────── */
const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};
const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const PlaneRow = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <div
    className={cn("flex flex-row flex-wrap gap-2", JUSTIFY[props.justify ?? "start"], ALIGN[props.align ?? "center"])}
    style={weightStyle(props.weight)}
  >
    {renderChildren(props.children, buildChild)}
  </div>
));

const PlaneColumn = createComponentImplementation(ColumnApi, ({ props, buildChild }) => (
  <div
    className={cn("flex flex-col gap-1.5", JUSTIFY[props.justify ?? "start"], ALIGN[props.align ?? "stretch"])}
    style={weightStyle(props.weight)}
  >
    {renderChildren(props.children, buildChild)}
  </div>
));

/* ── Card ─────────────────────────────────────────────────────────────── */
const PlaneCard = createComponentImplementation(CardApi, ({ props, buildChild }) => (
  <Card variant={ECardVariant.WITHOUT_SHADOW} spacing={ECardSpacing.SM} className="gap-1.5">
    {props.child ? buildChild(props.child) : null}
  </Card>
));

/* ── Button ───────────────────────────────────────────────────────────── */
const BUTTON_VARIANT = {
  default: "neutral-primary",
  primary: "primary",
  borderless: "link-neutral",
} as const;

const PlaneButton = createComponentImplementation(ButtonApi, ({ props, buildChild }) => (
  <Button
    variant={BUTTON_VARIANT[props.variant ?? "default"]}
    size="sm"
    disabled={props.isValid === false}
    onClick={props.action}
    style={weightStyle(props.weight)}
    aria-label={a11yLabel(props.accessibility)}
  >
    {props.child ? buildChild(props.child) : null}
  </Button>
));

/* ── Image / Divider(公式 API をそのまま採用) ─────────────────────────── */
const IMAGE_FIT: Record<string, string> = {
  contain: "object-contain",
  cover: "object-cover",
  fill: "object-fill",
  none: "object-none",
  scaleDown: "object-scale-down",
};

const PlaneImage = createComponentImplementation(ImageApi, ({ props }) => (
  <img
    src={typeof props.url === "string" ? props.url : ""}
    alt={a11yLabel(props.accessibility) ?? (typeof props.description === "string" ? props.description : "")}
    loading="lazy"
    // 従来の figure と同じ上限。カード内で画像が主役になるのを防ぐ。
    className={cn("max-h-[280px] max-w-full rounded-md border border-subtle", IMAGE_FIT[props.fit ?? "contain"])}
    style={weightStyle(props.weight)}
  />
));

const PlaneDivider = createComponentImplementation(DividerApi, ({ props }) =>
  props.axis === "vertical" ? (
    <div className="mx-1 self-stretch border-l border-subtle" role="separator" aria-orientation="vertical" />
  ) : (
    <hr className="my-1 border-t border-subtle" />
  )
);

/* ── Badge(basic catalog に無い、本カタログ固有の追加) ─────────────────── */
export const BadgeApi = {
  name: "Badge",
  schema: z
    .object({
      // basic catalog の CommonProps は非公開なので同じ形をここで再掲する
      accessibility: AccessibilityAttributesSchema.optional(),
      weight: z.number().optional(),
      label: DynamicStringSchema.describe("バッジに表示する短いラベル。"),
      tone: z
        .enum(["neutral", "info", "ok", "warn"])
        .default("neutral")
        .describe("意味づけ。Plane のバッジ配色に写像される。")
        .optional(),
    })
    .strict(),
};

const BADGE_VARIANT = {
  neutral: "outline-neutral",
  info: "outline-primary",
  ok: "outline-success",
  warn: "outline-warning",
} as const;

const PlaneBadge = createComponentImplementation(BadgeApi, ({ props }) => (
  <Badge
    variant={BADGE_VARIANT[props.tone ?? "neutral"]}
    size="sm"
    tabIndex={-1}
    style={weightStyle(props.weight)}
    aria-label={a11yLabel(props.accessibility)}
  >
    {typeof props.label === "string" ? props.label : String(props.label ?? "")}
  </Badge>
));

/**
 * 本カタログには **ロジック関数を一切登録しない**。
 * 第一版は決定的な TypeScript 変換(transform.ts)でリテラル値まで解決済みの
 * メッセージしか流さない —— クライアント側に式評価の経路を生やさないため。
 */
export const barsoulPlaneCatalog = new Catalog(
  BARSOUL_PLANE_CATALOG_ID,
  [PlaneText, PlaneRow, PlaneColumn, PlaneCard, PlaneButton, PlaneBadge, PlaneImage, PlaneDivider],
  []
);
