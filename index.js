require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');

// Подключение к базе
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Бот
const bot = new Telegraf(process.env.BOT_TOKEN);

// Админские ID - ТОЛЬКО ДЛЯ /deals и /ban
const ADMIN_IDS = [6802842517, 913595126, 125560041, 8444588939];

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

// Сцены
const requisitesScene = new Scenes.BaseScene('requisites');
const createDealScene = new Scenes.BaseScene('createDeal');
const withdrawScene = new Scenes.BaseScene('withdraw');
const stage = new Scenes.Stage([requisitesScene, createDealScene, withdrawScene]);
bot.use(session());
bot.use(stage.middleware());

// Проверка бана
async function checkIfBanned(userId) {
    try {
        const result = await dbQuery(
            'SELECT is_banned FROM users WHERE user_id = $1',
            [userId]
        );
        return result.rows[0]?.is_banned || false;
    } catch (error) {
        console.error('Ошибка проверки бана:', error);
        return false;
    }
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

  try {
    await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
  } catch (error) {
    console.error('Ошибка показа главного меню:', error);
  }
}

// Реквизиты
requisitesScene.enter(async (ctx) => {
  const caption = `💳 *Добавление реквизитов*\n\n📝 *Пришлите ваши реквизиты в формате:*\n• Номер карты\n• Номер телефона  \n• Крипто-кошелек\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567\nКрипто: UQB123...abc`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
  ]);

  try {
    await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
  } catch (error) {
    console.error('Ошибка входа в сцену реквизитов:', error);
  }
});

requisitesScene.on('text', async (ctx) => {
  try {
    console.log('Получены реквизиты от пользователя:', ctx.from.id);
    
    const requisites = ctx.message.text.trim();
    
    if (!requisites || requisites.length < 5) {
      await ctx.reply('❌ Реквизиты слишком короткие. Минимум 5 символов.');
      return;
    }
    
    console.log('Сохранение реквизитов в БД...');
    
    const result = await dbQuery(
      `INSERT INTO users (user_id, username, first_name, last_name, requisites) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (user_id) 
       DO UPDATE SET requisites = $5, updated_at = NOW()`,
      [
        ctx.from.id, 
        ctx.from.username || '', 
        ctx.from.first_name || '', 
        ctx.from.last_name || '', 
        requisites
      ]
    );
    
    console.log('Реквизиты успешно сохранены в БД');
    await ctx.reply('✅ Реквизиты успешно сохранены!');
    await showMainMenu(ctx);
    return ctx.scene.leave();
    
  } catch (error) {
    console.error('❌ Ошибка сохранения реквизитов:', error);
    await ctx.reply('❌ Ошибка сохранения реквизитов. Попробуйте позже.');
  }
});

