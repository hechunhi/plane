/**
 * BARSOUL: 審査カード摘要部の A2UI サーフェス。
 *
 * 責務は「描く」だけ:
 *   - spec ブロック → メッセージ変換は transform.ts（決定的・LLM なし）
 *   - 描画部品は catalog.tsx（Plane デザインシステム）
 *   - 発火した Action は actions.ts のホワイトリスト経由で **既存の** 経路へ
 * データ取得・権限・業務判断はここに一切書かない。
 *
 * フォールバック（要件 9）: 変換・処理・描画のどこで失敗しても `onFail()` を
 * 上げるだけ。従来 UI をここで持たないのは二重実装を避けるため —— 親（block.tsx）が
 * 「A2UI に渡した範囲」を 0 に戻し、従来の描画がそのまま全ブロックを描く。
 */
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import React, { useEffect, useRef, useState } from "react";
import { createAtomicActionDispatcher, type AtomicActionHandlers } from "./actions";
import { barsoulPlaneCatalog } from "./catalog";
import { buildPresentationMessages, type CardSpecBlock } from "./transform";

type Surface = SurfaceModel<ReactComponentImplementation>;

const warn = (why: string, e: unknown) => {
  // eslint-disable-next-line no-console
  console.warn(`[barsoul-a2ui] ${why}; falling back to legacy UI:`, e);
};

/** 描画中に投げられた例外を親に伝えるだけの境界（自身は何も描かない）。 */
class RenderFallback extends React.Component<{ onFail: () => void; children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { onFail: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    warn("surface render failed", error);
    this.props.onFail();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Props = {
  /** このノード固有のサーフェス ID。 */
  surfaceId: string;
  blocks: readonly CardSpecBlock[];
  detailOpen: boolean;
  /** ホワイトリスト Action の実処理。すべて block.tsx の既存経路を呼ぶ。 */
  handlers: AtomicActionHandlers;
  /** A2UI 経路が使えないと判明したとき呼ぶ。親は従来 UI に戻す。 */
  onFail: () => void;
};

const Inner: React.FC<Props> = ({ surfaceId, blocks, detailOpen, handlers, onFail }) => {
  // handlers は毎レンダー新しい関数になりうるので ref 経由で読む
  //（processor を作り直すとサーフェスが消えてしまうため）。
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // 初回はレンダー中に同期生成する。useEffect まで待つと摘要が 1 フレーム消える。
  const [boot] = useState<{ processor: MessageProcessor<ReactComponentImplementation>; surface: Surface | null }>(
    () => {
      const dispatch = createAtomicActionDispatcher({
        openAtomicComponent: (ctx) => handlersRef.current.openAtomicComponent(ctx),
        editAtomicComponent: (ctx) => handlersRef.current.editAtomicComponent(ctx),
        changeStatus: (ctx) => handlersRef.current.changeStatus(ctx),
      });
      const processor = new MessageProcessor<ReactComponentImplementation>([barsoulPlaneCatalog], dispatch);
      let surface: Surface | null = null;
      const sub = processor.onSurfaceCreated((s) => {
        surface = s;
      });
      try {
        processor.processMessages(buildPresentationMessages({ surfaceId, blocks, detailOpen }));
      } catch (e) {
        warn("surface bootstrap failed", e);
        surface = null;
      } finally {
        sub.unsubscribe();
      }
      return { processor, surface };
    }
  );

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!boot.surface) onFail();
      return;
    }
    if (!boot.surface) return;
    try {
      // createSurface は 1 度だけ。2 度目以降は updateComponents のみ流す
      //（同じ surfaceId で createSurface すると A2UI 側が例外を投げる）。
      const msgs = buildPresentationMessages({ surfaceId, blocks, detailOpen });
      boot.processor.processMessages(msgs.filter((m) => "updateComponents" in m));
    } catch (e) {
      warn("message processing failed", e);
      onFail();
    }
  }, [boot, surfaceId, blocks, detailOpen, onFail]);

  if (!boot.surface) return null;
  return <A2uiSurface surface={boot.surface} />;
};

export const AtomicPresentationSurface: React.FC<Props> = (props) => (
  <RenderFallback onFail={props.onFail}>
    <Inner {...props} />
  </RenderFallback>
);
