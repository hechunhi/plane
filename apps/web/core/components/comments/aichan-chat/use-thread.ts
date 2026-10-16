/**
 * BARSOUL 愛ちゃん私聊 — スレッド状態(2026-07-25, hechun)
 *
 * 設計の芯: **ここでのやり取りはサーバに残さない**。
 *   ユーザーの不安は「コメント欄で愛ちゃんに頼むと全員に飛ぶ」ことだった。
 *   だから私聊は課題ごとの localStorage にだけ置く —— リロードでは消えないが、
 *   誰にも届かないし、SoR(コメント/通知/webhook)には一切触れない。
 *   公開したいときだけ「コメントに引用」で本物のコメント欄へ *挿入* する
 *   (投稿はしない —— 送信ボタンを押すのは最後まで人間)。
 *
 * 2026-10-06: 返答待ちは jobs.ts(後台 job)へ移した。ここは「表示と送信の窓口」だけ。
 *   パネルを閉じても / 別ページへ移っても待ちは続き、戻れば返答がスレッドに入っている。
 *   ai-bot に残るのは返答 1 件だけ(1 時間で消える・発起人以外には見えない)。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  MAX_TURNS,
  chatEndpoint,
  dismissJob,
  getJobsSnapshot,
  getServerJobsSnapshot,
  post,
  readThread,
  startChatJob,
  subscribeJobs,
  writeThread,
} from "./jobs";

export type TChatRole = "user" | "assistant";
export type TChatTurn = { role: TChatRole; content: string };
/** 「愛ちゃん名義で送る」の宛先候補(ai-bot が在籍メンバーから作る。本文に名前があれば selected)。 */
export type TPostCandidate = { id: string; name: string; selected: boolean };

type TArgs = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueTitle?: string;
  lang: string;
};

export function useAichanThread({ workspaceSlug, projectId, issueId, issueTitle, lang }: TArgs) {
  const jobs = useSyncExternalStore(subscribeJobs, getJobsSnapshot, getServerJobsSnapshot);
  const job = jobs[issueId];
  const [turns, setTurns] = useState<TChatTurn[]>([]);
  const [sendError, setSendError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // 課題が変われば別スレッド。job が進む(返答が書かれる / 他タブが書く)たびに読み直す。
  useEffect(() => {
    setTurns(readThread(issueId));
    return subscribeJobs(() => setTurns(readThread(issueId)));
  }, [issueId]);

  useEffect(() => setSendError(""), [issueId]);

  const pending = job?.status === "running";

  // 待ち時間の表示用(1 秒刻み)。待っていない間は止める。
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pending]);

  const elapsedSec = pending && job ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : 0;
  const error = sendError || (job?.status === "error" ? (job.error ?? "failed") : "");

  const clear = useCallback(() => {
    writeThread(issueId, []);
    dismissJob(issueId);
    setTurns([]);
    setSendError("");
  }, [issueId]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || pending) return;
      const next = [...readThread(issueId), { role: "user" as const, content }].slice(-MAX_TURNS);
      writeThread(issueId, next);
      setTurns(next);
      setSendError("");
      dismissJob(issueId); // 前回の error 札は新しい送信で置き換える
      try {
        await startChatJob({
          workspaceSlug,
          projectId,
          issueId,
          issueTitle,
          href: `${window.location.pathname}${window.location.search}`,
          lang,
          messages: next,
        });
      } catch (e) {
        // 直前のユーザー発言は残す —— 「再試行」で打ち直させないため。
        setSendError(e instanceof Error ? e.message : "failed");
      }
    },
    [workspaceSlug, projectId, issueId, issueTitle, lang, pending]
  );

  /**
   * 2026-10-06(hechun「評論区 @愛ちゃん と同じことを。@ が多いと噪音」):
   * このユーザー発言を @愛ちゃん と同じパイプラインで実行する。依頼文はコメントに出ない。
   * カード/審査など公開が目的の結果だけがコメント欄に出て、報告はこのスレッドに入る。
   */
  const act = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || pending) return;
      setSendError("");
      dismissJob(issueId);
      try {
        await startChatJob({
          kind: "act",
          workspaceSlug,
          projectId,
          issueId,
          issueTitle,
          href: `${window.location.pathname}${window.location.search}`,
          lang,
          text: content,
        });
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "failed");
      }
    },
    [workspaceSlug, projectId, issueId, issueTitle, lang, pending]
  );

  const ep = useMemo(() => chatEndpoint({ workspaceSlug, projectId, issueId }), [workspaceSlug, projectId, issueId]);

  /** 宛先候補だけを取る(何も投稿しない)。 */
  const postCandidates = useCallback(
    async (text: string) =>
      (await post<{ candidates: TPostCandidate[] }>(ep, { action: "chat_post", dry_run: true, lang, text })).candidates,
    [ep, lang]
  );

  /** 返答を愛ちゃん名義でコメントに出す(本人がボタンで確定した時だけ)。 */
  const postAs = useCallback(
    async (text: string, mentionIds: string[]) => {
      await post(ep, { action: "chat_post", lang, text, mention_ids: mentionIds });
    },
    [ep, lang]
  );

  /** 直近のユーザー発言をもう一度投げる(返答が失敗したとき用)。 */
  const retry = useCallback(() => {
    const all = readThread(issueId);
    let at = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].role === "user") {
        at = i;
        break;
      }
    }
    if (at === -1) return;
    // 実行(act)の失敗は実行し直す。発言はスレッドに残したまま。
    if (job?.kind === "act") {
      void act(all[at].content);
      return;
    }
    // 失敗した発言はいったん外して、同じ内容で投げ直す(二重表示にしない)。
    writeThread(issueId, all.slice(0, at));
    void send(all[at].content);
  }, [issueId, send, act, job?.kind]);

  /** 待つのをやめる(ai-bot 側は走り切るが、返答は捨てる)。発言は残す。 */
  const cancel = useCallback(() => dismissJob(issueId), [issueId]);

  return useMemo(
    () => ({
      turns,
      pending,
      pendingKind: job?.kind ?? "chat",
      elapsedSec,
      error,
      send,
      act,
      postCandidates,
      postAs,
      retry,
      clear,
      cancel,
    }),
    [turns, pending, job?.kind, elapsedSec, error, send, act, postCandidates, postAs, retry, clear, cancel]
  );
}
