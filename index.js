require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');

// Подключение к базе
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Бот
const bot = new Telegraf(process.env.BOT_TOKEN);

// Админ
const ADMIN_IDS = [123456789];
function isAdmin(userId) { return ADMIN_IDS.includes(userId); }

// SQL
async function dbQuery(query, params = []) {
  try { return await pool.query(query, params); }
  catch (e) { console.error('DB error:', e.message); throw e; }
}

// Инициализация таблиц
async function initDB() {
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
      currency VARCHAR(20),
      amount DECIMAL(15,2),
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
  console.log('✅ Таблицы созданы');
}

// Сцены
const requisitesScene = new Scenes.BaseScene('requisites');
const createDealScene = new Scenes.BaseScene('createDeal');
const withdrawScene = new Scenes.BaseScene('withdraw');
const stage = new Scenes.Stage([requisitesScene, createDealScene, withdrawScene]);
bot.use(session());
bot.use(stage.middleware());

// Фото
const IMAGES = {
  main: 'https://i.ibb.co/XkCzqRyz/main.png',
  deals: 'https://i.ibb.co/rGgjz61s/deals.png',
  createDeal: 'https://i.ibb.co/n2ysqQ9/create.png',
  requisites: 'https://i.ibb.co/0yvxs921/requisites.png'
};

// Умная отправка/редактирование сообщения
async function sendOrEdit(ctx, image, caption, buttons) {
  if (ctx.session.lastMessageId) {
    try {
      await ctx.telegram.editMessageMedia(ctx.chat.id, ctx.session.lastMessageId, undefined, { type: 'photo', media: image, caption, parse_mode: 'Markdown' });
      await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.session.lastMessageId, undefined, buttons.reply_markup);
      return;
    } catch {}
  }
  const msg = await ctx.replyWithPhoto(image, { caption, parse_mode: 'Markdown', ...buttons });
  ctx.session.lastMessageId = msg.message_id;
}

// Главное меню
async function showMainMenu(ctx) {
  const caption = `🎯 *GiftGuarant*\n🛡️ Надёжный сервис для безопасных сделок\n✨ Преимущества:\n✅ Без комиссии\n✅ Поддержка 24/7\n✅ Полная безопасность\n✅ Мгновенные сделки\n💫 Ваши сделки под защитой! 🛡️`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
    [Markup.button.callback('💼 Создать сделку', 'createDeal')],
    [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);
  await sendOrEdit(ctx, IMAGES.main, caption, buttons);
}

// Реквизиты
requisitesScene.enter(async (ctx) => {
  const caption = `💳 *Добавление реквизитов*\n📝 Пришлите реквизиты:\n• Карта\n• Телефон\n• Крипто`;
  const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'mainMenu')]]);
  await sendOrEdit(ctx, IMAGES.requisites, caption, buttons);
});
requisitesScene.on('text', async (ctx) => {
  if (ctx.message.text === '⏪ Назад') { await showMainMenu(ctx); return ctx.scene.leave(); }
  try {
    await dbQuery(`INSERT INTO users (user_id, requisites, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT(user_id) DO UPDATE SET requisites=$2, updated_at=NOW()`, [ctx.from.id, ctx.message.text]);
    await ctx.reply('✅ Реквизиты сохранены!');
    return ctx.scene.leave();
  } catch { await ctx.reply('❌ Ошибка сохранения реквизитов'); }
});

// Создание сделки
createDealScene.enter(async (ctx) => {
  const caption = `🛍️ *Создание сделки*\nВыберите тип товара:`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
    [Markup.button.callback('📢 Канал', 'deal_channel')],
    [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
});

// Выбор типа сделки
bot.action(/deal_(.+)/, async (ctx) => {
  ctx.session.dealType = ctx.match[1];
  const caption = `Вы выбрали: *${getDealTypeText(ctx.session.dealType)}*\nВведите описание товара:`;
  const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'createDeal')]]);
  await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
  ctx.scene.enter('createDeal');
});

