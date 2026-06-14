# BARSOUL: 定期タスク 日期求值单测(红线: 月末/小月/闰年/季度/JST 边界须覆盖)。
# 见 docs/architecture/recurring-tasks-mvp.md。纯函数, 无 DB。
from datetime import date

from plane.utils.recurring import (
    gen_datetime_utc,
    next_due_after,
    period_key,
    period_label,
    _quarter_due_months,
)


def test_month_end_non_leap_and_leap():
    assert next_due_after("monthly", {"mode": "eom"}, date(2026, 2, 1)) == date(2026, 2, 28)
    assert next_due_after("monthly", {"mode": "eom"}, date(2024, 2, 1)) == date(2024, 2, 29)


def test_day_clamps_to_month_length():
    # 31 日在 4 月(30 天)→ 钳到 30, 不静默漏触发
    assert next_due_after("monthly", {"mode": "day", "day": 31}, date(2026, 4, 1)) == date(2026, 4, 30)
    assert next_due_after("monthly", {"mode": "day", "day": 31}, date(2026, 1, 1)) == date(2026, 1, 31)


def test_month_begin_crosses_month():
    assert next_due_after("monthly", {"mode": "bom"}, date(2026, 6, 2)) == date(2026, 7, 1)


def test_calendar_quarter_end_months():
    assert _quarter_due_months(1) == {3, 6, 9, 12}
    assert next_due_after("quarterly", {"start_month": 1, "mode": "eom"}, date(2026, 6, 30)) == date(2026, 9, 30)
    assert period_key("quarterly", {"start_month": 1}, date(2026, 6, 30)) == "2026-Q2"


def test_japanese_fiscal_quarter():
    # 日本财年 4 月始 → 季末月 6/9/12/3
    assert _quarter_due_months(4) == {6, 9, 12, 3}


def test_weekly_next_monday():
    nd = next_due_after("weekly", {"weekdays": [1]}, date(2026, 6, 14))  # 6/14 是周日
    assert nd == date(2026, 6, 15) and nd.isoweekday() == 1


def test_period_labels_human_readable():
    assert period_label("monthly", {}, date(2026, 6, 30)) == "6月分"
    assert period_label("quarterly", {"start_month": 1}, date(2026, 6, 30)) == "2026 Q2"
    assert period_label("yearly", {}, date(2026, 6, 30)) == "2026年"


def test_jst_generation_time_is_utc_minus_9():
    # 7/1 JST 00:00 生成(lead 0) → 6/30 15:00 UTC
    g = gen_datetime_utc(date(2026, 7, 1), 0)
    assert g.isoformat() == "2026-06-30T15:00:00+00:00"
    # 月末提前 3 天: 6/30 期日 → 6/27 JST 00:00 → 6/26 15:00 UTC
    g2 = gen_datetime_utc(date(2026, 6, 30), 3)
    assert g2.isoformat() == "2026-06-26T15:00:00+00:00"


def test_no_match_returns_none():
    # 周锚点空 → 无命中 → None(引擎据此判定 anchor 无效, 不崩)
    assert next_due_after("weekly", {"weekdays": []}, date(2026, 6, 1)) is None
