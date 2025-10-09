require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// Админ-команды
const ADMIN_IDS = [123456789]; // Замените на ваши ID
function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// Универсальная функция запроса к базе
async function dbQuery(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    console.error('Database error:', error.message);
    throw error;
  }
}

// Создание таблиц
async function initDB() {
  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        requisites TEXT,
        balance DECIMAL(15,2) DEFAULT 0,
        successful_deals INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY,
        deal_id VARCHAR(50) UNIQUE NOT NULL,
        seller_id BIGINT NOT NULL,
        buyer_id BIGINT,
        deal_type VARCHAR(50) NOT NULL,
        product_info TEXT NOT NULL,
        currency VARCHAR(20) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        deal_link TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        requisites TEXT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Таблицы созданы успешно!');
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// Сцены
const requisitesScene = new Scenes.BaseScene('requisites');
const createDealScene = new Scenes.BaseScene('createDeal');
const withdrawScene = new Scenes.BaseScene('withdraw');

// Главные ссылки на картинки
const IMAGES = {
  main: 'https://ibb.co/XkCzqRyz',
  deals: 'https://ibb.co/rGgjz61s',
  createDeal: 'https://ibb.co/n2ysqQ9',
  requisites: 'https://ibb.co/0yvxs921'
};

// Главное меню
async function showMainMenu(ctx, edit = false) {
  const caption = `🎯 *GiftGuarant*\n\n🛡️ Надёжный сервис для безопасных сделок\n\n✨ *Преимущества:*\n✅ Без комиссии\n✅ Поддержка 24/7\n✅ Полная безопасность\n✅ Мгновенные сделки\n\n💫 Ваши сделки под защитой! 🛡️`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
    [Markup.button.callback('💼 Создать сделку', 'createDeal')],
    [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);
  if (edit && ctx.updateType === 'callback_query') {
    await ctx.editMessageMedia({
      type: 'photo',
      media: IMAGES.main,
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(() => {});
  } else {
    await ctx.replyWithPhoto(IMAGES.main, { caption, parse_mode: 'Markdown', ...keyboard });
  }
}

// Сцена реквизитов
requisitesScene.enter(async (ctx, edit = false) => {
  const caption = `💳 *Добавление реквизитов*\n\n📝 Пришлите ваши реквизиты в формате:\n• Номер карты\n• Номер телефона\n• Крипто-кошелек`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  if (edit && ctx.updateType === 'callback_query') {
    await ctx.editMessageMedia({
      type: 'photo',
      media: IMAGES.requisites,
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(() => {});
  } else {
    await ctx.replyWithPhoto(IMAGES.requisites, { caption, parse_mode: 'Markdown', ...keyboard });
  }
});

requisitesScene.on('text', async (ctx) => {
  if (ctx.message.text === '⏪ Назад') {
    await showMainMenu(ctx, true);
    return ctx.scene.leave();
  }
  try {
    await dbQuery(`
      INSERT INTO users (user_id, requisites, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET requisites = $2, updated_at = NOW()
    `, [ctx.from.id, ctx.message.text]);
    await ctx.reply('✅ Реквизиты успешно сохранены!');
    return ctx.scene.leave();
  } catch (error) {
    await ctx.reply('❌ Ошибка сохранения реквизитов');
  }
});

// Сцена создания сделки
createDealScene.enter(async (ctx, edit = false) => {
  const caption = `🛍️ *Создание сделки*\n\nВыберите тип товара:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
    [Markup.button.callback('📢 Канал', 'deal_channel')],
    [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  if (edit && ctx.updateType === 'callback_query') {
    await ctx.editMessageMedia({
      type: 'photo',
      media: IMAGES.createDeal,
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(() => {});
  } else {
    await ctx.replyWithPhoto(IMAGES.createDeal, { caption, parse_mode: 'Markdown', ...keyboard });
  }
});

// Сцена вывода средств
withdrawScene.enter(async (ctx, edit = false) => {
  const caption = `🏦 *Вывод средств*\n\n💳 Минимальная сумма: 7,000₽\nВведите сумму для вывода:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  if (edit && ctx.updateType === 'callback_query') {
    await ctx.editMessageMedia({
      type: 'photo',
      media: IMAGES.main,
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(() => {});
  } else {
    await ctx.replyWithPhoto(IMAGES.main, { caption, parse_mode: 'Markdown', ...keyboard });
  }
});

// Stage и middleware
const stage = new Scenes.Stage([requisitesScene, createDealScene, withdrawScene]);
bot.use(session());
bot.use(stage.middleware());

// Обработка inline кнопок
bot.action('mainMenu', async (ctx) => await showMainMenu(ctx, true));
bot.action('requisites', async (ctx) => ctx.scene.enter('requisites', true));
bot.action('createDeal', async (ctx) => ctx.scene.enter('createDeal', true));
bot.action('myDeals', async (ctx) => showUserDeals(ctx, true));
bot.action('settings', async (ctx) => showSettings(ctx, true));
bot.action('withdraw', async (ctx) => ctx.scene.enter('withdraw', true));

// Заглушка функции для просмотра сделок пользователя
async function showUserDeals(ctx, edit = false) {
  const caption = `📭 *Ваши сделки*\n\nПока у вас нет сделок.`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  if (edit && ctx.updateType === 'callback_query') {
    await ctx.editMessageMedia({
      type: 'photo',
      media: IMAGES.deals,
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(() => {});
  } else {
    await ctx.replyWithPhoto(IMAGES.deals, { caption, parse_mode: 'Markdown', ...keyboard });
  }
}

// Настройки
async function showSettings(ctx, edit = false) {
  const caption = `⚙️ *Настройки профиля*\n\n💳 Баланс: 0₽\n📊 Успешных сделок: 0\n💳 Реквизиты: не указаны`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Пополнить баланс', 'deposit')],
    [Markup.button.callback('🏦 Вывести средства', 'withdraw')],
    [Markup.button.callback('✏️ Изменить реквизиты', 'requisites')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  if (edit && ctx.updateType === 'callback_query') {
    await ctx.editMessageMedia({
      type: 'photo',
      media: IMAGES.main,
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(() => {});
  } else {
    await ctx.replyWithPhoto(IMAGES.main, { caption, parse_mode: 'Markdown', ...keyboard });
  }
}

// Команда /start
bot.start(async (ctx) => {
  try {
    await dbQuery(`
      INSERT INTO users (user_id, username, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO NOTHING
    `, [ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name]);
  } catch (error) {}
  await showMainMenu(ctx);
});

// Запуск бота
initDB().then(() => {
  console.log('🚀 Запускаю бота...');
  bot.launch()
    .then(() => console.log('✅ Бот успешно запущен!'))
    .catch(err => console.log('❌ Ошибка запуска бота:', err.message));
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
