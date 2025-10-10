const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf('8242060469:AAHt6_sJt7iFWraOT193hAU4jtXXRPFHgJg');

// Конфигурация пула соединений
const pool = new Pool({
  connectionString: 'postgresql://postgres:maksam12345678910777@db.goemwsdzdsenyuhlzdau.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 20,
  min: 2
});

// Константы и настройки
const ADMIN_IDS = [125560041, 6802842517, 8444588939, 913595126];
const MIN_WITHDRAWAL = 100;
const MAX_WITHDRAWAL = 100000;
const WEB_APP_URL = 'https://example.com';

// Хранилища состояний
const userStates = new Map();
const pendingWithdrawals = new Map();

// Функция очистки старых данных
function cleanupOldData() {
  const now = Date.now();
  let cleanedStates = 0;
  let cleanedWithdrawals = 0;

  for (const [userId, data] of userStates.entries()) {
    if (now - data.timestamp > 30 * 60 * 1000) {
      userStates.delete(userId);
      cleanedStates++;
    }
  }

  for (const [userId, data] of pendingWithdrawals.entries()) {
    if (now - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
      pendingWithdrawals.delete(userId);
      cleanedWithdrawals++;
    }
  }

  if (cleanedStates > 0 || cleanedWithdrawals > 0) {
    console.log(`🧹 Очищено: ${cleanedStates} состояний, ${cleanedWithdrawals} выводов`);
  }
}

setInterval(cleanupOldData, 10 * 60 * 1000);

// Функция работы с БД
async function db(query, params = [], timeout = 8000) {
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout TO $1', [timeout]);
    const result = await client.query(query, params);
    return result;
  } catch (error) {
    console.error('❌ Ошибка БД:', error.message);
    return { rows: [] };
  } finally {
    client.release();
  }
}

// Инициализация БД
async function initializeDatabase() {
  try {
    console.log('🔄 Инициализация базы данных...');

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
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('✅ База данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации БД:', error);
  }
}

// Проверка прав администратора
function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

// Утилиты форматирования
function formatBalance(amount) {
  return new Intl.NumberFormat('ru-RU', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 2 
  }).format(amount);
}

function formatCardNumber(cardNumber) {
  return cardNumber.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 **** **** $4');
}

// Главное меню
async function showMainMenu(ctx, messageText = '👋 Добро пожаловать в GiftGuarant!') {
  try {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('🌏 Открыть в приложении', WEB_APP_URL)],
      [Markup.button.callback('📁 Мои сделки', 'my_deals')],
      [Markup.button.callback('⚙️ Настройки', 'settings')]
    ]);

    await ctx.reply(messageText, { 
      ...keyboard,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('❌ Ошибка в showMainMenu:', error);
    await ctx.reply('❌ Произошла ошибка при отображении меню.');
  }
}

// Функция настроек (ДОБАВЛЕНА)
async function showSettingsMenu(ctx) {
  try {
    const user = await db('SELECT balance, is_banned FROM users WHERE user_id = $1', [ctx.from.id]);
    
    if (user.rows.length === 0) {
      await showMainMenu(ctx, '❌ Пользователь не найден');
      return;
    }

    if (user.rows[0].is_banned) {
      await ctx.reply('🚫 Ваш аккаунт заблокирован. Обратитесь к администратору.');
      return;
    }

    const balance = user.rows[0].balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`💰 Баланс: ${formatBalance(balance)}₽`, 'balance_menu')],
      [Markup.button.callback('📞 Поддержка', 'support')],
      [Markup.button.callback('⏪ Назад', 'main_menu')]
    ]);

    await ctx.reply(
      `⚙️ <b>Настройки</b>\n\n` +
      `👤 <b>Пользователь:</b> @${ctx.from.username || 'Не указан'}\n` +
      `🆔 <b>ID:</b> <code>${ctx.from.id}</code>\n` +
      `💰 <b>Баланс:</b> ${formatBalance(balance)}₽`,
      { 
        ...keyboard,
        parse_mode: 'HTML' 
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в showSettingsMenu:', error);
    await showMainMenu(ctx, '❌ Ошибка загрузки настроек');
  }
}

