
const GITHUB_OWNER = "MinataZomanov";
const GITHUB_REPO = "academica-course-reminder";
const GITHUB_BRANCH = "main";
const SCHEDULE_PATH = "schedule.json";

const TIMEZONE = "Asia/Almaty";
const REMINDER_MINUTES = 15;

// Не отправляем исторические уроки при первом запуске.
// Допускаем задержку Cron до 20 минут.
const OPENED_GRACE_MINUTES = 20;

const REMINDER_TTL = 60 * 60 * 24 * 365 * 2;

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

function formatTime(value) {
  return timeFormatter.format(new Date(value));
}

function getLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function getLessonTime(lesson) {
  return new Date(lesson.open_at).getTime();
}

function sortByOpenTime(a, b) {
  return getLessonTime(a) - getLessonTime(b);
}

function isOpened(lesson) {
  return getLessonTime(lesson) <= Date.now();
}

function groupByDate(lessons) {
  const groups = new Map();

  for (const lesson of lessons) {
    const date = formatDate(lesson.open_at);

    if (!groups.has(date)) {
      groups.set(date, []);
    }

    groups.get(date).push(lesson);
  }

  return groups;
}

function lessonLabel(lesson) {
  return (
    `📚 ${lesson.title}\n` +
    `📅 ${formatDate(lesson.open_at)}\n` +
    `⏰ ${formatTime(lesson.open_at)}` +
    (lesson.homework ? "\n📝 Есть домашнее задание" : "")
  );
}

// ============================================================
// GITHUB SCHEDULE
// ============================================================

async function loadSchedule(env) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is missing");
  }

  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
    `/contents/${SCHEDULE_PATH}?ref=${GITHUB_BRANCH}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Academica-Course-Reminder"
    }
  });

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `GitHub API error ${response.status}: ${details}`
    );
  }

  const file = await response.json();

  if (!file.content) {
    throw new Error("schedule.json has no content");
  }

  const binary = atob(file.content.replace(/\s/g, ""));

  const bytes = Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );

  const content = new TextDecoder().decode(bytes);
  const lessons = JSON.parse(content);

  if (!Array.isArray(lessons)) {
    throw new Error("Invalid schedule.json format");
  }

  return lessons.filter(lesson =>
    lesson.id &&
    lesson.title &&
    lesson.open_at &&
    !Number.isNaN(getLessonTime(lesson))
  );
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(env, chatId, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram error: ${JSON.stringify(result)}`
    );
  }

  return result;
}

// ============================================================
// KV DEDUPLICATION
// ============================================================

async function getNotificationKey(type, lessonId) {
  const data = new TextEncoder().encode(
    `${type}:${lessonId}`
  );

  const digest = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  const hash = Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return `notification:${hash}`;
}

async function wasSent(env, type, lessonId) {
  const key = await getNotificationKey(type, lessonId);

  return (await env.SENT_KV.get(key)) === "1";
}

async function markSent(env, type, lessonId) {
  const key = await getNotificationKey(type, lessonId);

  await env.SENT_KV.put(
    key,
    "1",
    { expirationTtl: REMINDER_TTL }
  );
}

// ============================================================
// 15-MINUTE REMINDERS
// ============================================================

async function checkAndSendReminders(env) {
  const lessons = await loadSchedule(env);

  const now = Date.now();
  const windowMs = REMINDER_MINUTES * 60 * 1000;

  let count = 0;

  const upcoming = lessons
    .filter(lesson => {
      const openAt = getLessonTime(lesson);
      const difference = openAt - now;

      return (
        difference > 0 &&
        difference <= windowMs
      );
    })
    .sort(sortByOpenTime);

  for (const lesson of upcoming) {
    if (
      await wasSent(env, "reminder15", lesson.id)
    ) {
      continue;
    }

    const minutesLeft = Math.ceil(
      (getLessonTime(lesson) - Date.now()) / 60000
    );

    const message =
      `⏳ До открытия курса осталось ${minutesLeft} мин.!\n\n` +
      `📚 ${lesson.title}\n` +
      `📅 ${formatDate(lesson.open_at)}\n` +
      `⏰ ${formatTime(lesson.open_at)}\n\n` +
      `Готовьтесь к занятию! 🚀`;

    await sendTelegram(
      env,
      env.TELEGRAM_CHAT_ID,
      message
    );

    await markSent(
      env,
      "reminder15",
      lesson.id
    );

    count++;
  }

  return count;
}

// ============================================================
// OPENED LESSON NOTIFICATIONS
// ============================================================

async function checkAndSendOpened(env) {
  const lessons = await loadSchedule(env);

  const now = Date.now();
  const graceMs = OPENED_GRACE_MINUTES * 60 * 1000;

  let count = 0;

  const opened = lessons
    .filter(lesson => {
      const difference = now - getLessonTime(lesson);

      return (
        difference >= 0 &&
        difference <= graceMs
      );
    })
    .sort(sortByOpenTime);

  for (const lesson of opened) {
    if (
      await wasSent(env, "opened", lesson.id)
    ) {
      continue;
    }

    const message =
      `🔔 Новый урок открыт!\n\n` +
      lessonLabel(lesson) +
      `\n\n🚀 Приятного обучения!`;

    await sendTelegram(
      env,
      env.TELEGRAM_CHAT_ID,
      message
    );

    await markSent(
      env,
      "opened",
      lesson.id
    );

    count++;
  }

  return count;
}

// ============================================================
// TELEGRAM COMMANDS
// ============================================================

