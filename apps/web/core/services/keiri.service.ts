/**
 * BARSOUL C1: Plane↔keiri 単据反链。Plane バックエンドの内網プロキシ
 * GET /api/workspaces/<slug>/keiri-order/<issueId>/ を叩くだけの薄い service。
 * （keiri-api を直接叩かないのは CORS と認証境界のため＝詳細は Django 側コメント）
 */
import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TKeiriOrderResponse =
  | { linked: false }
  | {
      linked: true;
      order: {
        order_id: number;
        customer: string | null;
        date: string | null;
        status: string | null;
        cny: string | null;
        jpy: string | null;
      };
      documents: { doc_type: string | null; status: string | null; url: string | null }[];
      order_url: string;
    };

class KeiriService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getOrderByIssue(workspaceSlug: string, issueId: string): Promise<TKeiriOrderResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/keiri-order/${issueId}/`)
      .then((res) => res?.data)
      .catch(() => ({ linked: false }) as TKeiriOrderResponse);
  }
}

export const keiriService = new KeiriService();
