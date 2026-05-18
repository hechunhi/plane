/**
 * BARSOUL C1: 課題詳細に keiri 受注ステータス＋単票リンクを表示。
 * 案件(受注)の Plane 課題から、紐づく keiri の受注状態・請求書へ
 * ワンクリックで遷移（keiri は同一 Authelia SSO なのでリンク先で
 * 追加ログイン不要）。未連携 / 取得不可は何も描画しない（ノイズ排除）。
 */
import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { ExternalLink, FileText, ReceiptText } from "lucide-react";
import { keiriService } from "@/services/keiri.service";
import type { TKeiriOrderResponse } from "@/services/keiri.service";

type Props = {
  workspaceSlug: string;
  issueId: string;
};

const DOC_LABEL: Record<string, string> = {
  invoice: "請求書",
  contract: "契約書",
  packing_list: "パッキングリスト",
  delivery_note: "納品書",
  purchase_order: "発注書",
  pl: "PL",
  ci: "CI",
};

export const KeiriOrderWidget = observer(function KeiriOrderWidget(props: Props) {
  const { workspaceSlug, issueId } = props;
  const [hidden, setHidden] = useState(false);

  const { data } = useSWR<TKeiriOrderResponse>(
    workspaceSlug && issueId ? `KEIRI_ORDER_${workspaceSlug}_${issueId}` : null,
    workspaceSlug && issueId ? () => keiriService.getOrderByIssue(workspaceSlug, issueId) : null,
    { revalidateOnFocus: false }
  );

  if (hidden || !data || !data.linked) return null;

  const { order, documents, order_url } = data;
  const amounts = [
    order.jpy && Number(order.jpy) ? `¥${Number(order.jpy).toLocaleString()}` : null,
    order.cny && Number(order.cny) ? `CN¥${Number(order.cny).toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="my-4 rounded-lg border border-subtle bg-layer-1 p-3 text-13">
      <div className="mb-2 flex items-center gap-2">
        <ReceiptText className="size-4 text-accent-primary" />
        <span className="font-semibold text-primary">keiri 連携（経理）</span>
        {order.status && (
          <span
            className="ml-1 rounded-full px-2 py-0.5 text-11 font-medium"
            style={{ background: "var(--bg-accent-primary)", color: "#fff" }}
          >
            {order.status}
          </span>
        )}
        <button
          type="button"
          className="ml-auto text-11 text-tertiary hover:text-secondary"
          onClick={() => setHidden(true)}
        >
          非表示
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-secondary">
        <div>
          受注先: <span className="text-primary">{order.customer || "—"}</span>
        </div>
        <div>
          受注日: <span className="text-primary">{order.date || "—"}</span>
        </div>
        {amounts && (
          <div className="col-span-2">
            金額: <span className="text-primary">{amounts}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {documents
          .filter((d) => d.url)
          .map((d, i) => (
            <a
              key={`${d.doc_type}-${i}`}
              href={d.url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-subtle px-2 py-1 text-12 text-primary hover:border-strong hover:bg-layer-2"
            >
              <FileText className="size-3.5 text-accent-primary" />
              {DOC_LABEL[d.doc_type || ""] || d.doc_type}
              {d.status ? `（${d.status}）` : ""}
            </a>
          ))}
        <a
          href={order_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-subtle px-2 py-1 text-12 text-accent-primary hover:border-strong hover:bg-layer-2"
        >
          <ExternalLink className="size-3.5" />
          keiri で開く
        </a>
      </div>
    </div>
  );
});
