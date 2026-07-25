/**
 * BARSOUL 週次ミーティング支援 — API クライアント (hechun 2026-07-24)
 * 設計: docs/architecture/weekly-report-mvp.md
 *
 * 三層の境界が型にも出ている:
 *   ・sources / stats / draft_html = 再生成可能な派生(いつ消えてもよい)
 *   ・content_html = 人が書いた確定版 SoR(再集計でも消えない)
 * 画面はこの区別を隠さない — どちらを見ているかが常に分かること。
 */
import { API_BASE_URL } from "@plane/constants";
import type { TFileEntityInfo } from "@plane/types";
import { APIService } from "@/services/api.service";
import { FileService } from "@/services/file.service";

export type TWeeklyUser = {
  id: string;
  display_name: string;
  avatar_url: string;
};

/** 下書き生成はローカル推論で 1 人 ~70s。画面は状態を出して待てるようにする。 */
export type TDraftStatus = "" | "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export type TWeeklySource = {
  issue_id: string;
  project_id: string;
  identifier: string;
  sequence_id: number | string;
  title: string;
  bucket: "done" | "progress" | "discussion" | string;
  kind: string;
  at: string;
  excerpt?: string;
};

export type TWeeklyStats = {
  done?: number;
  progress?: number;
  discussion?: number;
  created?: number;
};

export type TWeeklyEntry = {
  id: string;
  member: TWeeklyUser | null;
  stats: TWeeklyStats;
  sources: TWeeklySource[];
  draft_html: string;
  content_html: string;
  model_used: string;
  draft_status: TDraftStatus;
  generated_at: string | null;
  edited_at: string | null;
  edited_by: TWeeklyUser | null;
};

export type TWeeklyMeeting = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  status: "OPEN" | "CONFIRMED" | string;
  held_at: string | null;
  /** 議事ノート = Plane ネイティブ Page。CE では project 配下にしか置けないので対で持つ。 */
  page_id: string | null;
  page_project_id: string | null;
  entries?: TWeeklyEntry[];
};

/** 発言への絵文字リアクション集計。me は返さない — 各クライアントが actor_ids と
 *  自分の id を突き合わせて計算する(実時配信は誰の視点でもないため)。 */
export type TMeetingChatReaction = {
  reaction: string;
  count: number;
  actors: string[];
  actor_ids: string[];
};

/** 引用元の軽量プレビュー。親が取り消されていれば deleted のみ(本文は無い)。 */
export type TMeetingChatReply = {
  id: string;
  author?: string;
  text?: string;
  source_lang?: string;
  translations?: Record<string, string>;
  deleted?: boolean;
};

/** 貼られた画像 1 枚。寸法は貼った時に測って送ってあるので、読み込み前に場所を確保できる。 */
export type TMeetingChatAttachment = {
  id: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
};

export type TMeetingChatMessage = {
  id: string;
  text: string;
  /** 画面キャプチャ等(無ければ null)。1 発言 1 枚。 */
  attachment: TMeetingChatAttachment | null;
  source_lang: string;
  author: TWeeklyUser | null;
  at: string;
  /** 後から直された発言は編集時刻が入る(隠さず「編集済み」を出すため)。 */
  edited_at: string | null;
  translations: Record<string, string>;
  reactions: TMeetingChatReaction[];
  /** 引用返信の親(無ければ null)。 */
  reply_to: TMeetingChatReply | null;
};

class WeeklyService extends APIService {
  private fileService = new FileService();

  constructor() {
    super(API_BASE_URL);
  }

  private base(slug: string) {
    return `/api/workspaces/${slug}/weekly-meetings/`;
  }

  async list(slug: string): Promise<TWeeklyMeeting[]> {
    return this.get(this.base(slug)).then((r) => r?.data ?? []);
  }

  async detail(slug: string, meetingId: string): Promise<TWeeklyMeeting> {
    return this.get(`${this.base(slug)}${meetingId}/`).then((r) => r?.data);
  }

  /** 会期を開く。既に OPEN があればそれが返る(重複作成しない=バックエンド側の保証)。 */
  async open(slug: string, title?: string): Promise<TWeeklyMeeting> {
    return this.post(this.base(slug), { title: title ?? "" }).then((r) => r?.data);
  }

  async patch_(slug: string, meetingId: string, data: { title?: string; page_id?: string | null }) {
    return this.patch(`${this.base(slug)}${meetingId}/`, data).then((r) => r?.data);
  }

  /**
   * 開き間違えた会期を捨てる。人が書いたもの(定稿・発言)が 1 つでもあれば 409 —
   * 消せるのは「空の会期」だけ、というのが三層境界の帰結。
   */
  async remove(slug: string, meetingId: string): Promise<void> {
    return this.delete(`${this.base(slug)}${meetingId}/`).then((r) => r?.data);
  }

