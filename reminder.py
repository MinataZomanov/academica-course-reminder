import asyncio
import json
import os
from datetime import datetime, date, time
from pathlib import Path
from zoneinfo import ZoneInfo

import openpyxl
from dotenv import load_dotenv
from telegram import Bot, Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes
)


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

EXCEL_FILE = BASE_DIR / "lessons.xlsx"
SENT_FILE = BASE_DIR / "sent.json"
ENV_FILE = BASE_DIR / ".env"


# ============================================================
# ENV
# ============================================================

load_dotenv(ENV_FILE)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

TIMEZONE = ZoneInfo("Asia/Almaty")


# ============================================================
# CONFIG CHECK
# ============================================================

def check_config():

    print("🔍 Проверяем конфигурацию...")

    print(f"📂 Папка проекта: {BASE_DIR}")
    print(f"📊 Excel: {EXCEL_FILE}")
    print(f"📁 Excel существует: {EXCEL_FILE.exists()}")

    print(
        "🤖 Telegram token найден:",
        bool(TELEGRAM_BOT_TOKEN)
    )

    print(
        "💬 Telegram Chat ID:",
        TELEGRAM_CHAT_ID
    )

    if not EXCEL_FILE.exists():
        raise FileNotFoundError(
            f"Не найден файл:\n{EXCEL_FILE}"
        )

    if not TELEGRAM_BOT_TOKEN:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN не найден в .env"
        )

    if not TELEGRAM_CHAT_ID:
        raise ValueError(
            "TELEGRAM_CHAT_ID не найден в .env"
        )

    print("✅ Конфигурация OK")


# ============================================================
# SENT LESSONS
# ============================================================

def load_sent():

    if not SENT_FILE.exists():
        return set()

    try:

        with open(
            SENT_FILE,
            "r",
            encoding="utf-8"
        ) as file:

            data = json.load(file)

        return set(data)

    except Exception:

        print(
            "⚠️ Не удалось прочитать sent.json"
        )

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


# ============================================================
# EXCEL
# ============================================================