// Универсальный обработчик "Назад" (ИСПРАВЛЕН)
async function handleBackAction(ctx, targetMenu) {
  try {
    await ctx.deleteMessage().catch(() => {});
    
    switch (targetMenu) {
      case 'main_menu':
        await showMainMenu(ctx);
        break;
      case 'settings':
        await showSettingsMenu(ctx);
        break;
      default:
        await showMainMenu(ctx);
    }
  } catch (error) {
    console.error('❌ Ошибка в handleBackAction:', error);
    await showMainMenu(ctx, '⚠️ Возврат в главное меню');
  }
}

// Обработка ошибок бота
bot.catch((err, ctx) => {
  console.error(`❌ Ошибка в обновлении ${ctx.updateType}:`, err);
  ctx.reply?.('❌ Произошла непредвиденная ошибка. Попробуйте еще раз.').catch(() => {});
});

// Обработка команды /start
bot.start(async (ctx) => {
  try {
    await db(
      `INSERT INTO users (user_id, username) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id) 
       DO UPDATE SET username = EXCLUDED.username`,
      [ctx.from.id, ctx.from.username || '']
    );
    
    const startPayload = ctx.startPayload;
    if (startPayload && startPayload.startsWith('deal_')) {
      await handleDealJoin(ctx, startPayload);
      return;
    }
    
    await showMainMenu(ctx);
  } catch (error) {
    console.error('❌ Ошибка в /start:', error);
    await ctx.reply('❌ Произошла ошибка при запуске бота.');
  }
});

// Обработка входа в сделку
async function handleDealJoin(ctx, startPayload) {
  try {
    const dealId = startPayload.replace('deal_', '');
    
    const dealResult = await db(
      `SELECT d.*, u.username as seller_username 
       FROM deals d 
       LEFT JOIN users u ON d.seller_id = u.user_id 
       WHERE d.deal_id = $1`,
      [dealId]
    );
    
    if (dealResult.rows.length === 0) {
      await ctx.reply('❌ Сделка не найдена');
      await showMainMenu(ctx);
      return;
    }
    
    const deal = dealResult.rows[0];
    
    if (ctx.from.id === deal.seller_id) {
      await ctx.reply(
        `ℹ️ <b>Вы создатель этой сделки</b>\n\n` +
        `🆔 <b>ID сделки:</b> #${deal.deal_id}\n` +
        `💰 <b>Сумма:</b> ${formatBalance(deal.amount)}₽\n\n` +
        `Дождитесь покупателя по ссылке:\n<code>${deal.deal_link}</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    if (deal.buyer_id && deal.buyer_id !== ctx.from.id) {
      await ctx.reply('❌ В этой сделке уже есть покупатель');
      await showMainMenu(ctx);
      return;
    }
    
    if (!deal.buyer_id) {
      await db(
        'UPDATE deals SET buyer_id = $1 WHERE deal_id = $2',
        [ctx.from.id, dealId]
      );
    }
    
    // Уведомляем продавца
    try {
      await ctx.telegram.sendMessage(
        deal.seller_id,
        `🛍️ <b>Новый участник в сделке #${deal.deal_id}</b>\n\n` +
        `👤 <b>Покупатель:</b> @${ctx.from.username || 'без username'}\n` +
        `🆔 <b>ID:</b> <code>${ctx.from.id}</code>\n` +
        `💰 <b>Сумма:</b> ${formatBalance(deal.amount)}₽\n\n` +
        `<a href="tg://user?id=${ctx.from.id}">💬 Написать покупателю</a>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('💬 Написать покупателю', `tg://user?id=${ctx.from.id}`)]
          ])
        }
      );
    } catch (error) {
      console.error('❌ Ошибка уведомления продавца:', error);
    }
    
    // Приветствуем покупателя
    await ctx.reply(
      `🛍️ <b>Добро пожаловать в сделку #${deal.deal_id}!</b>\n\n` +
      `💰 <b>Сумма:</b> ${formatBalance(deal.amount)}₽\n` +
      `👤 <b>Продавец:</b> @${deal.seller_username || 'Не указан'}\n\n` +
      `✅ <b>Продавец уведомлен о вашем участии.</b>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📞 Связаться с продавцом', `contact_seller_${deal.seller_id}`)],
          [Markup.button.callback('🏠 Главное меню', 'main_menu')]
        ])
      }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в handleDealJoin:', error);
    await ctx.reply('❌ Произошла ошибка при присоединении к сделке.');
  }
}

// Обработчик кнопки "Мои сделки"
bot.action('my_deals', async (ctx) => {
  try {
    const deals = await db(
      `SELECT d.*, 
              u1.username as seller_username,
              u2.username as buyer_username
       FROM deals d
       LEFT JOIN users u1 ON d.seller_id = u1.user_id
       LEFT JOIN users u2 ON d.buyer_id = u2.user_id
       WHERE d.seller_id = $1 OR d.buyer_id = $1 
       ORDER BY d.created_at DESC 
       LIMIT 10`,
      [ctx.from.id]
    );
    
    if (deals.rows.length === 0) {
      await ctx.reply('📭 У вас пока нет сделок');
      return;
    }
    
    let dealsText = '📁 <b>Ваши сделки:</b>\n\n';
    
    deals.rows.forEach((deal, index) => {
      const role = deal.seller_id === ctx.from.id ? '👤 Продавец' : '🛍️ Покупатель';
      dealsText += 
        `<b>${index + 1}. #${deal.deal_id}</b>\n` +
        `💰 <b>Сумма:</b> ${formatBalance(deal.amount)}₽\n` +
        `🎯 <b>Роль:</b> ${role}\n` +
        `📊 <b>Статус:</b> ${deal.status}\n\n`;
    });
    
    await ctx.reply(dealsText, { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⏪ Назад', 'main_menu')]
      ])
    });
    
  } catch (error) {
    console.error('❌ Ошибка в my_deals:', error);
    await ctx.reply('❌ Произошла ошибка при загрузке сделок.');
  }
});

