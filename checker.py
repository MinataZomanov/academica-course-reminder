import json
import os
from datetime import datetime, date, time
from pathlib import Path
from zoneinfo import ZoneInfo

import openpyxl
from dotenv import load_dotenv
from telegram import Bot


BASE_DIR = Path(__file__).resolve().parent

EXCEL_FILE = BASE_DIR / "lessons.xlsx"
SENT_FILE = BASE_DIR / "sent.json"

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

TIMEZONE = ZoneInfo("Asia/Almaty")


def load_sent():

    if not SENT_FILE.exists():
        return set()

    try:
        with open(
            SENT_FILE,
            "r",
            encoding="utf-8"
        ) as file:

            return set(json.load(file))

    except Exception:

        return set()


def save_sent(sent):

    with open(
        SENT_FILE,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            sorted(sent),
            file,
            ensure_ascii=False,
            indent=2
        )


def load_lessons():

    workbook = openpyxl.load_workbook(
        EXCEL_FILE,
        data_only=True
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

        lesson_time = (
            current_time
            if current_time is not None
            else time(0, 0)
        )

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
            "title": str(title).strip(),
            "topic": topic,
            "tool": tool,
            "homework": homework,
            "open_at": open_at
        })

    return lessons


def build_message(lessons, open_at):

    lines = [
        "🔔 НОВЫЕ УРОКИ ОТКРЫТЫ!",
        ""
    ]

    topic = lessons[0]["topic"]

    if topic:
        lines.append(
            f"📚 Тема: {topic}"
        )
        lines.append("")

    for lesson in lessons:

        homework = (
            " 📝"
            if lesson["homework"] is True
            else ""
        )

        lines.append(
            f"• {lesson['title']}{homework}"
        )

    lines.extend([
        "",
        (
            "🕐 Открытие: "
            f"{open_at.strftime('%d.%m.%Y %H:%M')}"
        ),
        "",
        "🚀 Приятного обучения!"
    ])

    return "\n".join(lines)


async def main():

    print("🔔 Course Reminder Checker")

    if not TELEGRAM_BOT_TOKEN:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN отсутствует"
        )

    if not TELEGRAM_CHAT_ID:
        raise ValueError(
            "TELEGRAM_CHAT_ID отсутствует"
        )

    if not EXCEL_FILE.exists():
        raise FileNotFoundError(
            f"Не найден {EXCEL_FILE}"
        )

    lessons = load_lessons()
    sent = load_sent()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    print(
        f"🕐 Алматы: "
        f"{now.strftime('%d.%m.%Y %H:%M:%S')}"
    )

    new_lessons = [
        lesson
        for lesson in lessons
        if (
            lesson["open_at"] <= now
            and lesson["id"] not in sent
        )
    ]

    print(
        f"📚 Всего уроков: {len(lessons)}"
    )

    print(
        f"🆕 Новых уроков: {len(new_lessons)}"
    )

    if not new_lessons:
        print("✅ Ничего нового")
        return

    grouped = {}

    for lesson in new_lessons:

        grouped.setdefault(
            lesson["open_at"],
            []
        ).append(lesson)

    bot = Bot(
        token=TELEGRAM_BOT_TOKEN
    )

    for open_at in sorted(grouped):

        group = grouped[open_at]

        message = build_message(
            group,
            open_at
        )

        print(
            f"📤 Отправляем {len(group)} уроков"
        )

        await bot.send_message(
            chat_id=TELEGRAM_CHAT_ID,
            text=message
        )

        for lesson in group:
            sent.add(lesson["id"])

    save_sent(sent)

    print("✅ Готово")


if __name__ == "__main__":

    import asyncio

    asyncio.run(main())