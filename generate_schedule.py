import json
from datetime import datetime, date, time
from pathlib import Path

import openpyxl


BASE_DIR = Path(__file__).resolve().parent

EXCEL_FILE = BASE_DIR / "lessons.xlsx"
OUTPUT_FILE = BASE_DIR / "schedule.json"


def load_lessons():
    workbook = openpyxl.load_workbook(
        EXCEL_FILE,
        data_only=True
    )

    if "Расписание" not in workbook.sheetnames:
        raise ValueError("В Excel нет листа 'Расписание'")

    sheet = workbook["Расписание"]

    lessons = []

    current_date = None
    current_time = None

    for row_number, row in enumerate(
        sheet.iter_rows(min_row=2, values_only=True),
        start=2
    ):
        tool = row[0] if len(row) > 0 else None
        week = row[1] if len(row) > 1 else None
        topic = row[2] if len(row) > 2 else None
        description = row[3] if len(row) > 3 else None
        title = row[4] if len(row) > 4 else None
        homework = row[5] if len(row) > 5 else None
        open_date = row[6] if len(row) > 6 else None
        open_time = row[7] if len(row) > 7 else None

        if isinstance(open_date, datetime):
            current_date = open_date.date()
        elif isinstance(open_date, date):
            current_date = open_date
        elif isinstance(open_date, bool):
            pass

        if isinstance(open_time, time):
            current_time = open_time
        elif isinstance(open_time, datetime):
            current_time = open_time.time()
        elif isinstance(open_time, bool):
            pass

        if not title:
            continue

        if current_date is None:
            continue

        lesson_time = current_time or time(0, 0)

        open_at = datetime.combine(
            current_date,
            lesson_time
        )

        lesson_id = (
            f"{row_number}_"
            f"{open_at.isoformat()}_"
            f"{title}"
        )

        lessons.append({
            "id": lesson_id,
            "row": row_number,
            "tool": tool,
            "week": week,
            "topic": topic,
            "description": description,
            "title": str(title).strip(),
            "homework": homework is True,
            "open_at": open_at.isoformat()
        })

    return lessons


def main():
    lessons = load_lessons()

    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            lessons,
            file,
            ensure_ascii=False,
            indent=2
        )

    print(f"Generated {len(lessons)} lessons")
    print(f"Saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
