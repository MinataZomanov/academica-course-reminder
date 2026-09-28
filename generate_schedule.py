import json
from datetime import datetime, date, time
from pathlib import Path
from zoneinfo import ZoneInfo

import openpyxl


# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

EXCEL_FILE = BASE_DIR / "lessons.xlsx"
OUTPUT_FILE = BASE_DIR / "schedule.json"

TIMEZONE = ZoneInfo("Asia/Almaty")


# ============================================================
# LOAD LESSONS
# ============================================================

def load_lessons():

    workbook = openpyxl.load_workbook(
        EXCEL_FILE,
        data_only=True
    )

    if "Расписание" not in workbook.sheetnames:
        raise ValueError(
            "В Excel нет листа 'Расписание'"
        )

    sheet = workbook["Расписание"]

    lessons = []

    current_date = None
    current_time = None

    for row_number, row in enumerate(
        sheet.iter_rows(
            min_row=2,
            values_only=True
        ),
        start=2
    ):

        # ----------------------------------------------------
        # COLUMNS
        # ----------------------------------------------------

        tool = (
            row[0]
            if len(row) > 0
            else None
        )

        week = (
            row[1]
            if len(row) > 1
            else None
        )

        topic = (
            row[2]
            if len(row) > 2
            else None
        )

        description = (
            row[3]
            if len(row) > 3
            else None
        )

        title = (
            row[4]
            if len(row) > 4
            else None
        )

        homework = (
            row[5]
            if len(row) > 5
            else None
        )

        open_date = (
            row[6]
            if len(row) > 6
            else None
        )

        open_time = (
            row[7]
            if len(row) > 7
            else None
        )


        # ----------------------------------------------------
        # DATE
        # ----------------------------------------------------

        if isinstance(open_date, datetime):

            current_date = open_date.date()

        elif isinstance(open_date, date):

            current_date = open_date

        elif isinstance(open_date, bool):

            # Excel иногда возвращает boolean
            # в ячейках с датой
            pass


        # ----------------------------------------------------
        # TIME
        # ----------------------------------------------------

        if isinstance(open_time, time):

            current_time = open_time

        elif isinstance(open_time, datetime):

            current_time = open_time.time()

        elif isinstance(open_time, bool):

            # Excel иногда возвращает boolean
            # в ячейках со временем
            pass


        # ----------------------------------------------------
        # SKIP EMPTY TITLES
        # ----------------------------------------------------

        if not title:
            continue


        # ----------------------------------------------------
        # SKIP LESSON WITHOUT DATE
        # ----------------------------------------------------

        if current_date is None:

            print(
                f"⚠️ Строка {row_number}: "
                f"нет даты для '{title}'"
            )

            continue


        # ----------------------------------------------------
        # TIME
        # ----------------------------------------------------

        if current_time is None:

            lesson_time = time(
                hour=0,
                minute=0
            )

        else:

            lesson_time = current_time


        # ----------------------------------------------------
        # DATETIME WITH ALMATY TIMEZONE
        # ----------------------------------------------------

        open_at = datetime.combine(
            current_date,
            lesson_time,
            tzinfo=TIMEZONE
        )


        # ----------------------------------------------------
        # UNIQUE ID
        # ----------------------------------------------------

        lesson_id = (
            f"{row_number}_"
            f"{open_at.isoformat()}_"
            f"{str(title).strip()}"
        )


        # ----------------------------------------------------
        # LESSON
        # ----------------------------------------------------

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


# ============================================================
# SAVE SCHEDULE
# ============================================================

def main():

    print("📚 Загружаем расписание...")

    lessons = load_lessons()

    print(
        f"✅ Загружено уроков: {len(lessons)}"
    )

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

    print(
        f"💾 Расписание сохранено: "
        f"{OUTPUT_FILE}"
    )

    print()

    # --------------------------------------------------------
    # PREVIEW
    # --------------------------------------------------------

    print("🔎 Первые 10 уроков:")

    for lesson in lessons[:10]:

        print(
            f"  {lesson['open_at']} | "
            f"{lesson['title']}"
        )


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    main()