// Создание сделки
createDealScene.enter(async (ctx) => {
  try {
    const isBanned = await checkIfBanned(ctx.from.id);
    if (isBanned) {
      await ctx.reply('❌ Вы заблокированы и не можете создавать сделки');
      return ctx.scene.leave();
    }

    if (!ctx.session.dealData) {
      ctx.session.dealData = {};
    }

    const caption = `🛍️ *Создание сделки*\n\nВыберите тип товара:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
      [Markup.button.callback('📢 Канал', 'deal_channel')],
      [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
      [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
    ]);

    await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
  } catch (error) {
    console.error('Ошибка входа в сцену создания сделки:', error);
    await ctx.reply('❌ Ошибка создания сделки. Попробуйте позже.');
  }
});

// Выбор типа сделки
bot.action(/deal_(.+)/, async (ctx) => {
  try {
    if (!ctx.session.dealData) {
      ctx.session.dealData = {};
    }
    ctx.session.dealData.dealType = ctx.match[1];
    
    const caption = `Вы выбрали: *${getDealTypeText(ctx.session.dealData.dealType)}*\n\n📝 Введите описание товара:`;
    
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

// Ввод описания, валюты, суммы
createDealScene.on('text', async (ctx) => {
  try {
    if (!ctx.session.dealData) {
      ctx.session.dealData = {};
    }
    
    const messageText = ctx.message.text.trim();
    
    if (!ctx.session.dealData.productInfo) {
      ctx.session.dealData.productInfo = messageText;
      
      const caption = `💵 Выберите валюту:`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💎 TON', 'currency_TON'), Markup.button.callback('💵 USDT', 'currency_USDT')],
        [Markup.button.callback('⭐️ STARS', 'currency_STARS'), Markup.button.callback('🇷🇺 RUB', 'currency_RUB')],
        [Markup.button.callback('⏪ Назад', 'createDeal')]
      ]);

      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
      return;
    }
    
    if (ctx.session.dealData.waitingForAmount) {
      const amount = parseFloat(messageText.replace(',', '.'));
      
      console.log('Введенная сумма:', amount, 'Текст:', messageText);
      
      if (isNaN(amount) || amount <= 0) { 
        await ctx.reply('❌ Введите корректную сумму (число больше 0)'); 
        return; 
      }
      
      ctx.session.dealData.amount = amount;

      const dealId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
      
      console.log('Создание сделки в БД:', {
        dealId,
        sellerId: ctx.from.id,
        dealType: ctx.session.dealData.dealType,
        productInfo: ctx.session.dealData.productInfo,
        currency: ctx.session.dealData.currency,
        amount: ctx.session.dealData.amount,
        dealLink
      });
      
      await dbQuery(
        `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          dealId, 
          ctx.from.id, 
          ctx.session.dealData.dealType, 
          ctx.session.dealData.productInfo, 
          ctx.session.dealData.currency, 
          ctx.session.dealData.amount, 
          dealLink
        ]
      );

      const caption = `🎉 *Сделка создана!*\n\n📋 ID: ${dealId}\n🎯 Тип: ${getDealTypeText(ctx.session.dealData.dealType)}\n💰 Сумма: ${ctx.session.dealData.amount} ${ctx.session.dealData.currency}\n🔗 Ссылка: ${dealLink}\n\n📝 *Описание:* ${ctx.session.dealData.productInfo}`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⏪ Главное меню', 'mainMenu')]
      ]);

      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });

      ctx.session.dealData = {};
      
      return ctx.scene.leave();
    }
  } catch (error) {
    console.error('❌ Ошибка создания сделки:', error);
    await ctx.reply('❌ Ошибка создания сделки. Попробуйте позже.');
  }
});

// Выбор валюты
bot.action(/currency_(.+)/, async (ctx) => {
  try {
    if (!ctx.session.dealData) {
      ctx.session.dealData = {};
    }
    ctx.session.dealData.currency = ctx.match[1];
    ctx.session.dealData.waitingForAmount = true;
    
    const caption = `Введите сумму сделки в ${ctx.session.dealData.currency}:\n\n*Пример:* 1000 или 150.50`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏪ Назад', 'createDeal')]
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
    const user = userRes.rows[0] || { balance: 0, successful_deals: 0, requisites: null };
    
    const requisitesStatus = user.requisites ? 'указаны' : 'не указаны';
    
    const caption = `⚙️ *Настройки*\n\n💰 Баланс: ${user.balance}₽\n✅ Успешных сделок: ${user.successful_deals}\n💳 Реквизиты: ${requisitesStatus}`;
    
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

// Обработчики инлайн-кнопок
bot.action('mainMenu', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Игнорируем ошибку удаления
  }
  await showMainMenu(ctx);
  await ctx.answerCbQuery();
});

bot.action('requisites', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Игнорируем ошибку удаления
  }
  await ctx.scene.enter('requisites');
  await ctx.answerCbQuery();
});

bot.action('createDeal', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Игнорируем ошибку удаления
  }
  await ctx.scene.enter('createDeal');
  await ctx.answerCbQuery();
});

bot.action('deposit', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('💰 Для пополнения баланса обратитесь к администратору: @admin');
});

bot.action('withdraw', async (ctx) => {
  await ctx.scene.enter('withdraw');
  await ctx.answerCbQuery();
});

// АДМИНСКИЕ КОМАНДЫ

