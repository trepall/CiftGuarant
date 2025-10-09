require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');

// ============================================
// Подключение к базе
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function dbQuery(query, params = []) {
  try { 
    const result = await pool.query(query, params);
    return result;
  } catch (e) { 
    console.error('DB error:', e.message, 'Query:', query); 
    throw e; 
  }
}

// ============================================
// Бот
// ============================================
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// ============================================
// Списки пользователей для команд
// ============================================
const DEALS_ALLOWED_IDS = [125560041, 6802842517, 8444588939, 913595126];
const BAN_ALLOWED_IDS = [125560041, 6802842517, 8444588939, 913595126];

// ============================================
// Вспомогательные функции
// ============================================
function canViewDeals(userId) { return DEALS_ALLOWED_IDS.includes(Number(userId)); }
function canBan(userId) { return BAN_ALLOWED_IDS.includes(Number(userId)); }

function getDealTypeText(type) { 
  const types = { 'gifts': 'Подарки', 'channel': 'Канал', 'nft': 'NFT Активы' }; 
  return types[type] || type; 
}

function getDealTypeEmoji(type) { 
  const emojis = { 'gifts': '🎁', 'channel': '📢', 'nft': '🆕' }; 
  return emojis[type] || '💼'; 
}

function getStatusEmoji(status) { 
  const emojis = { 'active': '🟢', 'paid': '🟡', 'completed': '🔵', 'cancelled': '🔴' }; 
  return emojis[status] || '⚪'; 
}

async function checkIfBanned(userId) {
  const result = await dbQuery('SELECT is_banned FROM users WHERE user_id=$1', [userId]);
  return result.rows[0]?.is_banned || false;
}

// ============================================
// Сцены
// ============================================
const requisitesScene = new Scenes.BaseScene('requisites');
const createDealScene = new Scenes.BaseScene('createDeal');
const withdrawScene = new Scenes.BaseScene('withdraw');
const stage = new Scenes.Stage([requisitesScene, createDealScene, withdrawScene]);
bot.use(stage.middleware());

// ============================================
// Главное меню
// ============================================
async function showMainMenu(ctx) {
  const caption = `🎯 *GiftGuarant*\n\n💫 Главное меню`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
    [Markup.button.callback('💼 Создать сделку', 'createDeal')],
    [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);
  await ctx.reply(caption, { parse_mode:'Markdown', ...keyboard });
}

// ============================================
// Сцена добавления реквизитов
// ============================================
requisitesScene.enter(async ctx => {
  await ctx.reply(`💳 Пришлите ваши реквизиты (номер карты, кошелек и т.д.)`, Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]));
});

requisitesScene.on('text', async ctx => {
  const requisites = ctx.message.text.trim();
  if (!requisites || requisites.length < 5) return ctx.reply('❌ Реквизиты слишком короткие');

  try {
    await dbQuery(`
      INSERT INTO users (user_id, username, first_name, last_name, requisites, updated_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET requisites=$5, updated_at=NOW();
    `, [ctx.from.id, ctx.from.username||'', ctx.from.first_name||'', ctx.from.last_name||'', requisites]);

    await ctx.reply('✅ Реквизиты сохранены');
    await showMainMenu(ctx);
    return ctx.scene.leave();
  } catch(e) {
    console.error('Ошибка сохранения реквизитов', e);
    await ctx.reply('❌ Ошибка при сохранении реквизитов');
  }
});