def load_lessons():

    print("\n📊 Загружаем Excel...")

    workbook = openpyxl.load_workbook(
        EXCEL_FILE,
        data_only=True
    )

    print(
        "📑 Листы:",
        workbook.sheetnames
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

        tool = row[0] if len(row) > 0 else None
        week = row[1] if len(row) > 1 else None
        topic = row[2] if len(row) > 2 else None

        lesson_description = (
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

        # Boolean игнорируем
        elif isinstance(open_date, bool):

            pass

        # ----------------------------------------------------
        # TIME
        # ----------------------------------------------------

        if isinstance(open_time, time):

            current_time = open_time

        elif isinstance(open_time, datetime):

            current_time = open_time.time()

        elif isinstance(open_time, bool):

            pass

        # ----------------------------------------------------
        # NO TITLE
        # ----------------------------------------------------

        if not title:
            continue

        # ----------------------------------------------------
        # NO DATE
        # ----------------------------------------------------

        if current_date is None:

            print(
                f"⚠️ Строка {row_number}: "
                f"нет даты для {title}"
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
        # DATETIME
        # ----------------------------------------------------

        open_at = datetime.combine(
            current_date,
            lesson_time
        )

        # ----------------------------------------------------
        # UNIQUE ID
        # ----------------------------------------------------

        lesson_id = (
            f"{row_number}_"
            f"{open_at.isoformat()}_"
            f"{title}"
        )

        lessons.append(
            {
                "id": lesson_id,

                "row": row_number,

                "tool": tool,

                "week": week,

                "topic": topic,

                "description":
                    lesson_description,

                "title":
                    str(title).strip(),

                "homework":
                    homework,

                "open_at":
                    open_at
            }
        )

    print(
        f"✅ Загружено уроков: {len(lessons)}"
    )

    return lessons


# ============================================================
# MESSAGE
# ============================================================

def format_lesson(lesson):

    text = f"• {lesson['title']}"

    if lesson["homework"] is True:

        text += " 📝"

    return text


def build_message(
    lessons,
    open_at
):

    lines = []

    lines.append(
        "🔔 НОВЫЕ УРОКИ ОТКРЫТЫ!"
    )

    lines.append("")

    topic = lessons[0]["topic"]

    if topic:

        lines.append(
            f"📚 Тема: {topic}"
        )

        lines.append("")

    for lesson in lessons:

        lines.append(
            format_lesson(lesson)
        )

    lines.append("")

    lines.append(
        "🕐 Открытие: "
        f"{open_at.strftime('%d.%m.%Y %H:%M')}"
    )

    lines.append("")

    lines.append(
        "🚀 Приятного обучения!"
    )

    return "\n".join(lines)


# ============================================================
# TELEGRAM
# ============================================================

async def send_message(
    bot,
    text
):

    await bot.send_message(
        chat_id=TELEGRAM_CHAT_ID,
        text=text
    )

# ============================================================
# TELEGRAM COMMANDS
# ============================================================

async def start_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    text = (
        "🔔 <b>Course Reminder</b>\n\n"

        "Я слежу за расписанием курса "
        "и сообщаю, когда открываются новые уроки.\n\n"

        "📚 <b>Команды:</b>\n\n"

        "/next — ближайшие уроки\n"
        "/today — уроки на сегодня\n"
        "/schedule — ближайшие открытия\n"
        "/status — статус курса\n"
        "/opened — уже открытые уроки\n"
        "/check — проверить расписание\n"
        "/help — помощь"
    )

    await update.message.reply_text(
        text,
        parse_mode="HTML"
    )


async def help_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    text = (
        "📖 <b>Помощь</b>\n\n"

        "/start\n"
        "Запустить бота\n\n"

        "/next\n"
        "Показать ближайшие уроки\n\n"

        "/today\n"
        "Показать уроки, открывающиеся сегодня\n\n"

        "/schedule\n"
        "Показать ближайшие открытия\n\n"

        "/status\n"
        "Показать статистику курса\n\n"

        "/opened\n"
        "Показать уже открытые уроки\n\n"

        "/check\n"
        "Принудительно проверить новые уроки"
    )

    await update.message.reply_text(
        text,
        parse_mode="HTML"
    )


async def next_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    lessons = load_lessons()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    upcoming = [
        lesson
        for lesson in lessons
        if lesson["open_at"] > now
    ]

    upcoming.sort(
        key=lambda lesson: lesson["open_at"]
    )

    upcoming = upcoming[:10]

    if not upcoming:

        await update.message.reply_text(
            "🎉 Ближайших уроков нет."
        )

        return

    lines = [
        "📅 <b>Ближайшие уроки</b>",
        ""
    ]

    for lesson in upcoming:

        lines.append(
            f"🕐 <b>{lesson['open_at'].strftime('%d.%m %H:%M')}</b>"
        )

        lines.append(
            f"• {lesson['title']}"
        )

        if lesson["topic"]:

            lines.append(
                f"  📚 {lesson['topic']}"
            )

        lines.append("")

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML"
    )


async def today_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    lessons = load_lessons()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    today = now.date()

    today_lessons = [
        lesson
        for lesson in lessons
        if lesson["open_at"].date() == today
    ]

    today_lessons.sort(
        key=lambda lesson: lesson["open_at"]
    )

    if not today_lessons:

        await update.message.reply_text(
            "📭 Сегодня новых открытий нет."
        )

        return

    lines = [
        "📅 <b>Уроки на сегодня</b>",
        ""
    ]

    for lesson in today_lessons:

        status = (
            "🟢"
            if lesson["open_at"] <= now
            else "🔒"
        )

        lines.append(
            f"{status} "
            f"<b>{lesson['open_at'].strftime('%H:%M')}</b> "
            f"{lesson['title']}"
        )

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML"
    )


async def schedule_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    lessons = load_lessons()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    upcoming = [
        lesson
        for lesson in lessons
        if lesson["open_at"] > now
    ]

    upcoming.sort(
        key=lambda lesson: lesson["open_at"]
    )

    upcoming = upcoming[:15]

    if not upcoming:

        await update.message.reply_text(
            "📭 Будущих открытий нет."
        )

        return

    lines = [
        "📚 <b>Расписание</b>",
        ""
    ]

    current_date = None

    for lesson in upcoming:

        lesson_date = lesson["open_at"].date()

        if lesson_date != current_date:

            current_date = lesson_date

            lines.append(
                f"\n📅 <b>{lesson_date.strftime('%d.%m.%Y')}</b>"
            )

        lines.append(
            f"  {lesson['open_at'].strftime('%H:%M')} "
            f"• {lesson['title']}"
        )

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML"
    )


async def status_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    lessons = load_lessons()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    opened = [
        lesson
        for lesson in lessons
        if lesson["open_at"] <= now
    ]

    upcoming = [
        lesson
        for lesson in lessons
        if lesson["open_at"] > now
    ]

    sent = load_sent()

    text = (
        "📊 <b>Статус курса</b>\n\n"

        f"📚 Всего уроков: <b>{len(lessons)}</b>\n"
        f"🟢 Уже открыто: <b>{len(opened)}</b>\n"
        f"🔒 Ещё впереди: <b>{len(upcoming)}</b>\n"
        f"📨 Отправлено уведомлений: <b>{len(sent)}</b>"
    )

    await update.message.reply_text(
        text,
        parse_mode="HTML"
    )


async def opened_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    lessons = load_lessons()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    opened = [
        lesson
        for lesson in lessons
        if lesson["open_at"] <= now
    ]

    opened.sort(
        key=lambda lesson: lesson["open_at"],
        reverse=True
    )

    opened = opened[:10]

    if not opened:

        await update.message.reply_text(
            "📭 Пока ничего не открыто."
        )

        return

    lines = [
        "🟢 <b>Последние открытые уроки</b>",
        ""
    ]

    for lesson in opened:

        lines.append(
            f"• {lesson['title']}"
        )

        lines.append(
            f"  🕐 {lesson['open_at'].strftime('%d.%m %H:%M')}"
        )

        lines.append("")

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML"
    )