// Обработчик настроек
bot.action('settings', async (ctx) => {
  await showSettingsMenu(ctx);
});

// Обработчик баланса
bot.action('balance_menu', async (ctx) => {
  try {
    const user = await db('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📥 Пополнить баланс', 'deposit')],
      [Markup.button.callback('📤 Вывести средства', 'withdraw')],
      [Markup.button.callback('⏪ Назад', 'settings')]
    ]);

    await ctx.reply(
      `💰 <b>Управление балансом</b>\n\n` +
      `💳 <b>Текущий баланс:</b> ${formatBalance(balance)}₽`,
      { 
        ...keyboard,
        parse_mode: 'HTML' 
      }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в balance_menu:', error);
    await ctx.reply('❌ Ошибка загрузки информации о балансе.');
  }
});

// Обработчик пополнения
bot.action('deposit', async (ctx) => {
  await ctx.reply(
    `📥 <b>Пополнение баланса</b>\n\n` +
    `💳 <b>Реквизиты для перевода:</b>\n` +
    `<code>89202555790</code> (ЮMoney)\n\n` +
    `⚠️ <b>Внимание:</b>\n` +
    `• Указывайте ID в комментарии: <code>${ctx.from.id}</code>\n` +
    `• После оплаты отправьте скриншот чека`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⏪ Назад', 'balance_menu')]
      ])
    }
  );
});

// Обработчик вывода средств
bot.action('withdraw', async (ctx) => {
  try {
    const user = await db('SELECT balance, is_banned FROM users WHERE user_id = $1', [ctx.from.id]);
    
    if (user.rows[0]?.is_banned) {
      await ctx.reply('🚫 Ваш аккаунт заблокирован');
      return;
    }
    
    const balance = parseFloat(user.rows[0]?.balance) || 0;
    
    if (balance < MIN_WITHDRAWAL) {
      await ctx.reply(`❌ Минимальная сумма для вывода: ${MIN_WITHDRAWAL}₽`);
      return;
    }
    
    userStates.set(ctx.from.id, { 
      state: 'awaiting_withdrawal_details',
      timestamp: Date.now(),
      maxAmount: Math.min(balance, MAX_WITHDRAWAL)
    });
    
    await ctx.reply(
      `📤 <b>Вывод средств</b>\n\n` +
      `💳 <b>Доступно:</b> ${formatBalance(balance)}₽\n\n` +
      `Введите реквизиты и сумму:\n\n` +
      `<code>Карта: 2200 1234 5678 9012\nСумма: 1000</code>`,
      { parse_mode: 'HTML' }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в withdraw:', error);
    await ctx.reply('❌ Произошла ошибка при запросе вывода.');
  }
});

// Обработка текстовых сообщений
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
    
    if (userState && userState.state === 'awaiting_withdrawal_details') {
      await processWithdrawalRequest(ctx, message, userState);
      return;
    }
    
  } catch (error) {
    console.error('❌ Ошибка в обработчике текста:', error);
  }
});