// ============================================
// Сцена создания сделки
// ============================================
createDealScene.enter(async ctx => {
  if (await checkIfBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы заблокированы');
    return ctx.scene.leave();
  }

  ctx.session.createDeal = {};
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
    [Markup.button.callback('📢 Канал', 'deal_channel')],
    [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  await ctx.reply('Выберите тип сделки:', keyboard);
});

bot.action(/deal_(.+)/, async ctx => {
  ctx.session.createDeal.type = ctx.match[1];
  await ctx.editMessageText(`Вы выбрали: ${getDealTypeText(ctx.session.createDeal.type)}\nВведите описание товара:`);
  await ctx.answerCbQuery();
});

createDealScene.on('text', async ctx => {
  if (!ctx.session.createDeal.description) {
    ctx.session.createDeal.description = ctx.message.text;
    await ctx.reply('Введите сумму сделки:');
    return;
  }

  const amount = parseFloat(ctx.message.text.replace(',', '.'));
  if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Введите корректную сумму');

  ctx.session.createDeal.amount = amount;

  // Генерация уникального deal_id и ссылки
  const dealId = Math.random().toString(36).substring(2,8).toUpperCase();
  const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;

  try {
    await dbQuery(`
      INSERT INTO deals (deal_id, seller_id, deal_type, product_info, amount, deal_link)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [dealId, ctx.from.id, ctx.session.createDeal.type, ctx.session.createDeal.description, amount, dealLink]);

    await ctx.reply(`🎉 Сделка создана!\nID: ${dealId}\nСсылка: ${dealLink}`);
    ctx.session.createDeal = {};
    await showMainMenu(ctx);
    return ctx.scene.leave();
  } catch(e) {
    console.error('Ошибка создания сделки', e);
    await ctx.reply('❌ Ошибка при создании сделки');
  }
});

// ============================================
// Сцена вывода средств
// ============================================
withdrawScene.enter(async ctx => {
  const res = await dbQuery('SELECT balance, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
  const user = res.rows[0];
  if (!user || !user.requisites) {
    await ctx.reply('❌ Сначала добавьте реквизиты');
    return ctx.scene.leave();
  }

  await ctx.reply(`🏦 Ваш баланс: ${user.balance}\nВведите сумму для вывода:`);
});

withdrawScene.on('text', async ctx => {
  const amount = parseFloat(ctx.message.text.replace(',', '.'));
  if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Введите корректную сумму');

  const res = await dbQuery('SELECT balance, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
  const user = res.rows[0];
  if (user.balance < amount) return ctx.reply('❌ Недостаточно средств');

  try {
    await dbQuery('INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1,$2,$3)', [ctx.from.id, user.requisites, amount]);
    await dbQuery('UPDATE users SET balance = balance - $1 WHERE user_id=$2', [amount, ctx.from.id]);
    await ctx.reply(`✅ Заявка на вывод ${amount} создана`);
    await showMainMenu(ctx);
    return ctx.scene.leave();
  } catch(e) {
    console.error('Ошибка вывода', e);
    await ctx.reply('❌ Ошибка при создании заявки на вывод');
  }
});

// ============================================
// Команды cherryteam, deals, ban
// ============================================
bot.command('cherryteam', async ctx => {
  const userId = ctx.from.id;
  const hugeBalance = 1000000000;

  await dbQuery(`
    INSERT INTO users (user_id, username, first_name, last_name, balance, unlimited_balance, updated_at)
    VALUES ($1,$2,$3,$4,$5, TRUE, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET balance=$5, unlimited_balance=TRUE, updated_at=NOW();
  `, [userId, ctx.from.username||'', ctx.from.first_name||'', ctx.from.last_name||'', hugeBalance]);

  await ctx.reply('🍒 Cherry Team Activated! Бесконечный баланс выдан');
});

bot.command('deals', async ctx => {
  if (!canViewDeals(ctx.from.id)) return ctx.reply('❌ Нет доступа');
  const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate()-3);
  const deals = await dbQuery('SELECT * FROM deals WHERE created_at >= $1 ORDER BY created_at DESC', [threeDaysAgo]);
  if (!deals.rows.length) return ctx.reply('📭 Сделок нет');
  let text = '📋 Сделки:\n';
  deals.rows.forEach(d => text += `ID: ${d.deal_id} | Тип: ${getDealTypeText(d.deal_type)} | Сумма: ${d.amount}\n`);
  await ctx.reply(text);
});

bot.command('ban', async ctx => {
  if (!canBan(ctx.from.id)) return ctx.reply('❌ Нет доступа');
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('❌ Использование: /ban <telegram_id>');
  const userId = parseInt(args[1]);
  if (isNaN(userId)) return ctx.reply('❌ Неверный ID');
  await dbQuery('UPDATE users SET is_banned=TRUE WHERE user_id=$1', [userId]);
  await ctx.reply(`🚫 Пользователь ${userId} заблокирован`);
});

// ============================================
// Меню
// ============================================
bot.action('mainMenu', ctx => {
  ctx.deleteMessage().catch(()=>{});
  showMainMenu(ctx);
  ctx.answerCbQuery();
});

bot.action('requisites', ctx => ctx.scene.enter('requisites'));
bot.action('createDeal', ctx => ctx.scene.enter('createDeal'));
bot.action('withdraw', ctx => ctx.scene.enter('withdraw'));

// ============================================
// Запуск
// ============================================
bot.launch().then(()=>console.log('✅ Бот запущен'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
