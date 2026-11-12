
const GITHUB_OWNER = "MinataZomanov";
const GITHUB_REPO = "academica-course-reminder";
const GITHUB_BRANCH = "main";
const SCHEDULE_PATH = "schedule.json";

const TIMEZONE = "Asia/Almaty";
const REMINDER_MINUTES = 15;
const OPENED_GRACE_MINUTES = 20;
const REMINDER_TTL = 60 * 60 * 24 * 365 * 2;

const TEST_GROUP_ID = "-1004367799048";

// ============================================================
// DATE AND TIME
// ============================================================

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

const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

function formatTime(value) {
  return timeFormatter.format(new Date(value));
}

function getLocalDate() {
  const parts = localDateFormatter.formatToParts(new Date());
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

// ============================================================
// LESSON GROUPING
// ============================================================

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

function groupByOpenTime(lessons) {
  const groups = new Map();

  for (const lesson of lessons) {
    const timestamp = String(getLessonTime(lesson));

    if (!groups.has(timestamp)) {
      groups.set(timestamp, []);
    }

    groups.get(timestamp).push(lesson);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([timestamp, items]) => ({
      timestamp: Number(timestamp),
      lessons: items.sort((a, b) =>
        a.title.localeCompare(b.title, "ru")
      )
    }));
}

function lessonLabel(lesson) {
  return (
    `📚 ${lesson.title}\n` +
    `📅 ${formatDate(lesson.open_at)}\n` +
    `⏰ ${formatTime(lesson.open_at)}` +
    (lesson.homework ? "\n📝 Есть домашнее задание" : "")
  );
}

function buildGroupedNotification(
  lessons,
  type,
  minutesLeft = null
) {
  const first = lessons[0];

  const lessonList = lessons
    .map(lesson =>
      `• ${lesson.title}${lesson.homework ? " 📝" : ""}`
    )
    .join("\n");

  if (type === "reminder15") {
    return (
      `⏳ ДО ОТКРЫТИЯ УРОКОВ ОСТАЛОСЬ ${minutesLeft} МИН.!\n\n` +
      `${lessonList}\n\n` +
      `🕒 Открытие: ${formatDate(first.open_at)} ${formatTime(first.open_at)}\n\n` +
      "🚀 Подготовьтесь к обучению!"
    );
  }

  return (
    "🔔 НОВЫЕ УРОКИ ОТКРЫТЫ!\n\n" +
    `${lessonList}\n\n` +
    `🕒 Открытие: ${formatDate(first.open_at)} ${formatTime(first.open_at)}\n\n` +
    "🚀 Приятного обучения!"
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

    console.error("GITHUB_API_ERROR", JSON.stringify({
      status: response.status,
      details: details.slice(0, 1000)
    }));

    throw new Error(`GitHub API error: ${response.status}`);
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

  const validLessons = lessons.filter(lesson =>
    lesson &&
    lesson.id &&
    lesson.title &&
    lesson.open_at &&
    Number.isFinite(getLessonTime(lesson))
  );

  console.log("SCHEDULE_LOADED", JSON.stringify({
    total: lessons.length,
    valid: validLessons.length
  }));

  return validLessons;
}

// ============================================================
// TELEGRAM API
// ============================================================

async function sendTelegram(env, chatId, message) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    }
  );

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Telegram returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok || !result.ok) {
    console.error("TELEGRAM_API_ERROR", JSON.stringify({
      chat_id: chatId,
      http_status: response.status,
      error_code: result.error_code ?? null,
      description: result.description ?? "Unknown Telegram error"
    }));

    throw new Error(
      `Telegram error ${result.error_code ?? response.status}: ` +
      `${result.description ?? "Unknown error"}`
    );
  }

  console.log("TELEGRAM_MESSAGE_SENT", JSON.stringify({
    chat_id: chatId,
    message_id: result.result?.message_id ?? null
  }));

  return result;
}

// ============================================================
// NOTIFICATION RECIPIENTS
// ============================================================

