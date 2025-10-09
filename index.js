require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = 'https://твой-веб-сайт.com'; // Замени на свой URL

// Админские ID
const ADMIN_IDS = [125560041, 6802842517, 8444588939, 913595126];
function isAdmin(userId) { 
    return ADMIN_IDS.includes(Number(userId)); 
}

// Хранилище
const unlimitedBalanceUsers = new Set();
const bannedUsers = new Set();
const userBalances = new Map(); // Балансы пользователей
const userRequisites = new Map(); // Реквизиты пользователей

// Инициализация базы
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id SERIAL PRIMARY KEY,
      deal_id VARCHAR(50) UNIQUE NOT NULL,
      seller_id BIGINT NOT NULL,
      buyer_id BIGINT,
      deal_type VARCHAR(50) DEFAULT 'general',
      product_info TEXT,
      currency VARCHAR(20) DEFAULT 'RUB',
      amount DECIMAL(15,2) DEFAULT 0,
      deal_link TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      seller_confirmed BOOLEAN DEFAULT FALSE,
      buyer_confirmed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      user_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      balance DECIMAL(15,2) DEFAULT 0,
      successful_deals INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ База инициализирована');
}

// Проверка бана
function checkIfBanned(userId) {
    return bannedUsers.has(userId);
}

// Главное меню с кнопками под сообщением
async function showMainMenu(ctx) {
  const caption = `👋 Добро пожаловать!\n\n💼 Надёжный сервис для безопасных сделок!\n✨ Автоматизировано, быстро и без лишних хлопот!\n\n🔹 Никакой комиссии\n🔹 Поддержка 24/7\n\n💌 Теперь ваши сделки под защитой! 🛡`;
  
  const keyboard = Markup.keyboard([
    ['🌏 Открыть в приложении', '📁 Мои сделки'],
    ['⚙️ Настройки']
  ]).resize();

  await ctx.reply(caption, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// Обработка текстовых кнопок
bot.hears('🌏 Открыть в приложении', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🚀 Открыть приложение', WEB_APP_URL)]
  ]);
  
  await ctx.reply('Нажмите кнопку ниже чтобы открыть веб-приложение:', {
    ...keyboard
  });
});

bot.hears('📁 Мои сделки', async (ctx) => {
  await showUserDeals(ctx);
});

bot.hears('⚙️ Настройки', async (ctx) => {
  await showSettingsMenu(ctx);
});

// Показ сделок пользователя
async function showUserDeals(ctx) {
  const dealsResult = await pool.query(
    'SELECT * FROM deals WHERE seller_id = $1 OR buyer_id = $1 ORDER BY created_at DESC',
    [ctx.from.id]
  );
  
  if (!dealsResult.rows.length) {
    await ctx.reply('📭 У вас пока нет сделок');
    return;
  }
  
  const keyboard = Markup.inlineKeyboard(
    dealsResult.rows.map(deal => [
      Markup.button.callback(
        `#${deal.deal_id} - ${getStatusText(deal.status)}`, 
        `deal_details_${deal.deal_id}`
      )
    ])
  );
  
  await ctx.reply('📁 *Ваши сделки:*\n\nВыберите сделку для просмотра:', {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// Детали сделки
bot.action(/deal_details_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const dealResult = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  
  if (!dealResult.rows.length) {
    await ctx.answerCbQuery('❌ Сделка не найдена');
    return;
  }
  
  const deal = dealResult.rows[0];
  const role = deal.seller_id === ctx.from.id ? '👤 Продавец' : '👥 Покупатель';
  
  const caption = `📋 *Сделка #${deal.deal_id}*\n\n` +
    `🎯 Роль: ${role}\n` +
    `💰 Сумма: ${deal.amount} ${deal.currency}\n` +
    `📝 Описание: ${deal.product_info || 'Не указано'}\n` +
    `📊 Статус: ${getStatusText(deal.status)}\n` +
    `🔗 Ссылка: ${deal.deal_link}\n` +
    `🕐 Создана: ${new Date(deal.created_at).toLocaleDateString('ru-RU')}`;
  
  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown'
  });
});