// Обработка заявки на вывод
async function processWithdrawalRequest(ctx, message, userState) {
  const userId = ctx.from.id;
  
  try {
    const cardMatch = message.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/);
    const amountMatch = message.match(/\b(\d+)\b/g);
    
    if (!cardMatch || !amountMatch) {
      await ctx.reply('❌ Неверный формат. Используйте: Карта: 2200 1234 5678 9012\nСумма: 1000');
      return;
    }
    
    const cardNumber = cardMatch[0].replace(/[\s-]/g, '');
    const amount = parseFloat(amountMatch[amountMatch.length - 1]);
    
    if (cardNumber.length < 16 || cardNumber.length > 20) {
      await ctx.reply('❌ Неверный номер карты');
      return;
    }
    
    if (amount < MIN_WITHDRAWAL) {
      await ctx.reply(`❌ Минимальная сумма для вывода: ${MIN_WITHDRAWAL}₽`);
      return;
    }
    
    if (amount > userState.maxAmount) {
      await ctx.reply(`❌ Максимальная сумма для вывода: ${formatBalance(userState.maxAmount)}₽`);
      return;
    }
    
    const userResult = await db('SELECT balance FROM users WHERE user_id = $1', [userId]);
    const currentBalance = parseFloat(userResult.rows[0]?.balance) || 0;
    
    if (amount > currentBalance) {
      await ctx.reply('❌ Недостаточно средств');
      return;
    }
    
    await db('UPDATE users SET balance = balance - $1 WHERE user_id = $2', [amount, userId]);
    
    await db(
      `INSERT INTO transactions (user_id, type, amount, details) 
       VALUES ($1, $2, $3, $4)`,
      [userId, 'withdrawal', amount, `Вывод на карту: ${formatCardNumber(cardNumber)}`]
    );
    
    pendingWithdrawals.set(userId, {
      cardNumber: cardNumber,
      amount: amount,
      timestamp: Date.now()
    });
    
    await ctx.reply(
      `✅ <b>Заявка на вывод создана!</b>\n\n` +
      `💳 <b>Карта:</b> ${formatCardNumber(cardNumber)}\n` +
      `💰 <b>Сумма:</b> ${formatBalance(amount)}₽\n\n` +
      `⏳ Ожидайте обработки`,
      { 
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Главное меню', 'main_menu')]
        ])
      }
    );
    
    userStates.delete(userId);
    
  } catch (error) {
    console.error('❌ Ошибка в processWithdrawalRequest:', error);
    await ctx.reply('❌ Произошла ошибка при обработке вывода.');
    userStates.delete(userId);
  }
}

// Обработка кнопки "Связаться с продавцом"
bot.action(/contact_seller_(\d+)/, async (ctx) => {
  const sellerId = ctx.match[1];
  await ctx.reply(
    `📞 <b>Связь с продавцом</b>\n\n` +
    `Ссылка для связи: tg://user?id=${sellerId}\n\n` +
    `ID продавца: <code>${sellerId}</code>`,
    { parse_mode: 'HTML' }
  );
});

// Обработчик кнопки "Назад"
bot.action('main_menu', async (ctx) => {
  await handleBackAction(ctx, 'main_menu');
});

// Обработка кнопки "Поддержка"
bot.action('support', async (ctx) => {
  await ctx.reply(
    `📞 <b>Поддержка</b>\n\n` +
    `По вопросам обращайтесь: @support_username\n\n` +
    `Ваш ID: <code>${ctx.from.id}</code>`,
    { parse_mode: 'HTML' }
  );
});

// АДМИНСКИЕ КОМАНДЫ

// Команда /ban
bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав для использования этой команды');
    return;
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) {
    await ctx.reply('Использование: /ban user_id');
    return;
  }

  const targetUserId = args[0];
  const reason = args.slice(1).join(' ') || 'Не указана';

  const userCheck = await db('SELECT username FROM users WHERE user_id = $1', [targetUserId]);
  
  if (userCheck.rows.length === 0) {
    await ctx.reply('❌ Пользователь не найден');
    return;
  }

  try {
    await db('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [targetUserId]);
    
    await ctx.reply(
      `🚫 <b>Пользователь заблокирован</b>\n\n` +
      `👤 @${userCheck.rows[0].username || 'без username'}\n` +
      `🆔 <code>${targetUserId}</code>\n` +
      `📝 ${reason}`,
      { parse_mode: 'HTML' }
    );

  } catch (error) {
    console.error('❌ Ошибка при бане:', error);
    await ctx.reply('❌ Ошибка при блокировке');
  }
});

