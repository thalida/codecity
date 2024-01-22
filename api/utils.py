from datetime import datetime, timezone
from statistics import geometric_mean, median


def geometric_mean_datetime(datetimes: list[datetime]) -> datetime:
    timestamps = [time.timestamp() for time in datetimes]
    mean_timestamp = geometric_mean(timestamps)
    utc_datetime = datetime.fromtimestamp(mean_timestamp, tz=timezone.utc)
    return utc_datetime


def median_datetime(datetimes: list[datetime]) -> datetime:
    timestamps = [time.timestamp() for time in datetimes]
    median_timestamp = median(timestamps)
    utc_datetime = datetime.fromtimestamp(median_timestamp, tz=timezone.utc)
    return utc_datetime


def calc_distance_ratio(
    time: datetime, period_start: datetime, period_end: datetime
) -> float:
    duration = period_end - period_start
    return (time - period_start) / duration


def calc_inverse_distance_ratio(
    time: datetime, period_start: datetime, period_end: datetime
) -> float:
    return 1 - calc_distance_ratio(time, period_start, period_end)
