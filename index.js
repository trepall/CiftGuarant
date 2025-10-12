const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Веб-сервер для Railway
app.get('/', (req, res) => {
  res.send('🤖 Bot is running!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ==================== КОНФИГУРАЦИЯ ====================
const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_IDS = [125560041, 6802842517, 8444588939, 913595126];
const MIN_WITHDRAWAL = 10000;
const MAX_WITHDRAWAL = 100000;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-web-app.com';

// ==================== ХРАНИЛИЩА ====================
const userStates = new Map();

// ==================== БАЗОВЫЕ ФУНКЦИИ ====================
async function db(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    console.error('❌ DB error:', error.message);
    return { rows: [] };
  }
}

function formatBalance(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount);
}

function formatCardNumber(cardNumber) {
  return cardNumber.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 **** **** $4');
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

// ==================== ГЛАВНОЕ МЕНЮ ====================
async function showMainMenu(ctx, messageText = '👋 Добро пожаловать в GiftGuarant!') {
  try {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('🌏 Открыть приложение', WEB_APP_URL)],
      [Markup.button.callback('⚙️ Настройки', 'settings')],
      [Markup.button.callback('💰 Баланс', 'balance_menu')]
    ]);
    
    await ctx.replyWithPhoto('https://i.ibb.co/rR4HHhd3/IMG-7369.jpg', {
      caption: `${messageText}\n\n📱 Используйте кнопку ниже для открытия приложения:`,
      ...keyboard,
      parse_mode: 'HTML'
    });
  } catch (error) {
    // Если фото не загружается, отправляем текст
    await ctx.reply(`${messageText}\n\n📱 Используйте кнопку ниже для открытия приложения:`, {
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🌏 Открыть приложение', WEB_APP_URL)],
        [Markup.button.callback('⚙️ Настройки', 'settings')],
        [Markup.button.callback('💰 Баланс', 'balance_menu')]
      ]),
      parse_mode: 'HTML'
    });
  }
}

// ==================== НАСТРОЙКИ ====================
async function showSettingsMenu(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Управление балансом', 'balance_menu')],
      [Markup.button.callback('📞 Поддержка', 'support')],
      [Markup.button.callback('⏪ Назад', 'main_menu')]
    ]);

    await ctx.reply(
      `⚙️ <b>Настройки</b>\n\n` +
      `💰 <b>Баланс:</b> ${formatBalance(balance)}₽\n` +
      `👤 <b>ID:</b> <code>${ctx.from.id}</code>\n` +
      `📱 <b>Имя:</b> ${ctx.from.first_name || 'Не указано'}`,
      { ...keyboard, parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Settings error:', error);
    await showMainMenu(ctx);
  }
}

// ==================== БАЛАНС И ВЫВОД ====================
async function showBalanceMenu(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📥 Пополнить', 'deposit')],
      [Markup.button.callback('📤 Вывести', 'withdraw')],
      [Markup.button.callback('📊 История', 'history')],
      [Markup.button.callback('⏪ Назад', 'settings')]
    ]);

    await ctx.reply(
      `💰 <b>Управление балансом</b>\n\n` +
      `💳 <b>Текущий баланс:</b> ${formatBalance(balance)}₽\n` +
      `📤 <b>Мин. вывод:</b> ${formatBalance(MIN_WITHDRAWAL)}₽\n` +
      `📥 <b>Макс. вывод:</b> ${formatBalance(MAX_WITHDRAWAL)}₽`,
      { ...keyboard, parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Balance error:', error);
  }
}

bot.action('deposit', async (ctx) => {
  await ctx.reply(
    '📥 <b>Пополнение баланса</b>\n\n' +
    'Для пополнения баланса:\n' +
    '1. Переведите средства на карту:\n' +
    '   <code>2200 1234 5678 9012</code>\n' +
    '2. Отправьте скриншот перевода в поддержку\n' +
    '3. Баланс будет пополнен в течение 5 минут\n\n' +
    '📞 <b>Поддержка:</b> @support_username',
    { parse_mode: 'HTML' }
  );
});