function getNotificationChatIds(env) {
  const configured = env.TELEGRAM_CHAT_IDS?.trim();

  const ids = configured
    ? configured.split(",")
    : [env.TELEGRAM_CHAT_ID];

  return [...new Set(
    ids
      .map(id => String(id ?? "").trim())
      .filter(Boolean)
  )];
}

// Отправка во все чаты.
// Ошибка одного получателя не скрывает ошибки остальных.
async function sendTelegramToAll(env, message) {
  const chatIds = getNotificationChatIds(env);

  if (chatIds.length === 0) {
    throw new Error("No Telegram recipients configured");
  }

  const results = await Promise.allSettled(
    chatIds.map(chatId =>
      sendTelegram(env, chatId, message)
    )
  );

  const failures = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push({
        chat_id: chatIds[index],
        error: result.reason?.message ?? "Unknown error"
      });
    }
  });

  if (failures.length > 0) {
    console.error("TELEGRAM_DELIVERY_PARTIAL_FAILURE",
      JSON.stringify({
        successful: results.length - failures.length,
        failed: failures
      })
    );

    throw new Error(
      `Telegram delivery failed for ${failures.length} recipient(s)`
    );
  }

  console.log("TELEGRAM_DELIVERY_COMPLETE", JSON.stringify({
    recipients: chatIds.length
  }));

  return chatIds.length;
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
  return (
    await env.SENT_KV.get(
      await getNotificationKey(type, lessonId)
    )
  ) === "1";
}

async function markSent(env, type, lessonId) {
  await env.SENT_KV.put(
    await getNotificationKey(type, lessonId),
    "1",
    { expirationTtl: REMINDER_TTL }
  );
}

// ============================================================
// NOTIFICATION PROCESSING
// ============================================================

async function checkAndSendReminders(env) {
  const lessons = await loadSchedule(env);

  const now = Date.now();
  const windowMs = REMINDER_MINUTES * 60 * 1000;

  const upcoming = [];

  for (const lesson of lessons) {
    const difference = getLessonTime(lesson) - now;

    if (difference <= 0 || difference > windowMs) {
      continue;
    }

    if (await wasSent(env, "reminder15", lesson.id)) {
      continue;
    }

    upcoming.push(lesson);
  }

  const groups = groupByOpenTime(upcoming);
  let sentMessages = 0;

  for (const group of groups) {
    const minutesLeft = Math.max(
      1,
      Math.ceil((group.timestamp - Date.now()) / 60000)
    );

    const message = buildGroupedNotification(
      group.lessons,
      "reminder15",
      minutesLeft
    );

    // Сначала доставляем во все чаты.
    // При ошибке KV не помечается, чтобы была повторная попытка.
    await sendTelegramToAll(env, message);

    for (const lesson of group.lessons) {
      await markSent(env, "reminder15", lesson.id);
    }

    sentMessages++;
  }

  return sentMessages;
}

