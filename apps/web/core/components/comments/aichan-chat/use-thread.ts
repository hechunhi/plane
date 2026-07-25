/**
 * BARSOUL 愛ちゃん私聊 — スレッド状態(2026-07-25, hechun)
 *
 * 設計の芯: **ここでのやり取りはサーバに残さない**。
 *   ユーザーの不安は「コメント欄で愛ちゃんに頼むと全員に飛ぶ」ことだった。
 *   だから私聊は課題ごとの localStorage にだけ置く —— リロードでは消えないが、
 *   誰にも届かないし、SoR(コメント/通知/webhook)には一切触れない。
 *   公開したいときだけ「コメントに引用」で本物のコメント欄へ *挿入* する
 *   (投稿はしない —— 送信ボタンを押すのは最後まで人間)。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type TChatRole = "user" | "assistant";
export type TChatTurn = { role: TChatRole; content: string };

/** 履歴は直近 20 ターンまで。プロンプトの肥大とストレージ圧迫の両方を抑える。 */
const MAX_TURNS = 20;

const storageKey = (issueId: string) => `barsoul.aichan.thread:${issueId}`;

const load = (issueId: string): TChatTurn[] => {
  try {
    const raw = localStorage.getItem(storageKey(issueId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is TChatTurn =>
          !!t &&
          typeof t === "object" &&
          typeof (t as TChatTurn).content === "string" &&
          ((t as TChatTurn).role === "user" || (t as TChatTurn).role === "assistant")
      )
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
};

const save = (issueId: string, turns: TChatTurn[]) => {
  try {
    localStorage.setItem(storageKey(issueId), JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* localStorage 不可 = 揮発運用に降格。機能は止めない。 */
  }
};

type TArgs = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  lang: string;
};

export function useAichanThread({ workspaceSlug, projectId, issueId, lang }: TArgs) {
  const [turns, setTurns] = useState<TChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // 送信中に turns が古い closure に閉じ込められないように ref を併走させる。
  const turnsRef = useRef<TChatTurn[]>([]);
  turnsRef.current = turns;

  // 課題が変われば別スレッド。文脈はコメント欄の場所そのものなので、混ぜない。
  useEffect(() => {
    setTurns(load(issueId));
    setError("");
    setPending(false);
  }, [issueId]);

  const clear = useCallback(() => {
    setTurns([]);
    setError("");
    try {
      localStorage.removeItem(storageKey(issueId));
    } catch {
      /* ignore */
    }
  }, [issueId]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || pending) return;
      const next = [...turnsRef.current, { role: "user" as const, content }].slice(-MAX_TURNS);
      setTurns(next);
      save(issueId, next);
      setPending(true);
      setError("");
      try {
        const r = await fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/ai-approval/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ action: "chat", lang, messages: next }),
        });
        let j: { ok?: boolean; reply?: string; error?: string; msg?: string } = {};
        try {
          j = await r.json();
        } catch {
          /* non-json */
        }
        if (!r.ok || !j?.ok || !j.reply) throw new Error(j?.error || j?.msg || "request failed");
        const withReply = [...next, { role: "assistant" as const, content: j.reply }].slice(-MAX_TURNS);
        setTurns(withReply);
        save(issueId, withReply);
      } catch (e) {
        // 直前のユーザー発言は残す —— 「再試行」で打ち直させないため。
        setError(e instanceof Error ? e.message : "request failed");
      } finally {
        setPending(false);
      }
    },
    [workspaceSlug, projectId, issueId, lang, pending]
  );

  /** 直近のユーザー発言をもう一度投げる(返答が失敗したとき用)。 */
  const retry = useCallback(() => {
    const all = turnsRef.current;
    let at = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].role === "user") {
        at = i;
        break;
      }
    }
    if (at === -1) return;
    // 失敗した発言はいったん外して、同じ内容で投げ直す(二重表示にしない)。
    const trimmed = all.slice(0, at);
    setTurns(trimmed);
    turnsRef.current = trimmed;
    void send(all[at].content);
  }, [send]);

  return { turns, pending, error, send, retry, clear };
}
