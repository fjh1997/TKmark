#!/usr/bin/env python3
"""Export attendance leave and absence details without hard-coded credentials.

Set ATTEND_ACCESS_TOKEN to the token from the current browser session. If the
attendance system also requires cookies in your environment, set ATTEND_COOKIE.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any

import requests


BASE_URL = os.environ.get("ATTEND_BASE_URL", "https://newca.zjtongji.edu.cn/attendng")
ACCESS_TOKEN = os.environ.get("ATTEND_ACCESS_TOKEN", "")
COOKIE = os.environ.get("ATTEND_COOKIE", "")


def require_env() -> None:
    if not ACCESS_TOKEN:
        print("ATTEND_ACCESS_TOKEN is required.", file=sys.stderr)
        sys.exit(2)


def headers() -> dict[str, str]:
    result = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
        "access-token": ACCESS_TOKEN,
    }
    if COOKIE:
        result["Cookie"] = COOKIE
    return result


def get_json(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = dict(params or {})
    params.setdefault("_t", str(int(time.time() * 1000)))
    response = requests.get(f"{BASE_URL}/{path.lstrip('/')}", params=params, headers=headers(), timeout=30)
    response.raise_for_status()
    data = response.json()
    if not data.get("success"):
        raise RuntimeError(data.get("message") or data)
    return data


def list_teacher_records(course_name: str, class_name: str) -> list[dict[str, Any]]:
    data = get_json(
        "attend/m/teaRecord/list",
        {
            "page": "1",
            "rows": "200",
            "sort": "c_day",
            "order": "desc",
            "dateEnd": "",
            "dateStart": "",
            "courseId": "",
            "className": "",
        },
    )
    records = data.get("result", {}).get("records", [])
    return [
        record
        for record in records
        if record.get("className") == class_name and record.get("courseName") == course_name
    ]


def print_absence_details(course_name: str, class_name: str) -> None:
    print("日期,姓名,原因")
    for record in list_teacher_records(course_name, class_name):
        detail = get_json(f"attend/m/teaRecord/getById/{record['id']}")
        schedule_id = detail.get("result", {}).get("scheduleId")
        if not schedule_id:
            continue
        students = get_json(
            "attend/m/stuRecord/getStuRecordsByStatus",
            {"scheduleId": schedule_id, "stuName": "", "lateStatus": ""},
        ).get("result", {})
        for student in students.get("2", []):
            print(f"{record.get('cday','')},{student.get('stuName','')},{student.get('leaveReason','请假')}")
        for student in students.get("1", []):
            print(f"{record.get('cday','')},{student.get('stuName','')},缺勤")


def main() -> None:
    require_env()
    course_name = os.environ.get("ATTEND_COURSE_NAME", "")
    class_name = os.environ.get("ATTEND_CLASS_NAME", "")
    if not course_name or not class_name:
        print("ATTEND_COURSE_NAME and ATTEND_CLASS_NAME are required.", file=sys.stderr)
        sys.exit(2)
    print_absence_details(course_name, class_name)


if __name__ == "__main__":
    main()