// Меню настроек
async function showSettingsMenu(ctx) {
  const balance = userBalances.get(ctx.from.id) || 0;
  
  const caption = `⚙️ *Настройки*\n\n💰 Баланс: ${balance}₽\n🌎 Язык: Русский`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Баланс', 'balance_menu')],
    [Markup.button.callback('🌎 Язык', 'language_menu')],
    [Markup.button.callback('⏪ Назад', 'main_menu_back')]
  ]);

  await ctx.reply(caption, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// Меню баланса
bot.action('balance_menu', async (ctx) => {
  const balance = userBalances.get(ctx.from.id) || 0;
  
  const caption = `💰 *Баланс: ${balance}₽*\n\nВыберите действие:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📥 Пополнить', 'deposit_balance')],
    [Markup.button.callback('📤 Вывести', 'withdraw_balance')],
    [Markup.button.callback('⏪ Назад', 'settings_back')]
  ]);

  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Пополнение баланса
bot.action('deposit_balance', async (ctx) => {
  const caption = `📥 *Пополнение баланса*\n\nЧтобы пополнить баланс, отправьте нужную сумму на:\n\n📞 89202555790\n💳 Юмани`;
  
  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown'
  });
});

// Вывод средств
bot.action('withdraw_balance', async (ctx) => {
  userRequisites[ctx.from.id] = { waiting: 'withdraw_requisites' };
  
  const caption = `📤 *Вывод средств*\n\nВведите ваши реквизиты и сумму для вывода:\n\nПример:\nКарта: 1234 5678 9012 3456\nСумма: 10000`;
  
  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown'
  });
});

// Обработка ввода реквизитов для вывода
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  
  if (userRequisites[userId] && userRequisites[userId].waiting === 'withdraw_requisites') {
    const text = ctx.message.text;
    const balance = userBalances.get(userId) || 0;
    
    // Простая проверка на сумму (скрытая)
    const amountMatch = text.match(/Сумма:\s*(\d+)/);
    const amount = amountMatch ? parseInt(amountMatch[1]) : 0;
    
    if (amount < 10000) {
      await ctx.reply('❌ Минимальная сумма вывода не достигнута');
      delete userRequisites[userId];
      return;
    }
    
    if (amount > balance) {
      await ctx.reply('❌ Недостаточно средств на балансе');
      delete userRequisites[userId];
      return;
    }
    
    // Списание средств
    userBalances.set(userId, balance - amount);
    
    await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана! Ожидайте обработки.`);
    delete userRequisites[userId];
    await showSettingsMenu(ctx);
  }
});

// Навигация назад
bot.action('main_menu_back', async (ctx) => {
  await ctx.deleteMessage();
  await showMainMenu(ctx);
});

bot.action('settings_back', async (ctx) => {
  await ctx.editMessageText('Возвращаюсь...');
  await showSettingsMenu(ctx);
});

// Создание сделки
bot.command('create', async (ctx) => {
  if (checkIfBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы заблокированы и не можете создавать сделки');
    return;
  }

  const dealId = generateDealId();
  const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
  
  await pool.query(
    `INSERT INTO deals (deal_id, seller_id, deal_link) VALUES ($1, $2, $3)`,
    [dealId, ctx.from.id, dealLink]
  );

  // Сообщение продавцу после создания сделки
  const caption = `💥 Сделка успешно создана!\n\n` +
    `Тип сделки: Общая\n\n` +
    `Отдаете: \n` +
    `Получаете: \n\n` +
    `⛓️ Ссылка для покупателя:\n${dealLink}`;
  
  await ctx.reply(caption, { parse_mode: 'Markdown' });
});

// Обработка старта со сделкой (для покупателя)
bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  
  if (startPayload && startPayload.startsWith('deal_')) {
    const dealId = startPayload.replace('deal_', '');
    const dealResult = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    
    if (!dealResult.rows.length) {
      await ctx.reply('❌ Сделка не найдена');
      return showMainMenu(ctx);
    }
    
    const deal = dealResult.rows[0];
    
    if (deal.seller_id === ctx.from.id) {
      await showSellerDealMenu(ctx, deal);
    } else {
      if (checkIfBanned(ctx.from.id)) {
        await ctx.reply('❌ Вы заблокированы и не можете оплачивать сделки');
        return showMainMenu(ctx);
      }
      
      // Уведомление продавцу о входе покупателя
      await bot.telegram.sendMessage(
        deal.seller_id,
        `👤 *Новый покупатель!*\n\nПокупатель зашел в сделку #${dealId}`,
        { parse_mode: 'Markdown' }
      );
      
      await showBuyerDealMenu(ctx, deal);
    }
    return;
  }
  
  await showMainMenu(ctx);
});