  /**
   * 再集計。`generate: false` なら投影だけ作り直し LLM は回さない
   * (会議中に出処だけ更新したい時に速い)。member_id で 1 人だけの再生成も可。
   */
  async refresh(
    slug: string,
    meetingId: string,
    opts: { generate?: boolean; member_id?: string } = {}
  ): Promise<TWeeklyMeeting> {
    return this.post(`${this.base(slug)}${meetingId}/action/`, { action: "refresh", ...opts }).then((r) => r?.data);
  }

  /** 会議を確定 → held_at が次会期の起点になる(カレンダー週に依存しない)。 */
  async confirm(slug: string, meetingId: string): Promise<TWeeklyMeeting> {
    return this.post(`${this.base(slug)}${meetingId}/action/`, { action: "confirm" }).then((r) => r?.data);
  }

  /**
   * この会期の議事ノート(Plane Page)を作って紐付ける。冪等 — 既にあればそれを返す。
   * project_id が要るのは CE の Page が project 配下にしか存在できないため。
   */
  async createPage(slug: string, meetingId: string, projectId: string): Promise<TWeeklyMeeting> {
    return this.post(`${this.base(slug)}${meetingId}/action/`, { action: "create_page", project_id: projectId }).then(
      (r) => r?.data
    );
  }

  /** 確定の取り消し。押し間違いを復旧不能にしないための逃げ道(後続会期があれば 409)。 */
  async reopen(slug: string, meetingId: string): Promise<TWeeklyMeeting> {
    return this.post(`${this.base(slug)}${meetingId}/action/`, { action: "reopen" }).then((r) => r?.data);
  }

  /** 確定版の保存。**これは人の SoR** — 再集計でも下書き再生成でも消えない。 */
  async saveEntry(slug: string, meetingId: string, entryId: string, contentHtml: string): Promise<TWeeklyEntry> {
    return this.patch(`${this.base(slug)}${meetingId}/entries/${entryId}/`, { content_html: contentHtml }).then(
      (r) => r?.data
    );
  }

  async chatList(slug: string, meetingId: string): Promise<TMeetingChatMessage[]> {
    return this.get(`${this.base(slug)}${meetingId}/chat/`).then((r) => r?.data ?? []);
  }

  async chatSend(
    slug: string,
    meetingId: string,
    text: string,
    replyTo?: string,
    image?: { asset_id: string; width?: number; height?: number }
  ): Promise<TMeetingChatMessage> {
    return this.post(`${this.base(slug)}${meetingId}/chat/`, {
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(image ?? {}),
    }).then((r) => r?.data);
  }

  /**
   * 貼られた画像を Plane の資産パイプラインへ上げる(保存先も署名 URL も自前で作らない)。
   * 会議は project に属さないので workspace 直下 + entity_identifier=meeting_id で紐付ける。
   * 返す asset_id を chatSend に渡して初めて発言に結びつく(上げただけでは誰にも見えない)。
   */
  async uploadChatImage(slug: string, meetingId: string, file: File): Promise<string | null> {
    const data = {
      entity_type: "MEETING_CHAT" as TFileEntityInfo["entity_type"],
      entity_identifier: meetingId,
    };
    const res = (await this.fileService.uploadWorkspaceAsset(slug, data, file)) as { asset_id?: string };
    return res?.asset_id ?? null;
  }

  /** 自分の発言を直す。原文(SoR)を書き換え、訳文(派生)は作り直す。会期 OPEN の間だけ。 */
  async chatEdit(slug: string, meetingId: string, messageId: string, text: string): Promise<TMeetingChatMessage> {
    return this.patch(`${this.base(slug)}${meetingId}/chat/${messageId}/`, { text }).then((r) => r?.data);
  }

  /** 自分の発言を取り消す(訳文も一緒に消える)。会期 OPEN の間だけ。 */
  async chatDelete(slug: string, meetingId: string, messageId: string): Promise<void> {
    return this.delete(`${this.base(slug)}${meetingId}/chat/${messageId}/`).then((r) => r?.data);
  }

  /** リアクションのトグル(同じ絵文字を二度で外れる)。更新後の集計を返す。 */
  async chatReact(
    slug: string,
    meetingId: string,
    messageId: string,
    reaction: string
  ): Promise<TMeetingChatReaction[]> {
    return this.post(`${this.base(slug)}${meetingId}/chat/${messageId}/reactions/`, { reaction }).then(
      (r) => r?.data ?? []
    );
  }

  /** 表示翻訳(派生キャッシュ)。原文は一切変更しない。 */
  async translate(
    slug: string,
    body: { entity: "weekly_entry" | "chat_message" | "page"; object_id: string; field: string; target_lang: "ja" | "zh"; text: string }
  ): Promise<{ text: string; cached: boolean }> {
    return this.post(`/api/workspaces/${slug}/content-translate/`, body).then((r) => r?.data);
  }
}

export const weeklyService = new WeeklyService();