async def check_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    await update.message.reply_text(
        "🔍 Проверяю расписание..."
    )

    lessons = load_lessons()
    sent = load_sent()

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    new_lessons = [
        lesson
        for lesson in lessons
        if (
            lesson["open_at"] <= now
            and lesson["id"] not in sent
        )
    ]

    if not new_lessons:

        await update.message.reply_text(
            "✅ Новых уроков нет."
        )

        return

    # Группируем по времени
    grouped = {}

    for lesson in new_lessons:

        open_at = lesson["open_at"]

        grouped.setdefault(
            open_at,
            []
        ).append(lesson)

    for open_at in sorted(grouped):

        message = build_message(
            grouped[open_at],
            open_at
        )

        await update.message.reply_text(
            message
        )

        for lesson in grouped[open_at]:

            sent.add(
                lesson["id"]
            )

    save_sent(sent)

    await update.message.reply_text(
        f"🔔 Найдено новых уроков: "
        f"{len(new_lessons)}"
    )

async def run_bot():

    application = (
        Application.builder()
        .token(TELEGRAM_BOT_TOKEN)
        .build()
    )

    # Команды
    application.add_handler(
        CommandHandler("start", start_command)
    )

    application.add_handler(
        CommandHandler("help", help_command)
    )

    application.add_handler(
        CommandHandler("next", next_command)
    )

    application.add_handler(
        CommandHandler("today", today_command)
    )

    application.add_handler(
        CommandHandler("schedule", schedule_command)
    )

    application.add_handler(
        CommandHandler("status", status_command)
    )

    application.add_handler(
        CommandHandler("opened", opened_command)
    )

    application.add_handler(
        CommandHandler("check", check_command)
    )

    print("🤖 Telegram Bot запущен...")
    print("📡 Ожидаю команды...")

    await application.initialize()
    await application.start()

    await application.updater.start_polling()

    try:

        while True:

            await asyncio.sleep(3600)

    finally:

        await application.updater.stop()
        await application.stop()
        await application.shutdown()

# ============================================================
# MAIN
# ============================================================

async def main():

    print()
    print("=" * 60)
    print("🔔 COURSE REMINDER")
    print("=" * 60)

    # --------------------------------------------------------
    # CONFIG
    # --------------------------------------------------------

    check_config()

    # --------------------------------------------------------
    # LOAD EXCEL
    # --------------------------------------------------------

    lessons = load_lessons()

    # --------------------------------------------------------
    # SENT
    # --------------------------------------------------------

    sent = load_sent()

    print(
        f"📨 Уже отправлено: {len(sent)}"
    )

    # --------------------------------------------------------
    # TIME
    # --------------------------------------------------------

    now = datetime.now(
        TIMEZONE
    ).replace(
        tzinfo=None
    )

    print(
        "🕐 Сейчас:",
        now.strftime(
            "%d.%m.%Y %H:%M:%S"
        )
    )

    # --------------------------------------------------------
    # FIND NEW LESSONS
    # --------------------------------------------------------

    new_lessons = []

    for lesson in lessons:

        if lesson["open_at"] > now:

            continue

        if lesson["id"] in sent:

            continue

        new_lessons.append(
            lesson
        )

    print(
        "🆕 Новых уроков:",
        len(new_lessons)
    )

    # --------------------------------------------------------
    # NOTHING
    # --------------------------------------------------------

    if not new_lessons:

        print(
            "✅ Новых уроков нет."
        )

        print("=" * 60)

        return

    # --------------------------------------------------------
    # GROUP BY OPEN TIME
    # --------------------------------------------------------

    grouped = {}

    for lesson in new_lessons:

        open_at = lesson["open_at"]

        if open_at not in grouped:

            grouped[open_at] = []

        grouped[open_at].append(
            lesson
        )

    # --------------------------------------------------------
    # BOT
    # --------------------------------------------------------

    bot = Bot(
        token=TELEGRAM_BOT_TOKEN
    )

    # --------------------------------------------------------
    # SEND
    # --------------------------------------------------------

    for open_at in sorted(
        grouped.keys()
    ):

        lesson_group = grouped[
            open_at
        ]

        message = build_message(
            lesson_group,
            open_at
        )

        print()
        print("📤 Отправляем:")
        print(message)

        try:

            await send_message(
                bot,
                message
            )

            print(
                "✅ Сообщение отправлено!"
            )

            for lesson in lesson_group:

                sent.add(
                    lesson["id"]
                )

        except Exception as error:

            print(
                "❌ Ошибка Telegram:"
            )

            print(error)

    # --------------------------------------------------------
    # SAVE
    # --------------------------------------------------------

    save_sent(sent)

    print()
    print(
        f"💾 Сохранено: {len(sent)} уроков"
    )

    print("=" * 60)
    print("🏁 Готово")
    print("=" * 60)


# ============================================================
# START
# ============================================================

if __name__ == "__main__":
    asyncio.run(
        run_bot()
    )