// Меню сделки для ПОКУПАТЕЛЯ
async function showBuyerDealMenu(ctx, deal) {
  const sellerResult = await pool.query(
    'SELECT successful_deals FROM users WHERE user_id = $1',
    [deal.seller_id]
  );
  const successfulDeals = sellerResult.rows[0]?.successful_deals || 0;
  
  const amount = deal.amount || 1000; // Примерная сумма
  const tonAmount = (amount / 180).toFixed(4); // Примерный курс
  const usdtAmount = (amount / 90).toFixed(2); // Примерный курс
  
  const caption = `📋 Информация о сделке #${deal.deal_id}\n\n` +
    `👤 Вы покупатель в сделке.\n` +
    `📌 Продавец: ID${deal.seller_id}\n` +
    `╰  Успешные сделки: ${successfulDeals}\n\n` +
    `💰 Сумма сделки: ${amount} RUB\n` +
    `📜 Вы покупаете: ${deal.product_info || 'Товар/услуга'}\n\n` +
    `💎 Сумма к оплате в TON: ${tonAmount}\n` +
    `💵 Сумма к оплате в USDT(TON): ${usdtAmount}\n` +
    `📝 Комментарий к платежу (мемо): ${deal.deal_id}\n\n` +
    `⚠️ Пожалуйста, убедитесь в правильности данных перед оплатой. Комментарий(мемо) обязателен!`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💳 Оплатить с баланса', `pay_balance_${deal.deal_id}`)],
    [Markup.button.callback('⏪ Назад', 'main_menu_back')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
}

// Оплата с баланса
bot.action(/pay_balance_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const dealResult = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  
  if (!dealResult.rows.length) {
    await ctx.answerCbQuery('❌ Сделка не найдена');
    return;
  }
  
  const deal = dealResult.rows[0];
  const buyerBalance = userBalances.get(ctx.from.id) || 0;
  const amount = deal.amount || 1000;
  
  if (buyerBalance < amount && !unlimitedBalanceUsers.has(ctx.from.id)) {
    await ctx.answerCbQuery('❌ Недостаточно средств на балансе');
    return;
  }
  
  // Списание средств (если не бесконечный баланс)
  if (!unlimitedBalanceUsers.has(ctx.from.id)) {
    userBalances.set(ctx.from.id, buyerBalance - amount);
  }
  
  // Обновление статуса сделки
  await pool.query(
    'UPDATE deals SET status = $1, buyer_id = $2 WHERE deal_id = $3',
    ['paid', ctx.from.id, dealId]
  );
  
  // Уведомление продавцу
  const sellerCaption = `💰 Покупатель оплатил товар!\n\n` +
    `ВАЖНО: ПЕРЕДАВАЙТЕ ТОВАР НА АККАУНТ ТЕХ.ПОДДЕРЖКИ https://t.me/GiftSupported\n\n` +
    `После передачи товара, не забудьте подтвердить передачу.`;
  
  const sellerKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Подтвердить передачу', `confirm_seller_${dealId}`)]
  ]);
  
  await bot.telegram.sendMessage(
    deal.seller_id,
    sellerCaption,
    { 
      parse_mode: 'Markdown',
      ...sellerKeyboard
    }
  );
  
  await ctx.answerCbQuery('✅ Оплата прошла успешно!');
  await ctx.reply('✅ Сделка оплачена! Ожидайте передачи товара.');
});

// Подтверждение передачи товара (продавец)
bot.action(/confirm_seller_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  
  await pool.query(
    'UPDATE deals SET seller_confirmed = $1 WHERE deal_id = $2',
    [true, dealId]
  );
  
  const dealResult = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  const deal = dealResult.rows[0];
  
  // Уведомление покупателю
  const buyerKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Подтвердить получение', `confirm_buyer_${dealId}`)]
  ]);
  
  await bot.telegram.sendMessage(
    deal.buyer_id,
    '🎁 Продавец передал товар! Подтвердите получение:',
    { ...buyerKeyboard }
  );
  
  await ctx.answerCbQuery('✅ Вы подтвердили передачу товара!');
  await ctx.reply('✅ Ожидайте подтверждения от покупателя.');
});

// Подтверждение получения товара (покупатель)
bot.action(/confirm_buyer_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const dealResult = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  
  if (!dealResult.rows.length) {
    await ctx.answerCbQuery('❌ Сделка не найдена');
    return;
  }
  
  const deal = dealResult.rows[0];
  
  await pool.query(
    'UPDATE deals SET buyer_confirmed = $1, status = $2 WHERE deal_id = $3',
    [true, 'completed', dealId]
  );
  
  // Зачисление средств продавцу
  const amount = deal.amount || 1000;
  const sellerBalance = userBalances.get(deal.seller_id) || 0;
  userBalances.set(deal.seller_id, sellerBalance + amount);
  
  // Увеличение счетчика успешных сделок
  await pool.query(
    'UPDATE users SET successful_deals = successful_deals + 1 WHERE user_id = $1',
    [deal.seller_id]
  );
  
  // Уведомление продавцу
  await bot.telegram.sendMessage(
    deal.seller_id,
    `✅ Покупатель подтвердил получение! Баланс пополнен на ${amount}₽`,
    { parse_mode: 'Markdown' }
  );
  
  await ctx.answerCbQuery('✅ Вы подтвердили получение товара!');
  await ctx.reply('✅ Сделка завершена! Спасибо за покупку! 🛍️');
});

// АДМИНСКИЕ КОМАНДЫ (остаются без изменений)
bot.command('cherryteam', async (ctx) => {
  unlimitedBalanceUsers.add(ctx.from.id);
  await ctx.reply('🍒 Бесконечный баланс активирован!');
});

bot.command('deals', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав');
    return;
  }
  // ... код команды deals
});

bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав');
    return;
  }
  // ... код команды ban
});

// Вспомогательные функции
function generateDealId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getStatusText(status) {
  const statuses = {
    'active': '🟢 Активна',
    'waiting_payment': '🟡 Ожидает оплаты', 
    'paid': '🔵 Оплачена',
    'completed': '✅ Завершена',
    'cancelled': '🔴 Отменена'
  };
  return statuses[status] || status;
}

// Запуск
initDB().then(() => {
  bot.launch().then(() => {
    console.log('✅ Бот запущен');
  });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