async function handleCommand(env, chatId, text) {
  const command = text
    .trim()
    .split(/\s+/)[0]
    .split("@")[0]
    .toLowerCase();

  if (command === "/start") {
    return sendTelegram(
      env,
      chatId,
      "👋 Привет! Academica Course Bot работает.\n\n" +
      "Используй /help, чтобы посмотреть команды."
    );
  }

  if (command === "/help") {
    return sendTelegram(
      env,
      chatId,
      "🤖 Academica Course Bot\n\n" +
      "/start - Запуск бота\n" +
      "/help - Список команд\n" +
      "/next - Ближайшие 10 уроков\n" +
      "/today - Уроки на сегодня\n" +
      "/schedule - Ближайшее расписание\n" +
      "/status - Состояние расписания\n" +
      "/opened - Последние открытые уроки\n" +
      "/check - Проверить открывшиеся уроки"
    );
  }

  const lessons = await loadSchedule(env);
  const now = Date.now();

  if (command === "/next") {
    const upcoming = lessons
      .filter(lesson => getLessonTime(lesson) > now)
      .sort(sortByOpenTime)
      .slice(0, 10);

    if (!upcoming.length) {
      return sendTelegram(env, chatId, "Ближайших уроков нет.");
    }

    const message =
      "📚 Ближайшие 10 уроков:\n\n" +
      upcoming.map(lessonLabel).join("\n\n");

    return sendTelegram(env, chatId, message);
  }

  if (command === "/today") {
    const today = getLocalDate();

    const todayLessons = lessons
      .filter(lesson => {
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: TIMEZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date(lesson.open_at));

        return date === today;
      })
      .sort(sortByOpenTime);

    if (!todayLessons.length) {
      return sendTelegram(
        env,
        chatId,
        "Сегодня уроков нет. Можно выдохнуть! ☕"
      );
    }

    const message =
      "📅 Уроки на сегодня:\n\n" +
      todayLessons.map(lesson => {
        const status = isOpened(lesson) ? "🟢" : "🔒";

        return (
          `${status} ${formatTime(lesson.open_at)}\n` +
          `📚 ${lesson.title}`
        );
      }).join("\n\n");

    return sendTelegram(env, chatId, message);
  }

  if (command === "/schedule") {
    const upcoming = lessons
      .filter(lesson => getLessonTime(lesson) > now)
      .sort(sortByOpenTime)
      .slice(0, 15);

    if (!upcoming.length) {
      return sendTelegram(env, chatId, "Будущих уроков нет.");
    }

    const groups = groupByDate(upcoming);

    let message = "📚 Ближайшее расписание:\n\n";

    for (const [date, items] of groups) {
      message += `📅 ${date}\n\n`;

      for (const lesson of items) {
        message +=
          `⏰ ${formatTime(lesson.open_at)} | ${lesson.title}\n`;
      }

      message += "\n";
    }

    return sendTelegram(env, chatId, message.trim());
  }

  if (command === "/status") {
    const opened = lessons.filter(
      lesson => isOpened(lesson)
    ).length;

    const upcoming = lessons.length - opened;

    const message =
      "📊 Состояние расписания\n\n" +
      `📚 Всего уроков: ${lessons.length}\n` +
      `🟢 Открыто: ${opened}\n` +
      `🔒 Ожидается: ${upcoming}\n` +
      `🕒 Часовой пояс: ${TIMEZONE}`;

    return sendTelegram(env, chatId, message);
  }

  if (command === "/opened") {
    const opened = lessons
      .filter(lesson => isOpened(lesson))
      .sort(sortByOpenTime)
      .slice(-10)
      .reverse();

    if (!opened.length) {
      return sendTelegram(env, chatId, "Открытых уроков пока нет.");
    }

    const message =
      "🟢 Последние открытые уроки:\n\n" +
      opened.map(lessonLabel).join("\n\n");

    return sendTelegram(env, chatId, message);
  }

  if (command === "/check") {
    const count = await checkAndSendOpened(env);

    return sendTelegram(
      env,
      chatId,
      count > 0
        ? `✅ Отправлено уведомлений об открытии: ${count}`
        : "✅ Новых открывшихся уроков нет."
    );
  }

  return sendTelegram(
    env,
    chatId,
    "Неизвестная команда. Используй /help."
  );
}

// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

async function handleWebhook(request, env) {
  const update = await request.json();

  const message = update.message;

  if (!message || !message.text) {
    return new Response("OK");
  }

  const text = message.text.trim();

  if (!text.startsWith("/")) {
    return new Response("OK");
  }

  try {
    await handleCommand(
      env,
      message.chat.id,
      text
    );
  } catch (error) {
    console.error("Command error:", error);

    await sendTelegram(
      env,
      message.chat.id,
      "⚠️ Не удалось выполнить команду. Попробуй позже."
    );
  }

  return new Response("OK");
}

// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") {
      return new Response(
        "Academica Course Bot is alive! 🤖"
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }

    try {
      return await handleWebhook(request, env);
    } catch (error) {
      console.error("Webhook error:", error);

      return new Response("Webhook error", {
        status: 500
      });
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      const reminders = await checkAndSendReminders(env);
      const opened = await checkAndSendOpened(env);

      console.log(
        `Cron ${controller.cron}: ` +
        `reminders=${reminders}, opened=${opened}`
      );
    } catch (error) {
      console.error("Scheduled check failed:", error);
      throw error;
    }
  }
};
