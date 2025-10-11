const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

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
  MAIN_MENU: 'https://i.ibb.co/6SMsH2d/main.jpg',
  MY_DEALS: 'https://i.ibb.co/DHHpbKP/deals.jpg',
  SETTINGS: 'https://i.ibb.co/6SMsH2d/main.jpg'
};

// ==================== ХРАНИЛИЩА ====================
const userStates = new Map();

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

// ==================== БАЛАНС ====================
async function showBalanceMenu(ctx) {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
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

// ==================== ВЫВОД СРЕДСТВ ====================
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
      `📤 <b>Вывод средств</b>\n\n💳 <b>Доступно:</b> ${formatBalance(balance)}₽\n\nВведите номер карты и сумму:\n\n<code>Карта: 2200 1234 5678 9012\nСумма: 10000</code>`,
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
      `SELECT * FROM deals WHERE seller_id = $1 OR buyer_id = $1 ORDER BY created_at DESC LIMIT 10`,
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

// ==================== КОМАНДЫ ====================
bot.start(async (ctx) => {
  try {
    await db('INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING', 
      [ctx.from.id, ctx.from.username]);
    await showMainMenu(ctx);
  } catch (error) {
    console.error('❌ Ошибка /start:', error);
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

// ==================== ЗАПУСК ====================
async function startBot() {
  try {
    // Инициализация БД
    await db(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY, 
        username VARCHAR(255),
        balance DECIMAL(12,2) DEFAULT 0.00,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await db(`
      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY, 
        deal_id VARCHAR(20) UNIQUE,
        seller_id BIGINT, 
        buyer_id BIGINT, 
        amount DECIMAL(12,2),
        status VARCHAR(20) DEFAULT 'active',
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
