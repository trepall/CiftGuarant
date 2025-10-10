require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MIN_WITHDRAW = 10000;

// Картинки
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
        successful_deals INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE,
        requisites TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS deals (
        deal_id TEXT PRIMARY KEY,
        seller_id BIGINT NOT NULL,
        buyer_id BIGINT,
        product_info TEXT,
        amount DECIMAL DEFAULT 1000,
        currency TEXT DEFAULT 'RUB',
        deal_link TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        seller_confirmed BOOLEAN DEFAULT FALSE,
        buyer_confirmed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        requisites TEXT NOT NULL,
        amount DECIMAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ База готова');
  } catch (e) {
    console.log('⚠️ Ошибка инициализации базы:', e.message);
  }
}

// Вспомогательная функция статусов
function getStatusText(status) {
  const statuses = {
    active: '🟢 Активна',
    waiting_payment: '🟡 Ожидает оплаты',
    paid: '🔵 Оплачена',
    completed: '✅ Завершена',
    cancelled: '🔴 Отменена'
  };
  return statuses[status] || status;
}

// Главное меню
async function showMainMenu(ctx) {
  const caption = `👋 Добро пожаловать!\n\n💼 Надёжный сервис для безопасных сделок!\n✨ Автоматизировано, быстро и без лишних хлопот!\n\n🔹 Без комиссии\n🔹 Поддержка 24/7\n\n💌 Ваши сделки под защитой 🛡`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌏 Открыть в приложении', 'app_soon')],
    [Markup.button.callback('📁 Мои сделки', 'my_deals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.replyWithPhoto(IMAGES.main, { caption, parse_mode: 'Markdown', reply_markup: keyboard });
}

// Кнопка «Мини-приложение скоро»
bot.action('app_soon', async (ctx) => {
  await ctx.answerCbQuery('🚧 Мини-приложение скоро будет готово');
});

// Мои сделки
bot.action('my_deals', async (ctx) => {
  const deals = await pool.query(
    'SELECT * FROM deals WHERE seller_id = $1 OR buyer_id = $1 ORDER BY created_at DESC',
    [ctx.from.id]
  );

  if (deals.rows.length === 0) return ctx.reply('📭 У вас пока нет сделок');

  const keyboard = Markup.inlineKeyboard([
    ...deals.rows.map(d => [Markup.button.callback(`#${d.deal_id} - ${getStatusText(d.status)}`, `deal_${d.deal_id}`)]),
    [Markup.button.callback('⏪ Назад', 'main_menu')]
  ]);

  await ctx.reply('📁 Ваши сделки:', { reply_markup: keyboard });
});

// Настройки
bot.action('settings', async (ctx) => {
  const user = await pool.query('SELECT balance, requisites FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  const requisites = user.rows[0]?.requisites;

  let caption = `⚙️ Настройки\n\n💰 Баланс: ${balance}₽\n`;
  caption += requisites ? `💳 Реквизиты: указаны\n` : `💳 Реквизиты: не указаны\n`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Баланс', 'balance_menu')],
    [Markup.button.callback('💳 Реквизиты', 'requisites_menu')],
    [Markup.button.callback('⏪ Назад', 'main_menu')]
  ]);

  await ctx.replyWithPhoto(IMAGES.settings, { caption, parse_mode: 'Markdown', reply_markup: keyboard });
});

// Реквизиты
bot.action('requisites_menu', async (ctx) => {
  const user = await pool.query('SELECT requisites FROM users WHERE user_id = $1', [ctx.from.id]);
  const requisites = user.rows[0]?.requisites;
  let caption = `💳 Ваши реквизиты\n\n${requisites || 'Реквизиты не указаны'}\n\nОтправьте новые реквизиты в формате:\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567`;
  await ctx.reply(caption);
});

// Баланс
bot.action('balance_menu', async (ctx) => {
  const user = await pool.query('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;

  const caption = `💰 Баланс: ${balance}₽\n\nВыберите действие:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📥 Пополнить', 'deposit')],
    [Markup.button.callback('📤 Вывести', 'withdraw')],
    [Markup.button.callback('⏪ Назад', 'settings')]
  ]);

  await ctx.reply(caption, { reply_markup: keyboard });
});

// Пополнение
bot.action('deposit', async (ctx) => {
  await ctx.reply('📥 Пополнение баланса\n\nОтправьте сумму на:\n📞 89202555790\n💳 Юмани\n\nПосле оплаты баланс пополнится автоматически.');
});

// Вывод
bot.action('withdraw', async (ctx) => {
  const user = await pool.query('SELECT balance, requisites FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  const requisites = user.rows[0]?.requisites;

  let caption = `📤 Вывод средств\n\n💰 Ваш баланс: ${balance}₽\n`;
  if (requisites) caption += `💳 Ваши реквизиты: ${requisites}\n\n`;
  caption += `Введите реквизиты и сумму для вывода (минимум ${MIN_WITHDRAW}₽)\n\nПример:\nКарта: 1234 5678 9012 3456\nСумма: 10000`;
  await ctx.reply(caption);
});

// Обработка текста (реквизиты или вывод)
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const text = ctx.message.text;

  // Сохраняем реквизиты
  if (text.includes('Карта:') || text.includes('Телефон:') || text.includes('Крипто:')) {
    await pool.query('UPDATE users SET requisites = $1 WHERE user_id = $2', [text, ctx.from.id]);
    await ctx.reply('✅ Реквизиты сохранены!');
    return;
  }

  // Проверяем заявку на вывод
  const amountMatch = text.match(/[Сс]умма:\s*(\d+)/);
  const amount = amountMatch ? parseInt(amountMatch[1]) : 0;

  if (amount >= MIN_WITHDRAW) {
    const user = await pool.query('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;

    if (amount <= balance) {
      await pool.query('INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1, $2, $3)', [ctx.from.id, text, amount]);
      await pool.query('UPDATE users SET balance = balance - $1 WHERE user_id = $2', [amount, ctx.from.id]);
      await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана!`);
    } else {
      await ctx.reply('❌ Недостаточно средств');
    }
  } else if (amount > 0) {
    await ctx.reply(`❌ Минимальная сумма вывода — ${MIN_WITHDRAW}₽`);
  }
});

// Назад в главное меню
bot.action('main_menu', async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  await showMainMenu(ctx);
});

// Старт
bot.start(async (ctx) => {
  await pool.query('INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT(user_id) DO NOTHING', [ctx.from.id, ctx.from.username]);
  await showMainMenu(ctx);
});

// Запуск
initDB().then(() => {
  bot.launch();
  console.log('✅ Бот запущен на Railway');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
