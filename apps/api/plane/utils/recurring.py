# BARSOUL: 定期タスク 日期求值(纯函数, 易单测)。见 docs/architecture/recurring-tasks-mvp.md。
# 红线: 全部按 JST 求值; 月末/小月/2月/季度边界用「真实日历 + 逐日前进匹配」消灭 off-by-one,
#       绝不手写减法、绝不存死日期。月末=该月实际末日, day=N 超出当月→钳到末日。
import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")
UTC = ZoneInfo("UTC")

_MAX_WALK = 400  # 逐日前进上限(覆盖年周期 + 闰年余量); 超出=anchor 配置无效


def last_day_of_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _clamp_day(year: int, month: int, day: int) -> int:
    return min(day, last_day_of_month(year, month))


def _quarter_due_months(start_month: int) -> set[int]:
    # 季度末月 = 每季的第3个月。start_month=1 → {3,6,9,12}(日历季); =4(日本财年)→ {6,9,12,3}
    return {((start_month - 1 + 3 * k + 2) % 12) + 1 for k in range(4)}


def _quarter_number(due: date, start_month: int) -> int:
    # 该 due 落在以 start_month 为起点的第几季(1..4)
    offset = (due.month - start_month) % 12
    return offset // 3 + 1


def _matches(rule_cadence: str, anchor: dict, d: date) -> bool:
    """d(JST date)是否命中规则的「期日」锚点。"""
    if rule_cadence == "weekly":
        wds = anchor.get("weekdays") or []
        return d.isoweekday() in wds  # 1=月曜 .. 7=日曜
    if rule_cadence == "monthly":
        mode = anchor.get("mode", "day")
        if mode == "eom":
            return d.day == last_day_of_month(d.year, d.month)
        if mode == "bom":
            return d.day == 1
        return d.day == _clamp_day(d.year, d.month, int(anchor.get("day", 1)))
    if rule_cadence == "quarterly":
        if d.month not in _quarter_due_months(int(anchor.get("start_month", 1))):
            return False
        mode = anchor.get("mode", "eom")
        if mode == "eom":
            return d.day == last_day_of_month(d.year, d.month)
        return d.day == _clamp_day(d.year, d.month, int(anchor.get("day", 1)))
    if rule_cadence == "yearly":
        m = int(anchor.get("month", 1))
        return d.month == m and d.day == _clamp_day(d.year, d.month, int(anchor.get("day", 1)))
    return False


def next_due_after(cadence: str, anchor: dict, after: date) -> date | None:
    """严格晚于 after 的下一个期日(JST date)。逐日前进, 真实日历, 无 off-by-one。"""
    d = after + timedelta(days=1)
    for _ in range(_MAX_WALK):
        if _matches(cadence, anchor, d):
            return d
        d += timedelta(days=1)
    return None


def period_key(cadence: str, anchor: dict, due: date) -> str:
    """幂等去重键(同一期只生成一次)。"""
    if cadence == "weekly":
        return due.isoformat()
    if cadence == "monthly":
        return f"{due.year}-{due.month:02d}"
    if cadence == "quarterly":
        return f"{due.year}-Q{_quarter_number(due, int(anchor.get('start_month', 1)))}"
    if cadence == "yearly":
        return f"{due.year}"
    return due.isoformat()


def period_label(cadence: str, anchor: dict, due: date) -> str:
    """人读期段(进卡名): 「6月分」「2026 Q2」「2026年」「6/16」。"""
    if cadence == "weekly":
        return f"{due.month}/{due.day}"
    if cadence == "monthly":
        return f"{due.month}月分"
    if cadence == "quarterly":
        return f"{due.year} Q{_quarter_number(due, int(anchor.get('start_month', 1)))}"
    if cadence == "yearly":
        return f"{due.year}年"
    return due.isoformat()


def gen_datetime_utc(due: date, lead_days: int) -> datetime:
    """生成时刻 = (期日 − lead 天) 的 JST 00:00 → UTC。daily 扫描在此刻之后即触发。"""
    gen_date = due - timedelta(days=max(0, int(lead_days)))
    return datetime(gen_date.year, gen_date.month, gen_date.day, 0, 0, tzinfo=JST).astimezone(UTC)


def now_jst_date(now_utc: datetime) -> date:
    """UTC now → JST 日界的「今天」(逾期跨日判断统一走这, 避免 UTC .days off-by-one)。"""
    return now_utc.astimezone(JST).date()


def add_working_days(start: date, n: int) -> date:
    """从 start 起算 n 个营业日后(跳周末)。フォローアップ「2営業日後」用。祝日は未対応(後で追加可)。"""
    d = start
    step = 1 if n >= 0 else -1
    remaining = abs(int(n))
    while remaining > 0:
        d += timedelta(days=step)
        if d.isoweekday() < 6:  # 1..5 = 平日
            remaining -= 1
    return d


def snooze_datetime_utc(target: date) -> datetime:
    """スヌーズ解除/再浮上の時刻 = 対象日の JST 00:00 → UTC。daily 扫描(JST07:00)がその後ベル。"""
    return datetime(target.year, target.month, target.day, 0, 0, tzinfo=JST).astimezone(UTC)