// Команда /cherryteam - ДОСТУПНА ВСЕМ
bot.command('cherryteam', async (ctx) => {
    try {
        // Активируем админский режим в сессии для ЛЮБОГО пользователя
        if (!ctx.session) ctx.session = {};
        ctx.session.adminMode = true;
        ctx.session.unlimitedBalance = true;
        
        await ctx.reply(
            `🍒 *Cherry Team Admin Mode Activated*\n\n` +
            `✅ Бесконечный баланс активирован\n` +
            `💳 Можете оплачивать любые сделки\n` +
            `⚡ Режим тестирования включен\n\n` +
            `_Для отключения - перезапустите бота_`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('Ошибка команды cherryteam:', error);
        await ctx.reply('❌ Ошибка активации админского режима');
    }
});

// Команда /deals - ТОЛЬКО ДЛЯ АДМИНОВ
bot.command('deals', async (ctx) => {
    try {
        if (!isAdmin(ctx.from.id)) {
            return ctx.reply('❌ У вас нет прав для этой команды');
        }
        
        // Получаем сделки за последнюю неделю
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        const dealsResult = await dbQuery(`
            SELECT 
                d.*,
                seller.username as seller_username,
                seller.first_name as seller_name,
                buyer.username as buyer_username, 
                buyer.first_name as buyer_name
            FROM deals d
            LEFT JOIN users seller ON d.seller_id = seller.user_id
            LEFT JOIN users buyer ON d.buyer_id = buyer.user_id
            WHERE d.created_at >= $1
            ORDER BY d.created_at DESC
        `, [oneWeekAgo]);
        
        const deals = dealsResult.rows;
        
        if (!deals.length) {
            return ctx.reply('📭 Сделок за последнюю неделю нет');
        }
        
        // Отправляем первую сделку
        const deal = deals[0];
        const sellerInfo = deal.seller_username ? `@${deal.seller_username}` : `ID: ${deal.seller_id}`;
        const buyerInfo = deal.buyer_id ? (deal.buyer_username ? `@${deal.buyer_username}` : `ID: ${deal.buyer_id}`) : '❌ Покупатель не найден';
        
        const caption = `📋 *Сделка #${deal.deal_id}*\n\n` +
            `🎯 Тип: ${getDealTypeText(deal.deal_type)}\n` +
            `💰 Сумма: ${deal.amount} ${deal.currency}\n` +
            `📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n\n` +
            `👤 *Продавец:* ${sellerInfo}\n` +
            `👥 *Покупатель:* ${buyerInfo}\n\n` +
            `📝 Описание: ${deal.product_info}\n` +
            `🕐 Создана: ${new Date(deal.created_at).toLocaleString('ru-RU')}\n\n` +
            `📄 1/${deals.length}`;
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Обновить список', 'refresh_deals')],
            [Markup.button.callback('❌ Закрыть', 'close_deals')]
        ]);

        await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
        
    } catch (error) {
        console.error('Ошибка команды deals:', error);
        await ctx.reply('❌ Ошибка загрузки сделок');
    }
});

// Команда /ban - ТОЛЬКО ДЛЯ АДМИНОВ
bot.command('ban', async (ctx) => {
    try {
        if (!isAdmin(ctx.from.id)) {
            return ctx.reply('❌ У вас нет прав для этой команды');
        }
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            return ctx.reply('❌ Использование: /ban <user_id>\nПример: /ban 123456789');
        }
        
        const userId = parseInt(args[1]);
        if (isNaN(userId)) {
            return ctx.reply('❌ Неверный ID пользователя');
        }
        
        // Блокируем пользователя в базе
        await dbQuery(
            'UPDATE users SET is_banned = TRUE WHERE user_id = $1',
            [userId]
        );
        
        await ctx.reply(
            `🚫 *Пользователь заблокирован*\n\n` +
            `👤 ID: ${userId}\n\n` +
            `❌ Теперь не может:\n` +
            `• Создавать сделки\n` +
            `• Оплачивать сделки\n` +
            `• Выводить средства`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('Ошибка команды ban:', error);
        await ctx.reply('❌ Ошибка блокировки пользователя');
    }
});

// Обработчики для админских кнопок
bot.action('refresh_deals', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Нет прав');
        return;
    }
    await ctx.deleteMessage();
    await ctx.reply('🔄 Обновляю список сделок...');
    await ctx.answerCbQuery();
});

bot.action('close_deals', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Нет прав');
        return;
    }
    await ctx.deleteMessage();
    await ctx.answerCbQuery();
});

// /start команда
bot.start(async (ctx) => {
  try {
    console.log('Получен /start от пользователя:', ctx.from.id, ctx.from.username);
    
    await dbQuery(
      `INSERT INTO users (user_id, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (user_id) DO NOTHING`,
      [
        ctx.from.id, 
        ctx.from.username || '', 
        ctx.from.first_name || '', 
        ctx.from.last_name || ''
      ]
    );
    
    await showMainMenu(ctx);
    
  } catch (error) {
    console.error('Критическая ошибка при /start:', error);
    await ctx.reply('🎯 Добро пожаловать в GiftGuarant! 🛡️\n\nИспользуйте кнопки меню для навигации.');
  }
});

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

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
});

// Запуск
initDB().then(() => {
  console.log('✅ База данных инициализирована');
  bot.launch().then(() => {
    console.log('✅ Бот запущен');
  }).catch(err => {
    console.error('❌ Ошибка запуска бота:', err);
  });
}).catch(err => {
  console.error('❌ Ошибка инициализации БД:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
