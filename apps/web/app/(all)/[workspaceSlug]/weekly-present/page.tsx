/**
 * BARSOUL 週会放映幕 — ページ (hechun 2026-07-27)
 * 幕の中身は stage-root が持つ。ここはタイトルを付けて幕を置くだけ。
 */
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { WeeklyStageRoot } from "@/components/weekly/present/stage-root";

function WeeklyPresentPage() {
  const { t } = useTranslation();

  return (
    <>
      <PageHead title={t("weekly.present.title")} />
      <WeeklyStageRoot />
    </>
  );
}

export default observer(WeeklyPresentPage);
