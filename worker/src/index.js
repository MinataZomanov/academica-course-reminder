export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Academica Course Bot is alive! 🤖");
    }

    try {
      const update = await request.json();

      const message = update.message;

      if (!message || !message.text) {
        return new Response("OK");
      }

      const chatId = message.chat.id;
      const text = message.text.trim();

      let reply;

      if (text === "/start") {
        reply =
          "👋 Привет! Academica Course Bot работает.\n\n" +
          "Сейчас подключён webhook. Команды скоро появятся.";
      } else {
        reply = "🤖 Получил команду: " + text;
      }

      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: reply
          })
        }
      );

      return new Response("OK");
    } catch (error) {
      console.error(error);
      return new Response("Webhook error", { status: 500 });
    }
  }
};