async function checkAndSendOpened(env) {
  const lessons = await loadSchedule(env);

  const now = Date.now();
  const graceMs = OPENED_GRACE_MINUTES * 60 * 1000;

  const available = [];

  for (const lesson of lessons) {
    const difference = now - getLessonTime(lesson);

    if (difference < 0 || difference > graceMs) {
      continue;
    }

    if (await wasSent(env, "opened", lesson.id)) {
      continue;
    }

    available.push(lesson);
  }

  const groups = groupByOpenTime(available);
  let sentMessages = 0;

  for (const group of groups) {
    const message = buildGroupedNotification(
      group.lessons,
      "opened"
    );

    await sendTelegramToAll(env, message);

    for (const lesson of group.lessons) {
      await markSent(env, "opened", lesson.id);
    }

    sentMessages++;
  }

  return sentMessages;
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
      "/check - Проверить открывшиеся уроки\n" +
      "/testgroup - Проверить доставку в группу"
    );
  }

  // Проверка группы не требует загрузки расписания.
  if (command === "/testgroup") {
    await sendTelegram(
      env,
      TEST_GROUP_ID,
      "🧪 ТЕСТОВОЕ СООБЩЕНИЕ\n\n" +
      "Academica Course Bot успешно отправил сообщение в группу!\n\n" +
      "📚 Проверка подключения завершена."
    );

    return sendTelegram(
      env,
      chatId,
      "✅ Telegram принял тестовое сообщение для группы."
    );
  }

  const lessons = await loadSchedule(env);
  const now = Date.now();

  // /next
  if (command === "/next") {
    const upcoming = lessons
      .filter(lesson => getLessonTime(lesson) > now)
      .sort(sortByOpenTime)
      .slice(0, 10);

    if (!upcoming.length) {
      return sendTelegram(env, chatId, "Ближайших уроков нет.");
    }

    return sendTelegram(
      env,
      chatId,
      "📚 Ближайшие 10 уроков:\n\n" +
      upcoming.map(lessonLabel).join("\n\n")
    );
  }

  // /today
  if (command === "/today") {
    const today = getLocalDate();

    const todayLessons = lessons
      .filter(lesson =>
        localDateFormatter.format(new Date(lesson.open_at)) === today
      )
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

  // /schedule
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

  // /status
  if (command === "/status") {
    const opened = lessons.filter(isOpened).length;
    const upcoming = lessons.length - opened;

    return sendTelegram(
      env,
      chatId,
      "📊 Состояние расписания\n\n" +
      `📚 Всего уроков: ${lessons.length}\n` +
      `🟢 Открыто: ${opened}\n` +
      `🔒 Ожидается: ${upcoming}\n` +
      `🕒 Часовой пояс: ${TIMEZONE}`
    );
  }

  // /opened
  if (command === "/opened") {
    const opened = lessons
      .filter(isOpened)
      .sort(sortByOpenTime)
      .slice(-10)
      .reverse();

    if (!opened.length) {
      return sendTelegram(env, chatId, "Открытых уроков пока нет.");
    }

    return sendTelegram(
      env,
      chatId,
      "🟢 Последние открытые уроки:\n\n" +
      opened.map(lessonLabel).join("\n\n")
    );
  }

  // /check
  if (command === "/check") {
    const count = await checkAndSendOpened(env);

    return sendTelegram(
      env,
      chatId,
      count > 0
        ? `✅ Отправлено сводных уведомлений: ${count}`
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

  if (message?.chat) {
    console.log("TELEGRAM_CHAT_INFO", JSON.stringify({
      chat_id: message.chat.id,
      title: message.chat.title ?? null,
      type: message.chat.type
    }));
  }

  if (!message?.text) {
    return new Response("OK");
  }

  const text = message.text.trim();

  if (!text.startsWith("/")) {
    return new Response("OK");
  }

  try {
    await handleCommand(env, message.chat.id, text);
  } catch (error) {
    console.error("COMMAND_ERROR", JSON.stringify({
      command: text.split(/\s+/)[0],
      chat_id: message.chat.id,
      error: error?.message ?? String(error)
    }));

    // Не создаём вторую необработанную ошибку,
    // если Telegram не принимает даже сообщение об ошибке.
    try {
      await sendTelegram(
        env,
        message.chat.id,
        "⚠️ Не удалось выполнить команду. Подробности сохранены в логах."
      );
    } catch (replyError) {
      console.error("COMMAND_ERROR_REPLY_FAILED", JSON.stringify({
        chat_id: message.chat.id,
        error: replyError?.message ?? String(replyError)
      }));
    }
  }

  return new Response("OK");
}

// ============================================================
// CLOUDFLARE WORKER
// ============================================================

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") {
      return new Response("Academica Course Bot is alive! 🤖");
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }

    try {
      return await handleWebhook(request, env);
    } catch (error) {
      console.error("WEBHOOK_ERROR", JSON.stringify({
        error: error?.message ?? String(error)
      }));

      return new Response("OK");
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      const reminders = await checkAndSendReminders(env);
      const opened = await checkAndSendOpened(env);

      console.log("CRON_COMPLETED", JSON.stringify({
        cron: controller.cron,
        reminders,
        opened
      }));
    } catch (error) {
      console.error("SCHEDULED_CHECK_FAILED", JSON.stringify({
        cron: controller.cron,
        error: error?.message ?? String(error)
      }));

      throw error;
    }
  }
};
