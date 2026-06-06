/**
 * BARSOUL DIS: 项目 issues 真实 header 里的 AI 控件 —— 看板/待我处理 切换 + 颜色图例。
 * v5: 移除独立语言控件(AI 文案语言跟随 Plane 界面语言设置)。
 */
import { useTranslation } from "@plane/i18n";
import { useAiView, setAiView, isZhLocale, Ico, ICON } from "./ai-state-line";

export function AIBoardControls() {
  const view = useAiView();
  const { currentLocale } = useTranslation();
  const zh = isZhLocale(currentLocale);
  const L = zh
    ? { board: "看板", digest: "待我处理", legend: "颜色含义", us: "需我处理(球在自己)", them: "球在他人(同事 / 外部 · 显示具体名)", red: "逾期 / 严重停滞", amber: "中度停滞 / 低置信" }
    : { board: "ボード", digest: "対応待ち", legend: "色の意味", us: "自分が対応(自分にボール)", them: "他者待ち(同僚 / 先方 · 名前表示)", red: "期限超過 / 重度停滞", amber: "中度停滞 / 低確度" };

  const Tab = ({ id, icon, label }: { id: "board" | "digest"; icon: string[]; label: string }) => {
    const active = view === id;
    return (
      <button type="button" onClick={() => setAiView(id)}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-md border-0 px-2.5 text-xs font-semibold"
        style={{ background: active ? "#fff" : "transparent", color: active ? "#1f2328" : "#71757c", boxShadow: active ? "0 1px 2px rgba(16,24,40,0.1)" : "none", cursor: "pointer", fontFamily: "inherit" }}>
        <Ico d={icon} size={14} sw={1.8} color={id === "digest" ? (active ? "#7c5cff" : "#a3a7ad") : "currentColor"} />{label}
      </button>
    );
  };
  const LegendRow = ({ icon, color, dot, text }: { icon: string[]; color: string; dot?: string; text: string }) => (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: "#4a4d53" }}>
      {dot ? <span style={{ width: 9, height: 9, borderRadius: 99, background: dot, flex: "none" }} /> : <Ico d={icon} size={12} color={color} />}
      <span>{text}</span>
    </div>
  );

  return (
    <div className="hidden items-center gap-2 md:flex">
      <div className="inline-flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "#eef0f2" }}>
        <Tab id="board" icon={ICON.columns} label={L.board} />
        <Tab id="digest" icon={ICON.sparkle} label={L.digest} />
      </div>
      <div className="group/dis-legend relative">
        <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-md" style={{ color: "#9499a0", cursor: "default" }} title={L.legend}>
          <Ico d={["M12 16v-4", "M12 8h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"]} size={15} />
        </button>
        <div className="invisible absolute right-0 top-7 z-[60] w-56 rounded-lg border p-2.5 opacity-0 shadow-lg transition-opacity group-hover/dis-legend:visible group-hover/dis-legend:opacity-100"
          style={{ background: "#fff", borderColor: "#e3e5e9", display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="text-[10px] font-semibold" style={{ color: "#9499a0", letterSpacing: ".04em" }}>{L.legend}</div>
          <LegendRow icon={ICON.inbox} color="#d97a0a" dot="#d97a0a" text={L.us} />
          <LegendRow icon={ICON.send} color="#7a8da0" dot="#7a8da0" text={L.them} />
          <LegendRow icon={ICON.alert} color="#c0392b" text={L.red} />
          <LegendRow icon={ICON.clock} color="#b06d09" text={L.amber} />
        </div>
      </div>
    </div>
  );
}