// Ввод описания, валюты, суммы
createDealScene.on('text', async (ctx) => {
  if (!ctx.session.productInfo) {
    ctx.session.productInfo = ctx.message.text;
    const caption = `💵 Выберите валюту:`;
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback('💎 TON', 'currency_TON'), Markup.button.callback('💵 USDT', 'currency_USDT')],
      [Markup.button.callback('⭐️ STARS', 'currency_STARS'), Markup.button.callback('🇷🇺 RUB', 'currency_RUB')],
      [Markup.button.callback('⏪ Назад', 'createDeal')]
    ]);
    await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
    return;
  }
  if (ctx.session.waitAmount) {
    const amount = parseFloat(ctx.message.text.replace(',', '.'));
    if (isNaN(amount)) { await ctx.reply('❌ Введите корректную сумму'); return; }
    ctx.session.amount = amount;

    const dealId = Math.random().toString(36).substring(2,8).toUpperCase();
    const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
    await dbQuery(`INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [dealId, ctx.from.id, ctx.session.dealType, ctx.session.productInfo, ctx.session.currency, ctx.session.amount, dealLink]);

    const caption = `🎉 Сделка создана!\nID: ${dealId}\nТип: ${getDealTypeText(ctx.session.dealType)}\nСумма: ${ctx.session.amount} ${ctx.session.currency}\nСсылка: ${dealLink}`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'mainMenu')]]);
    await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);

    delete ctx.session.productInfo; delete ctx.session.currency; delete ctx.session.amount; delete ctx.session.waitAmount;
    return ctx.scene.leave();
  }
});

// Выбор валюты
bot.action(/currency_(.+)/, async (ctx) => {
  ctx.session.currency = ctx.match[1];
  ctx.session.waitAmount = true;
  const caption = `Введите сумму сделки в ${ctx.session.currency}:`;
  const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'createDeal')]]);
  await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
});

// Мои сделки
bot.action('myDeals', async (ctx) => {
  try {
    const result = await dbQuery('SELECT * FROM deals WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 10', [ctx.from.id]);
    if (!result.rows.length) {
      const caption = `📭 *У вас пока нет сделок*\nСоздайте первую!`;
      const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'mainMenu')]]);
      return await sendOrEdit(ctx, IMAGES.deals, caption, buttons);
    }
    for (const deal of result.rows) {
      const caption = `📋 *Сделка #${deal.deal_id}*\n🎯 Тип: ${getDealTypeEmoji(deal.deal_type)} ${getDealTypeText(deal.deal_type)}\n💰 Сумма: ${deal.amount || 0} ${deal.currency || ''}\n📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n🕐 Создана: ${new Date(deal.created_at).toLocaleDateString('ru-RU')}`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('📱 Открыть сделку', deal.deal_link)],
        [Markup.button.callback('⏪ Назад', 'mainMenu')]
      ]);
      await sendOrEdit(ctx, IMAGES.deals, caption, buttons);
    }
  } catch (e) { await ctx.reply('❌ Ошибка загрузки сделок'); }
});

// Настройки
bot.action('settings', async (ctx) => {
  const userRes = await dbQuery('SELECT balance, successful_deals, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
  const user = userRes.rows[0] || { balance: 0, successful_deals:0, requisites:'не указаны' };
  const caption = `⚙️ *Настройки*\nБаланс: ${user.balance}₽\nУспешных сделок: ${user.successful_deals}\nРеквизиты: ${user.requisites? 'указаны':'не указаны'}`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Пополнить баланс', 'deposit')],
    [Markup.button.callback('🏦 Вывести средства', 'withdraw')],
    [Markup.button.callback('✏️ Изменить реквизиты', 'requisites')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  await sendOrEdit(ctx, IMAGES.main, caption, buttons);
});
bot.action('withdraw', async (ctx) => ctx.scene.enter('withdraw'));

// /start
bot.start(async (ctx) => {
  try {
    await dbQuery(`INSERT INTO users (user_id, username, first_name, last_name) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`, [ctx.from.id, ctx.from.username || '', ctx.from.first_name || '', ctx.from.last_name || '']);
    await showMainMenu(ctx);
  } catch (error) {
    console.error('Ошибка при /start:', error.message);
    await ctx.reply('❌ Произошла ошибка при регистрации. Попробуйте позже.');
  }
});

// Вспомогательные функции
function getDealTypeText(type) { const types = { 'gifts':'Подарки','channel':'Канал','nft':'NFT Активы' }; return types[type]||type; }
function getDealTypeEmoji(type) { const emojis = { 'gifts':'🎁','channel':'📢','nft':'🆕' }; return emojis[type]||'💼'; }
function getStatusEmoji(status) { const emojis = { 'active':'🟢','paid':'🟡','completed':'🔵','cancelled':'🔴' }; return emojis[status]||'⚪'; }

// Запуск
initDB().then(() => {
  bot.launch();
  console.log('✅ Бот запущен');
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
