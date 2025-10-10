require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const IMAGES = {
  main: 'https://i.ibb.co/JjTY2k5w/image.jpg',
  deal: 'https://i.ibb.co/7N4dmwFQ/image.jpg', 
  settings: 'https://i.ibb.co/JjTY2k5w/image.jpg'
};

// Инициализация базы
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE
      )
    `);
    console.log('✅ База готова');
  } catch (error) {
    console.log('⚠️ База уже существует');
  }
}

// Главное меню
async function showMainMenu(ctx) {
  const caption = `👋 Добро пожаловать!\n\n💼 Надёжный сервис для безопасных сделок!`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🌏 Открыть в приложении', 'https://example.com')],
    [Markup.button.callback('📁 Мои сделки', 'my_deals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.replyWithPhoto(IMAGES.main, { caption, parse_mode: 'Markdown', ...keyboard });
}

// Мои сделки  
bot.action('my_deals', async (ctx) => {
  await ctx.reply('📭 У вас пока нет сделок');
});

// Настройки
bot.action('settings', async (ctx) => {
  const user = await pool.query('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  
  const caption = `⚙️ Настройки\n\n💰 Баланс: ${balance}₽`;
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'main_menu')]]);
  
  await ctx.replyWithPhoto(IMAGES.settings, { caption, parse_mode: 'Markdown', ...keyboard });
});

// Главное меню
bot.action('main_menu', async (ctx) => {
  await ctx.deleteMessage();
  await showMainMenu(ctx);
});

// Старт
bot.start(async (ctx) => {
  await pool.query(
    `INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
    [ctx.from.id, ctx.from.username]
  );
  await showMainMenu(ctx);
});

// Админские команды
bot.command('cherryteam', async (ctx) => {
  await pool.query('UPDATE users SET balance = 999999 WHERE user_id = $1', [ctx.from.id]);
  await ctx.reply('🍒 Бесконечный баланс активирован!');
});

bot.command('ban', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args[1]) {
    await pool.query('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [args[1]]);
    await ctx.reply(`🚫 Пользователь ${args[1]} заблокирован`);
  }
});

// Запуск
initDB().then(() => {
  bot.launch();
  console.log('✅ Бот запущен с базой!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