bot.action('support', async (ctx) => {
  await ctx.reply(
    '📞 <b>Поддержка</b>\n\n' +
    'По всем вопросам обращайтесь:\n' +
    '👤 @support_username\n' +
    '📧 email@example.com\n\n' +
    '⏰ <b>Время работы:</b> 24/7',
    { parse_mode: 'HTML' }
  );
});

bot.action('history', async (ctx) => {
  try {
    const transactions = await db(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [ctx.from.id]
    );
    
    if (transactions.rows.length === 0) {
      await ctx.reply('📊 История операций пуста');
      return;
    }
    
    let historyText = '📊 <b>Последние операции:</b>\n\n';
    transactions.rows.forEach((transaction, index) => {
      const type = transaction.type === 'deposit' ? '📥 Пополнение' : '📤 Вывод';
      const date = new Date(transaction.created_at).toLocaleDateString('ru-RU');
      historyText += `${index + 1}. ${type}\n💵 ${formatBalance(transaction.amount)}₽\n📅 ${date}\n\n`;
    });
    
    await ctx.reply(historyText, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ History error:', error);
    await ctx.reply('❌ Ошибка загрузки истории');
  }
});

async function handleWithdraw(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = parseFloat(user.rows[0]?.balance) || 0;
    
    if (balance < MIN_WITHDRAWAL) {
      await ctx.reply(`❌ Недостаточно средств для вывода. Минимум: ${formatBalance(MIN_WITHDRAWAL)}₽`);
      return;
    }
    
    userStates.set(ctx.from.id, { 
      state: 'awaiting_withdrawal',
      timestamp: Date.now(),
      maxAmount: Math.min(balance, MAX_WITHDRAWAL)
    });
    
    await ctx.reply(
      `📤 <b>Вывод средств</b>\n\n` +
      `💳 <b>Доступно:</b> ${formatBalance(balance)}₽\n\n` +
      `Введите номер карты и сумму в формате:\n\n` +
      `<code>Карта: 2200 1234 5678 9012\nСумма: 10000</code>\n\n` +
      `❌ Для отмены введите /cancel`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Withdraw error:', error);
  }
}

// ==================== АДМИН КОМАНДЫ ====================
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Доступ запрещен');
    return;
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('👥 Пользователи', 'admin_users')]
  ]);

  await ctx.reply('👨‍💻 <b>Админ панель</b>', { ...keyboard, parse_mode: 'HTML' });
});

bot.command('balance', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Доступ запрещен');
    return;
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) {
    await ctx.reply('Использование: /balance user_id amount');
    return;
  }

  try {
    const userId = args[0];
    const amount = parseFloat(args[1]);
    
    await db('UPDATE users SET balance = balance + $1 WHERE user_id = $2', [amount, userId]);
    await db('INSERT INTO transactions (user_id, type, amount, details) VALUES ($1, $2, $3, $4)',
      [userId, 'deposit', amount, `Пополнение администратором`]);
    
    await ctx.reply(`✅ Баланс пользователя ${userId} пополнен на ${formatBalance(amount)}₽`);
  } catch (error) {
    console.error('❌ Admin balance error:', error);
  }
});

// ==================== ОБРАБОТКА ТЕКСТА ====================
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const message = ctx.message.text;
    const userState = userStates.get(userId);
    
    if (message === '/cancel') {
      if (userState) {
        userStates.delete(userId);
        await ctx.reply('❌ Операция отменена');
        await showMainMenu(ctx);
      }
      return;
    }
    
    if (userState?.state === 'awaiting_withdrawal') {
      await processWithdrawal(ctx, message, userState);
      return;
    }
  } catch (error) {
    console.error('❌ Text processing error:', error);
  }
});

