require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Всё в памяти - РАБОТАЕТ
const users = new Map();

bot.start(async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📁 Мои сделки', 'deals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.reply('👋 Бот работает!', { ...keyboard });
});

bot.action('deals', (ctx) => ctx.reply('📭 Нет сделок'));
bot.action('settings', (ctx) => ctx.reply('⚙️ Настройки'));

bot.command('cherryteam', (ctx) => ctx.reply('🍒 Баланс активирован'));
bot.command('ban', (ctx) => ctx.reply('🚫 Бан работает'));
bot.command('deals', (ctx) => ctx.reply('📊 Сделки работают'));

bot.launch();
console.log('✅ Бот запущен!');
