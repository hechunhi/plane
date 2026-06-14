/**
 * BARSOUL: 「翻译」视图 — schema i18n(表名/列名/选项字典/表单名/字段别名)。跨语言团队用。
 * 原名=键(蓝图/反应按名引用, 选项值=单元格数据), 翻译是显示层 overlay, 绝不改原名。
 * ✨爱酱一键翻译(LLM gateway, 即点即译同管线): 默认只填空槽, 用户可在译文上继续修改(blur 即存)。
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import {
  smartTableService,
  type TSchemaI18n,
  type TSmartForm,
  type TSmartTable,
} from "@/services/smart-table.service";

const LANGS = ["zh", "ja", "en"] as const;
const LANG_LABEL: Record<string, string> = { zh: "中文", ja: "日本語", en: "English" };

type Props = { ws: string; pid: string; table: TSmartTable; onChanged: () => void };

// 一行词条: 读/写某对象 i18n 的一个槽位
type Row = {
  group: string;
  src: string;
  get: (lang: string) => string;
  set: (lang: string, v: string) => void;
};

export function SmartTableI18n({ ws, pid, table, onChanged }: Props) {
  const zh = useZh();
  const [forms, setForms] = useState<TSmartForm[]>([]);
  const [tblI18n, setTblI18n] = useState<TSchemaI18n>(table.i18n ?? {});
  const [colI18n, setColI18n] = useState<Record<string, TSchemaI18n>>({});
  const [formI18n, setFormI18n] = useState<Record<string, TSchemaI18n>>({});
  const [busy, setBusy] = useState(false);

  const T = zh
    ? { title: "翻译(显示层)", hint: "原名是系统内的「键」(蓝图/自动化按名引用, 选项值即单元格数据), 翻译只改各语言下的显示, 不动原名。改完离开输入框即保存。", translate: "爱酱翻译空缺", retranslate: "全部重译(覆盖)", translating: "翻译中…", src: "原文", done: (n: number) => `已填 ${n} 处译文`, fail: "翻译失败(网关不可用?)", gTable: "表", gCol: "列", gOpt: "选项字典", gForm: "表单", gLabel: "表单字段别名" }
    : { title: "翻訳(表示レイヤー)", hint: "元の名前はシステム内の「キー」です。翻訳は各言語での表示のみ変更します。編集後フォーカスを外すと保存。", translate: "愛ちゃんで空欄を翻訳", retranslate: "すべて再翻訳(上書き)", translating: "翻訳中…", src: "原文", done: (n: number) => `${n} 件の訳文を反映`, fail: "翻訳失敗", gTable: "テーブル", gCol: "列", gOpt: "選択肢辞書", gForm: "フォーム", gLabel: "フォーム項目の別名" };

  const reload = useCallback(async () => {
    const fs = await smartTableService.listForms(ws, pid, table.id);
    setForms(fs);
    setTblI18n(table.i18n ?? {});
    const cm: Record<string, TSchemaI18n> = {};
    table.columns.forEach((c) => (cm[c.id] = c.i18n ?? {}));
    setColI18n(cm);
    const fm: Record<string, TSchemaI18n> = {};
    fs.forEach((f) => (fm[f.id] = f.i18n ?? {}));
    setFormI18n(fm);
  }, [ws, pid, table]);

  useEffect(() => { void reload(); }, [reload]);

  // 槽位读写工具
  const slotGet = (m: TSchemaI18n, lang: string, kind: "name" | "options" | "labels", key?: string): string => {
    const s = m[lang];
    if (!s) return "";
    if (kind === "name") return s.name ?? "";
    if (kind === "options") return s.options?.[key ?? ""] ?? "";
    return s.labels?.[key ?? ""] ?? "";
  };
  const slotSet = (m: TSchemaI18n, lang: string, kind: "name" | "options" | "labels", v: string, key?: string): TSchemaI18n => {
    const next = { ...m, [lang]: { ...(m[lang] ?? {}) } };
    if (kind === "name") next[lang].name = v;
    else if (kind === "options") next[lang].options = { ...(next[lang].options ?? {}), [key ?? ""]: v };
    else next[lang].labels = { ...(next[lang].labels ?? {}), [key ?? ""]: v };
    return next;
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    out.push({
      group: T.gTable, src: table.name,
      get: (l) => slotGet(tblI18n, l, "name"),
      set: (l, v) => setTblI18n((p) => slotSet(p, l, "name", v)),
    });
    for (const c of table.columns) {
      out.push({
        group: T.gCol, src: c.name,
        get: (l) => slotGet(colI18n[c.id] ?? {}, l, "name"),
        set: (l, v) => setColI18n((p) => ({ ...p, [c.id]: slotSet(p[c.id] ?? {}, l, "name", v) })),
      });
      if (c.type === "single_select" || c.type === "multi_select") {
        for (const o of c.options) {
          out.push({
            group: T.gOpt, src: `${c.name} · ${o.v}`,
            get: (l) => slotGet(colI18n[c.id] ?? {}, l, "options", o.v),
            set: (l, v) => setColI18n((p) => ({ ...p, [c.id]: slotSet(p[c.id] ?? {}, l, "options", v, o.v) })),
          });
        }
      }
    }
    for (const f of forms) {
      out.push({
        group: T.gForm, src: f.name,
        get: (l) => slotGet(formI18n[f.id] ?? {}, l, "name"),
        set: (l, v) => setFormI18n((p) => ({ ...p, [f.id]: slotSet(p[f.id] ?? {}, l, "name", v) })),
      });
      for (const fl of f.fields) {
        if (!fl.label) continue;
        out.push({
          group: T.gLabel, src: `${f.name} · ${fl.label}`,
          get: (l) => slotGet(formI18n[f.id] ?? {}, l, "labels", fl.col),
          set: (l, v) => setFormI18n((p) => ({ ...p, [f.id]: slotSet(p[f.id] ?? {}, l, "labels", v, fl.col) })),
        });
      }
    }
    return out;
  }, [table, forms, tblI18n, colI18n, formI18n, T]);

  // blur 时整对象落库(简单可靠)
  const saveAll = useCallback(() => {
    void smartTableService.updateTable(ws, pid, table.id, { i18n: tblI18n }).catch(() => {});
    table.columns.forEach((c) => {
      void smartTableService.updateColumn(ws, pid, table.id, c.id, { i18n: colI18n[c.id] ?? {} }).catch(() => {});
    });
    forms.forEach((f) => {
      void smartTableService.updateForm(ws, pid, table.id, f.id, { i18n: formI18n[f.id] ?? {} }).catch(() => {});
    });
  }, [ws, pid, table, forms, tblI18n, colI18n, formI18n]);

  const translate = useCallback(async (overwrite: boolean) => {
    setBusy(true);
    const res = await smartTableService.translateTable(ws, pid, table.id, { targets: ["zh", "ja", "en"], overwrite });
    setBusy(false);
    if (res) {
      const n = Object.values(res.filled).reduce((a, b) => a + b, 0);
      setToast({ type: TOAST_TYPE.SUCCESS, title: T.done(n), message: zh ? "可直接在表格里修改译文" : "訳文はこの画面で編集できます" });
      onChanged(); // 重拉 table(含列 i18n) → 本组件经 props 变化 reload
    } else {
      setToast({ type: TOAST_TYPE.ERROR, title: T.fail, message: "" });
    }
  }, [ws, pid, table.id, onChanged, zh, T]);

  const inputCls = "w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong";
  let lastGroup = "";

  return (
    <div className="vertical-scrollbar min-h-0 flex-1 overflow-auto bg-surface-1 p-page-x">
      <div className="mx-auto max-w-4xl py-5">
        <div className="flex items-center gap-2">
          <span className="text-14 font-semibold text-primary">{T.title}</span>
          <button type="button" disabled={busy} onClick={() => void translate(false)} className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-12 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50">
            <Sparkles className="size-3.5" /> {busy ? T.translating : T.translate}
          </button>
          <button type="button" disabled={busy} onClick={() => void translate(true)} className="inline-flex items-center gap-1.5 rounded-md border border-subtle px-3 py-1.5 text-12 text-secondary hover:bg-layer-1-hover disabled:opacity-50">
            <RefreshCw className="size-3.5" /> {T.retranslate}
          </button>
        </div>
        <p className="mt-1.5 max-w-2xl text-11 leading-relaxed text-tertiary">{T.hint}</p>

        {/* 窄屏/低分辨: 4 列译表横向滚动而非挤压(min-w 兜底, horizontal-scrollbar 拿回滚动条) */}
        <div className="horizontal-scrollbar mt-4 overflow-x-auto rounded-md border border-subtle">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-px bg-layer-2 text-11 font-semibold uppercase tracking-wide text-placeholder">
              <div className="bg-layer-1 px-3 py-2">{T.src}</div>
              {LANGS.map((l) => (<div key={l} className="bg-layer-1 px-3 py-2">{LANG_LABEL[l]}</div>))}
            </div>
            {rows.map((r, i) => {
              const showGroup = r.group !== lastGroup;
              lastGroup = r.group;
              return (
                <div key={i}>
                  {showGroup && <div className="border-t border-subtle bg-layer-1 px-3 py-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{r.group}</div>}
                  <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] items-center gap-2 border-t border-subtle px-3 py-1.5">
                    <div className="truncate text-12 text-secondary" title={r.src}>{r.src}</div>
                    {LANGS.map((l) => (
                      <input key={l} value={r.get(l)} placeholder="—" onChange={(e: ChangeEvent<HTMLInputElement>) => r.set(l, e.target.value)} onBlur={saveAll} className={inputCls} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