async function processWithdrawal(ctx, message, userState) {
  const userId = ctx.from.id;
  
  try {
    const cardMatch = message.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/);
    const amountMatch = message.match(/[Сс]умма:\s*(\d+)/);
    
    if (!cardMatch || !amountMatch) {
      await ctx.reply('❌ Неверный формат. Используйте:\n<code>Карта: 2200 1234 5678 9012\nСумма: 10000</code>', { parse_mode: 'HTML' });
      return;
    }
    
    const cardNumber = cardMatch[0].replace(/[\s-]/g, '');
    const amount = parseFloat(amountMatch[1]);
    
    if (amount < MIN_WITHDRAWAL) {
      await ctx.reply(`❌ Минимальная сумма для вывода: ${formatBalance(MIN_WITHDRAWAL)}₽`);
      return;
    }
    
    if (amount > userState.maxAmount) {
      await ctx.reply(`❌ Максимальная сумма для вывода: ${formatBalance(userState.maxAmount)}₽`);
      return;
    }
    
    await db('UPDATE users SET balance = balance - $1 WHERE user_id = $2', [amount, userId]);
    await db('INSERT INTO transactions (user_id, type, amount, details) VALUES ($1, $2, $3, $4)',
      [userId, 'withdrawal', amount, `Вывод на карту: ${formatCardNumber(cardNumber)}`]);
    
    await ctx.reply(
      `✅ <b>Заявка на вывод создана!</b>\n\n` +
      `💳 <b>Карта:</b> ${formatCardNumber(cardNumber)}\n` +
      `💰 <b>Сумма:</b> ${formatBalance(amount)}₽\n\n` +
      `⏳ Ожидайте обработки в течение 24 часов\n` +
      `📞 По вопросам: @support_username`,
      { parse_mode: 'HTML' }
    );
    
    userStates.delete(userId);
  } catch (error) {
    console.error('❌ Withdrawal processing error:', error);
    await ctx.reply('❌ Ошибка при обработке вывода');
    userStates.delete(userId);
  }
}

// ==================== ОБРАБОТЧИКИ КНОПОК ====================
bot.action('main_menu', async (ctx) => {
  await ctx.deleteMessage();
  await showMainMenu(ctx);
});

bot.action('settings', async (ctx) => {
  await ctx.deleteMessage();
  await showSettingsMenu(ctx);
});

bot.action('balance_menu', async (ctx) => {
  await ctx.deleteMessage();
  await showBalanceMenu(ctx);
});

bot.action('withdraw', async (ctx) => {
  await ctx.deleteMessage();
  await handleWithdraw(ctx);
});

// ==================== СТАРТ ====================
bot.start(async (ctx) => {
  try {
    await db('INSERT INTO users (user_id, username, first_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET username = $2, first_name = $3', 
      [ctx.from.id, ctx.from.username, ctx.from.first_name]);
    
    await showMainMenu(ctx, `👋 Привет, ${ctx.from.first_name || 'друг'}! Добро пожаловать в GiftGuarant!`);
  } catch (error) {
    console.error('❌ Start error:', error);
    await ctx.reply('👋 Добро пожаловать! Используйте кнопки ниже для навигации.');
  }
});

// ==================== ЗАПУСК ====================
async function startBot() {
  try {
    // Инициализация БД
    await db(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY, 
        username VARCHAR(255),
        first_name VARCHAR(255),
        balance DECIMAL(12,2) DEFAULT 0.00, 
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY, 
        user_id BIGINT NOT NULL,
        type VARCHAR(20) NOT NULL, 
        amount DECIMAL(12,2) NOT NULL,
        details TEXT, 
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('🚀 Starting bot on Railway...');
    await bot.launch();
    console.log('✅ Bot started successfully!');
  } catch (error) {
    console.error('❌ Startup error:', error);
    setTimeout(startBot, 10000);
  }
}

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`❌ Bot error for ${ctx.updateType}:`, err);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Запуск бота
startBot();
