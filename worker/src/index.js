const TIMEZONE = "Asia/Almaty";

const GITHUB_OWNER = "MinataZomanov";
const GITHUB_REPO = "academica-course-reminder";
const GITHUB_FILE = "schedule.json";
const GITHUB_BRANCH = "main";


function getAlmatyDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}


function formatDate(dateString) {
  const date = new Date(dateString);

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}


function formatTime(dateString) {
  const date = new Date(dateString);

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}


function isOpened(lesson) {
  return new Date(lesson.open_at).getTime() <= Date.now();
}


function lessonText(lesson, includeStatus = true) {
  const status = isOpened(lesson) ? "🟢" : "🔒";

  let text = "";

  if (includeStatus) {
    text += `${status} `;
  }

  text += `📚 ${lesson.title}\n`;

  if (lesson.topic) {
    text += `📌 Тема: ${lesson.topic}\n`;
  }

  if (lesson.tool) {
    text += `🛠 Инструмент: ${lesson.tool}\n`;
  }

  text += `📅 ${formatDate(lesson.open_at)}\n`;
  text += `⏰ ${formatTime(lesson.open_at)}`;

  if (lesson.homework) {
    text += `\n📝 Есть домашнее задание`;
  }

  return text;
}


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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram error: ${body}`);
  }

  return response.json();
}


async function loadSchedule(env) {
  const url =
    `https://api.github.com/repos/` +
    `${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}` +
    `?ref=${GITHUB_BRANCH}`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "academica-course-reminder"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub error ${response.status}: ${body}`);
  }

  const data = await response.json();

  const binary = atob(data.content.replace(/\n/g, ""));

  const bytes = Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

  const text = new TextDecoder("utf-8").decode(bytes);

  return JSON.parse(text);
}


async function getSent(env) {
  const value = await env.SENT_KV.get("sent_lessons");

  if (!value) {
    return new Set();
  }

  try {
    return new Set(JSON.parse(value));
  } catch {
    return new Set();
  }
}


async function saveSent(env, sent) {
  await env.SENT_KV.put(
    "sent_lessons",
    JSON.stringify([...sent])
  );
}


function sortByOpenTime(a, b) {
  return new Date(a.open_at) - new Date(b.open_at);
}


/*
 * Проверяет открывшиеся уроки и отправляет их в канал.
 * Возвращает количество новых отправленных уроков.
 */
async function checkAndSendOpened(env) {
  const lessons = await loadSchedule(env);
  const sent = await getSent(env);

  const available = lessons
    .filter(lesson => isOpened(lesson) && !sent.has(lesson.id))
    .sort(sortByOpenTime);

  if (available.length === 0) {
    return 0;
  }

  let count = 0;

  for (const lesson of available) {
    const text =
      "🔔 Новый урок открыт!\n\n" +
      lessonText(lesson, false);

    await sendTelegram(
      env,
      env.TELEGRAM_CHAT_ID,
      text
    );

    sent.add(lesson.id);
    count++;
  }

  await saveSent(env, sent);

  return count;
}


async function commandStart(env, chatId) {
  const text =
    "👋 Привет!\n\n" +
    "Я Academica Course Bot.\n\n" +
    "Я умею показывать расписание курса и автоматически сообщать об открытии новых уроков.\n\n" +
    "Используй /help, чтобы увидеть команды.";

  await sendTelegram(env, chatId, text);
}


async function commandHelp(env, chatId) {
  const text =
    "🤖 Команды Academica Course Bot\n\n" +
    "/next - ближайшие 10 уроков\n" +
    "/today - уроки на сегодня\n" +
    "/schedule - ближайшее расписание\n" +
    "/status - состояние курса\n" +
    "/opened - последние открывшиеся уроки\n" +
    "/check - проверить новые открывшиеся уроки\n" +
    "/help - список команд";

  await sendTelegram(env, chatId, text);
}


async function commandNext(env, chatId, lessons) {
  const upcoming = lessons
    .filter(lesson => !isOpened(lesson))
    .sort(sortByOpenTime)
    .slice(0, 10);

  if (upcoming.length === 0) {
    await sendTelegram(
      env,
      chatId,
      "🎉 Ближайших закрытых уроков нет."
    );

    return;
  }

  let text = "📚 Ближайшие уроки:\n\n";

  for (const lesson of upcoming) {
    text += lessonText(lesson);
    text += "\n\n";
  }

  await sendTelegram(env, chatId, text.trim());
}


async function commandToday(env, chatId, lessons) {
  const today = getAlmatyDate();

  const todayLessons = lessons
    .filter(
      lesson =>
        getAlmatyDate(new Date(lesson.open_at)) === today
    )
    .sort(sortByOpenTime);

  if (todayLessons.length === 0) {
    await sendTelegram(
      env,
      chatId,
      "📅 На сегодня уроков нет."
    );

    return;
  }

  let text = `📅 Уроки на сегодня (${today}):\n\n`;

  for (const lesson of todayLessons) {
    text += lessonText(lesson);
    text += "\n\n";
  }

  await sendTelegram(env, chatId, text.trim());
}


async function commandSchedule(env, chatId, lessons) {
  const upcoming = lessons
    .filter(lesson => !isOpened(lesson))
    .sort(sortByOpenTime)
    .slice(0, 15);

  if (upcoming.length === 0) {
    await sendTelegram(
      env,
      chatId,
      "📚 Все доступные уроки уже открылись."
    );

    return;
  }

  let text = "🗓 Ближайшее расписание:\n\n";

  let currentDate = null;

  for (const lesson of upcoming) {
    const date = getAlmatyDate(
      new Date(lesson.open_at)
    );

    if (date !== currentDate) {
      currentDate = date;
      text += `📅 ${formatDate(lesson.open_at)}\n\n`;
    }

    text +=
      `⏰ ${formatTime(lesson.open_at)} | ${lesson.title}\n`;
  }

  await sendTelegram(env, chatId, text.trim());
}


async function commandStatus(env, chatId, lessons) {
  const sent = await getSent(env);

  const opened = lessons.filter(isOpened).length;
  const upcoming = lessons.length - opened;

  const text =
    "📊 Статус курса\n\n" +
    `📚 Всего уроков: ${lessons.length}\n` +
    `🟢 Открыто: ${opened}\n` +
    `🔒 Предстоит: ${upcoming}\n` +
    `📨 Отправлено уведомлений: ${sent.size}`;

  await sendTelegram(env, chatId, text);
}


async function commandOpened(env, chatId, lessons) {
  const opened = lessons
    .filter(isOpened)
    .sort(
      (a, b) =>
        new Date(b.open_at) - new Date(a.open_at)
    )
    .slice(0, 10);

  if (opened.length === 0) {
    await sendTelegram(
      env,
      chatId,
      "🔒 Пока ни один урок не открылся."
    );

    return;
  }

  let text = "🟢 Последние открывшиеся уроки:\n\n";

  for (const lesson of opened) {
    text += lessonText(lesson, false);
    text += "\n\n";
  }

  await sendTelegram(env, chatId, text.trim());
}


async function commandCheck(env, chatId) {
  const count = await checkAndSendOpened(env);

  if (count === 0) {
    await sendTelegram(
      env,
      chatId,
      "✅ Новых открывшихся уроков нет."
    );

    return;
  }

  await sendTelegram(
    env,
    chatId,
    `✅ Проверка завершена.\nОтправлено новых уроков: ${count}`
  );
}


async function handleCommand(env, chatId, command, lessons) {
  switch (command) {
    case "/start":
      await commandStart(env, chatId);
      break;

    case "/help":
      await commandHelp(env, chatId);
      break;

    case "/next":
      await commandNext(env, chatId, lessons);
      break;

    case "/today":
      await commandToday(env, chatId, lessons);
      break;

    case "/schedule":
      await commandSchedule(env, chatId, lessons);
      break;

    case "/status":
      await commandStatus(env, chatId, lessons);
      break;

    case "/opened":
      await commandOpened(env, chatId, lessons);
      break;

    case "/check":
      await commandCheck(env, chatId);
      break;

    default:
      await sendTelegram(
        env,
        chatId,
        "❓ Неизвестная команда.\n\nИспользуй /help."
      );
  }
}


export default {

  /*
   * Telegram webhook
   */
  async fetch(request, env) {

    if (request.method !== "POST") {
      return new Response(
        "Academica Course Bot is alive! 🤖"
      );
    }

    try {
      const update = await request.json();

      const message = update.message;

      if (!message || !message.text) {
        return new Response("OK");
      }

      const chatId = message.chat.id;

      const command = message.text
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();

      const lessons = await loadSchedule(env);

      await handleCommand(
        env,
        chatId,
        command,
        lessons
      );

      return new Response("OK");

    } catch (error) {

      console.error(error);

      return new Response(
        "Webhook error",
        {
          status: 500
        }
      );
    }
  },


  /*
   * Автоматическая проверка по Cron Trigger
   */
  async scheduled(controller, env, ctx) {

    try {

      const count = await checkAndSendOpened(env);

      console.log(
        `Cron ${controller.cron}: sent ${count} lessons`
      );

    } catch (error) {

      console.error(
        "Scheduled check failed:",
        error
      );

      throw error;
    }
  }
};