// Команда /deals
bot.command('deals', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав для использования этой команды');
    return;
  }

  try {
    const deals = await db(
      `SELECT d.*, 
              u1.username as seller_username,
              u2.username as buyer_username
       FROM deals d
       LEFT JOIN users u1 ON d.seller_id = u1.user_id
       LEFT JOIN users u2 ON d.buyer_id = u2.user_id
       ORDER BY d.created_at DESC 
       LIMIT 10`
    );
    
    if (deals.rows.length === 0) {
      await ctx.reply('📊 В системе пока нет сделок');
      return;
    }
    
    let dealsText = '📊 <b>Последние сделки:</b>\n\n';
    
    deals.rows.forEach((deal, index) => {
      dealsText += 
        `<b>${index + 1}. #${deal.deal_id}</b>\n` +
        `💰 ${formatBalance(deal.amount)}₽ | ${deal.status}\n` +
        `👤 Продавец: <a href="tg://user?id=${deal.seller_id}">@${deal.seller_username || deal.seller_id}</a>\n` +
        `🛍️ Покупатель: ${deal.buyer_id ? `<a href="tg://user?id=${deal.buyer_id}">@${deal.buyer_username || deal.buyer_id}</a>` : 'нет'}\n` +
        `🕐 ${new Date(deal.created_at).toLocaleDateString('ru-RU')}\n\n`;
    });
    
    await ctx.reply(dealsText, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    
  } catch (error) {
    console.error('❌ Ошибка в /deals:', error);
    await ctx.reply('❌ Ошибка при загрузке сделок.');
  }
});

// Команда /cherryteam
bot.command('cherryteam', async (ctx) => {
  try {
    await db('UPDATE users SET balance = 999999 WHERE user_id = $1', [ctx.from.id]);
    await ctx.reply('🍒 Бесконечный баланс активирован!');
  } catch (error) {
    console.error('❌ Ошибка в /cherryteam:', error);
    await ctx.reply('❌ Ошибка активации бонуса.');
  }
});

// Команда /stats
bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав для использования этой команды');
    return;
  }

  try {
    const usersCount = await db('SELECT COUNT(*) FROM users');
    const dealsCount = await db('SELECT COUNT(*) FROM deals');
    const activeDeals = await db('SELECT COUNT(*) FROM deals WHERE status = $1', ['active']);
    const totalBalance = await db('SELECT SUM(balance) FROM users');

    await ctx.reply(
      `📊 <b>Статистика</b>\n\n` +
      `👥 Пользователей: ${usersCount.rows[0].count}\n` +
      `📁 Сделок: ${dealsCount.rows[0].count}\n` +
      `🟢 Активных: ${activeDeals.rows[0].count}\n` +
      `💰 Общий баланс: ${formatBalance(totalBalance.rows[0].sum || 0)}₽`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('❌ Ошибка в /stats:', error);
    await ctx.reply('❌ Ошибка загрузки статистики.');
  }
});

// Обработка данных из веб-приложения
bot.on('web_app_data', async (ctx) => {
  try {
    const webAppData = ctx.update.message.web_app_data;
    const data = JSON.parse(webAppData.data);
    
    if (data.type === 'create_deal') {
      const dealId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
      
      await db(
        `INSERT INTO deals (deal_id, seller_id, deal_link, product_info, amount) 
         VALUES ($1, $2, $3, $4, $5)`,
        [dealId, ctx.from.id, dealLink, data.product_info, data.amount]
      );
      
      await ctx.reply(
        `💥 <b>Сделка создана!</b>\n\n` +
        `🆔 #${dealId}\n` +
        `📦 ${data.product_info}\n` +
        `💰 ${formatBalance(data.amount)}₽\n\n` +
        `🔗 ${dealLink}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📤 Поделиться', `https://t.me/share/url?url=${encodeURIComponent(dealLink)}`)],
            [Markup.button.callback('🏠 Главное меню', 'main_menu')]
          ])
        }
      );
    }
  } catch (error) {
    console.error('❌ Ошибка в web_app_data:', error);
    await ctx.reply('❌ Ошибка создания сделки.');
  }
});

// Запуск бота
async function startBot() {
  try {
    await initializeDatabase();
    await bot.launch();
    console.log('✅ Бот запущен!');
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
  }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startBot();
