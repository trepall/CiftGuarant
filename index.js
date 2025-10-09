require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

// Подключение к базе
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// Простая сессия в памяти
const userSessions = {};

// Главное меню
async function showMainMenu(ctx) {
  const caption = `🎯 *GiftGuarant*\n🛡️ Надёжный сервис для безопасных сделок`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
    [Markup.button.callback('💼 Создать сделку', 'createDeal')],
    [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
}

// Реквизиты
bot.action('requisites', async (ctx) => {
  const caption = `💳 *Добавление реквизитов*\n\nПришлите ваши реквизиты:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);

  await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard });
  
  // Устанавливаем флаг что ждем реквизиты
  userSessions[ctx.from.id] = { waiting: 'requisites' };
});

// Создание сделки
bot.action('createDeal', async (ctx) => {
  const caption = `🛍️ *Создание сделки*\n\nВыберите тип товара:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
    [Markup.button.callback('📢 Канал', 'deal_channel')],
    [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);

  await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard });
});

// Главное меню
bot.action('mainMenu', async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  await showMainMenu(ctx);
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  
  if (session && session.waiting === 'requisites') {
    // Сохраняем реквизиты
    try {
      await pool.query(
        `INSERT INTO users (user_id, username, first_name, last_name, requisites) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id) 
         DO UPDATE SET requisites = $5`,
        [
          userId,
          ctx.from.username || '',
          ctx.from.first_name || '',
          ctx.from.last_name || '',
          ctx.message.text
        ]
      );
      
      await ctx.reply('✅ Реквизиты успешно сохранены!');
      delete userSessions[userId];
      await showMainMenu(ctx);
    } catch (error) {
      console.error('Ошибка сохранения реквизитов:', error);
      await ctx.reply('❌ Ошибка сохранения реквизитов');
    }
    return;
  }
  
  // Если нет активной сессии, показываем главное меню
  await showMainMenu(ctx);
});

// Запуск бота
bot.launch().then(() => {
  console.log('✅ Бот запущен');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
