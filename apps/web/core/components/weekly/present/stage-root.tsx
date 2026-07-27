/**
 * BARSOUL 週会放映幕 — 幕の外枠 (hechun 2026-07-27)
 *
 * 会議室の 100 インチテレビに映す「幕」の器。中身（幕 A / B / C）は別ファイルで、
 * ここが持つのは幕そのものの物理条件だけ:
 *
 *  1. **一つの変数で全体を拡縮**。`--stage-scale` だけを動かせば読める大きさが変わる。
 *     子要素は px でも rem でもなく `em` で書く（= 幕のルート font-size に相対）。
 *     テレビが 100" から 55" のプロジェクタに変わっても、直すのは 1 個。
 *     `?scale=1.4` で現場から一時的に上書きできる（画面上にツマミは置かない）。
 *  2. **暗色を強制**。会議室は明るく、テレビは輝度が高い。白地の大面積は目に刺さる。
 *     大屏に「ユーザーの好み」は無いので `html[data-theme]` を dark に固定し、
 *     アンマウントで元に戻す（同じタブで /weekly に帰ったとき好みを壊さないため）。
 *     ※ 暗色トークンは `:root[data-theme*=dark]` でしか再定義されないので、
 *       入れ子の div に data-theme を付けても値は切り替わらない。html に付けるしかない。
 *  3. **スクロールしない**。スクロールバーが出たら仕様違反（誰も大屏をスクロールできない）。
 *  4. **押せるものを出さない**。操作は主持人のノート側（P0-6）とキーボード（P0-7）だけ。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";

/** 幕。並び順がそのままキーボード 1 / 2 / 3。 */
export const STAGE_SCENES = ["member", "overview", "chat"] as const;
export type TStageScene = (typeof STAGE_SCENES)[number];

/** 100" @ 3.5m の実測起点。`?scale=` で現場上書き可。 */
const DEFAULT_STAGE_SCALE = 1;
const MIN_STAGE_SCALE = 0.5;
const MAX_STAGE_SCALE = 3;

/**
 * 幕のルート font-size。96em × 46em の「紙」に収めるつもりで子を書く。
 * 幅と高さの両方で割って小さい方を採るので、16:9 でも 16:10 でもはみ出さない。
 */
const stageFontSize = (scale: number) => `calc(min(100vw / 96, 100vh / 46) * ${scale})`;

/** html の data-theme を dark に固定し、離れるとき元に戻す。 */
const useForcedDarkTheme = () => {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    return () => {
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, []);
};

export const WeeklyStageRoot = observer(function WeeklyStageRoot() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const [scene, setScene] = useState<TStageScene>("member");

  useForcedDarkTheme();

  const scale = useMemo(() => {
    const raw = Number.parseFloat(searchParams.get("scale") ?? "");
    if (!Number.isFinite(raw)) return DEFAULT_STAGE_SCALE;
    return Math.min(MAX_STAGE_SCALE, Math.max(MIN_STAGE_SCALE, raw));
  }, [searchParams]);

  const toggleFullscreen = useCallback(() => {
    // requestFullscreen はユーザー操作（= このキー入力）の中でしか通らない。
    // 通らなかったときは黙って諦める: 幕自体はビューポート一杯なので実害は無い。
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // キーボードだけが幕の単独操作系（主持人のノートが無くても回る = P0-7）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = ["1", "2", "3"].indexOf(event.key);
      if (index >= 0) {
        setScene(STAGE_SCENES[index]);
        return;
      }
      if (event.key === "f" || event.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFullscreen]);

  return (
    <div
      data-stage={scene}
      style={{ fontSize: stageFontSize(scale) }}
      className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden overscroll-none bg-canvas text-primary select-none"
    >
      <header className="flex items-baseline justify-between gap-[2em] border-b border-subtle px-[1.8em] pt-[1.1em] pb-[0.9em]">
        <h1 className="text-[1.5em] leading-none font-semibold tracking-tight">{t("weekly.present.title")}</h1>
        {/* 現在どの幕にいるか。位置の表示なので accent 青（操作ではない）。 */}
        <nav aria-label={t("weekly.present.scenes_label")} className="flex items-baseline gap-[1.4em]">
          {STAGE_SCENES.map((item) => (
            <span
              key={item}
              aria-current={item === scene ? "true" : undefined}
              className={cn("text-[1.05em] leading-none", {
                "font-medium text-accent-primary": item === scene,
                "text-tertiary": item !== scene,
              })}
            >
              {t(`weekly.present.scenes.${item}`)}
            </span>
          ))}
        </nav>
      </header>

      <div className="grid min-h-0 place-items-center px-[1.8em]">
        <p className="text-center text-[1.35em] leading-[1.6] text-tertiary">{t("weekly.present.pending")}</p>
      </div>
    </div>
  );
});
