require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');

// Инициализация базы данных Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// Админ-команды
const ADMIN_IDS = [123456789, 987654321]; // ЗАМЕНИТЕ НА ВАШИ ID АДМИНОВ

// Функция проверки админа
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Функция проверки бана пользователя
async function isUserBanned(userId) {
    try {
        const result = await pool.query(
            'SELECT is_banned FROM users WHERE user_id = $1',
            [userId]
        );
        return result.rows.length > 0 && result.rows[0].is_banned === true;
    } catch (error) {
        console.error('Error checking ban status:', error);
        return false;
    }
}

// Проверка подключения к БД
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully:', res.rows[0]);
  }
});

// Инициализация таблиц
async function initDB() {
  try {
    await pool.query(`
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

      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY,
        deal_id VARCHAR(50) UNIQUE NOT NULL,
        seller_id BIGINT NOT NULL,
        buyer_id BIGINT,
        deal_type VARCHAR(50) NOT NULL,
        product_info TEXT NOT NULL,
        currency VARCHAR(20) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        deal_link TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        requisites TEXT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
}

initDB();

// Сцены
const requisitesScene = new Scenes.BaseScene('requisites');
const createDealScene = new Scenes.BaseScene('createDeal');
const withdrawScene = new Scenes.BaseScene('withdraw');

// Сцена реквизитов
requisitesScene.enter(async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете использовать эту функцию');
    return ctx.scene.leave();
  }

  await ctx.reply(
    '⛓️ Добавьте ваши реквизиты:\n\nПожалуйста, пришлите ниже номер телефона, карты или адрес кошелька 👇'
  );
});

requisitesScene.on('text', async (ctx) => {
  if (ctx.message.text === '⏪ В главное меню') {
    await showMainMenu(ctx);
    return ctx.scene.leave();
  }

  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете использовать эту функцию');
    return ctx.scene.leave();
  }

  const userId = ctx.from.id;
  const requisites = ctx.message.text;

  try {
    await pool.query(
      `INSERT INTO users (user_id, requisites, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (user_id) 
       DO UPDATE SET requisites = $2, updated_at = NOW()`,
      [userId, requisites]
    );

    await ctx.reply(
      '💥 Реквизиты успешно добавлены!\n\nУдачных сделок!',
      Markup.keyboard([['⏪ В главное меню']]).resize()
    );
  } catch (error) {
    console.error('Error saving requisites:', error);
    await ctx.reply('❌ Произошла ошибка при сохранении реквизитов');
  }
  return ctx.scene.leave();
});

// Сцена создания сделки
createDealScene.enter(async (ctx) => {
  // Проверка на бан
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return ctx.scene.leave();
  }

  await ctx.reply(
    '❔ Выберите тип сделки!',
    Markup.keyboard([
      ['🎁 Подарки', '📢 Канал'],
      ['🆕 NFT Активы', '⏪ В главное меню']
    ]).resize()
  );
});

createDealScene.hears('🎁 Подарки', async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return ctx.scene.leave();
  }

  ctx.session.dealType = 'gifts';
  await ctx.reply(
    '💼 Создание сделки\n\nУкажите ссылку на товар. Если у вас несколько товаров то отправьте все ссылки в одном сообщении 👇',
    Markup.keyboard([['⏪ В главное меню']]).resize()
  );
});

createDealScene.hears('📢 Канал', async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return ctx.scene.leave();
  }

  ctx.session.dealType = 'channel';
  await ctx.reply(
    '🤖 Добавьте бота в качестве администратора в канал который вы продаете!\n\nБот должен быть именно АДМИНИСТРАТОРОМ, а так же добавлять его нужно именно с текущего аккаунта! 👇\n\nПосле добавления отправьте ссылку на канал:',
    Markup.keyboard([['⏪ В главное меню']]).resize()
  );
});

createDealScene.hears('🆕 NFT Активы', async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return ctx.scene.leave();
  }

  ctx.session.dealType = 'nft';
  await ctx.reply(
    '☝️ Уточните что именно вы продаёте\nЗвёзды ⭐️, Криптовалюта 💴, NFT юзер.\n\nПередавать активы строго на криптокошелек нашего бота\n👇\nUQA8t_PXSXu1mfNdwnLVS7BAv4WV6d-L8A2BTn7LA8XL2D-G\n\nОпишите что продаете:',
    Markup.keyboard([['⏪ В главное меню']]).resize()
  );
});

createDealScene.on('text', async (ctx) => {
  if (ctx.message.text === '⏪ В главное меню') {
    await showMainMenu(ctx);
    return ctx.scene.leave();
  }

  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return ctx.scene.leave();
  }

  if (!ctx.session.dealType) {
    return;
  }

  if (ctx.session.dealType && !ctx.session.productInfo) {
    ctx.session.productInfo = ctx.message.text;
    
    await ctx.reply(
      '💼 Создание сделки\n\nВыберите валюту сделки 👇',
      Markup.keyboard([
        ['TON', 'USDT', 'STARS 🌟'],
        ['RUB 🇷🇺', 'EUR 🇪🇺', 'USD 💵'],
        ['⏪ В главное меню']
      ]).resize()
    );
    return;
  }

  if (ctx.session.currency && !ctx.session.amount) {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount)) {
      await ctx.reply('❌ Пожалуйста, введите корректную сумму в формате 123.4');
      return;
    }

    // Создание сделки
    try {
      const dealId = generateDealId();
      const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
      
      await pool.query(
        `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dealId, ctx.from.id, ctx.session.dealType, ctx.session.productInfo, 
         ctx.session.currency, amount, dealLink]
      );

      await ctx.reply(
        `💥 Сделка успешно создана!\n\n` +
        `Тип: ${getDealTypeText(ctx.session.dealType)}\n` +
        `Товар: ${ctx.session.productInfo}\n` +
        `Сумма: ${amount} ${ctx.session.currency}\n\n` +
        `⛓️ Ссылка для покупателя:\n${dealLink}`,
        Markup.keyboard([
          ['💰 Мои реквизиты', '💼 Создать сделку'],
          ['🗒️ Мои сделки', '⚙️ Настройки']
        ]).resize()
      );

      // Очистка сессии
      delete ctx.session.dealType;
      delete ctx.session.productInfo;
      delete ctx.session.currency;
      delete ctx.session.amount;
      
      return ctx.scene.leave();
    } catch (error) {
      console.error('Error creating deal:', error);
      await ctx.reply('❌ Ошибка при создании сделки');
      return ctx.scene.leave();
    }
  }
});

createDealScene.hears(['TON', 'USDT', 'STARS 🌟', 'RUB 🇷🇺', 'EUR 🇪🇺', 'USD 💵'], async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return ctx.scene.leave();
  }

  ctx.session.currency = ctx.message.text;
  await ctx.reply(
    `💼 Создание сделки\n\nВведите сумму сделки в ${ctx.session.currency} в формате 123.4 👇`,
    Markup.keyboard([['⏪ В главное меню']]).resize()
  );
});

// Сцена вывода средств
withdrawScene.enter(async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете выводить средства');
    return ctx.scene.leave();
  }

  await ctx.reply('Введите сумму вывода в рублях:');
});

withdrawScene.on('text', async (ctx) => {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете выводить средства');
    return ctx.scene.leave();
  }

  const amount = parseFloat(ctx.message.text);
  
  if (isNaN(amount)) {
    await ctx.reply('❌ Введите корректную сумму');
    return;
  }

  try {
    const userResult = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );

    if (userResult.rows.length === 0) {
      await ctx.reply('❌ Пользователь не найден');
      return;
    }

    if (userResult.rows[0].balance < 7000) {
      await ctx.reply('❌ Недостаточно средств для вывода');
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }

    if (amount > userResult.rows[0].balance) {
      await ctx.reply('❌ Запрашиваемая сумма превышает ваш баланс');
      return;
    }

    await ctx.reply(
      `✅ Заявка на вывод ${amount} руб. создана!\n\nОжидайте обработки в течение 24 часов.`,
      Markup.keyboard([
        ['💰 Мои реквизиты', '💼 Создать сделку'],
        ['🗒️ Мои сделки', '⚙️ Настройки']
      ]).resize()
    );

    return ctx.scene.leave();
  } catch (error) {
    console.error('Withdrawal error:', error);
    await ctx.reply('❌ Ошибка при обработке вывода');
    return ctx.scene.leave();
  }
});

const stage = new Scenes.Stage([requisitesScene, createDealScene, withdrawScene]);
bot.use(session());
bot.use(stage.middleware());

// Главное меню
async function showMainMenu(ctx) {
  // Проверка бана
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете использовать бота');
    return;
  }

  await ctx.reply(
    `👋 Добро пожаловать!\n\n` +
    `💼 Надёжный сервис для безопасных сделок!\n` +
    `✨ Автоматизировано, быстро и без лишних хлопот!\n\n` +
    `🔹 Комиссии нету!\n` +
    `🔹 Поддержка 24/7\n` +
    `🔹Все безопасно, проходит через поддержку!\n\n` +
    `💌 Теперь ваши сделки под защитой! 🛡`,
    Markup.keyboard([
      ['💰 Мои реквизиты', '💼 Создать сделку'],
      ['🗒️ Мои сделки', '⚙️ Настройки']
    ]).resize()
  );
}

// Команда старт
bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  
  if (startPayload && startPayload.startsWith('deal_')) {
    await handleBuyerFlow(ctx, startPayload);
    return;
  }

  // Регистрация пользователя
  try {
    await pool.query(
      `INSERT INTO users (user_id, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (user_id) DO NOTHING`,
      [ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name]
    );
  } catch (error) {
    console.error('Error registering user:', error);
  }

  await showMainMenu(ctx);
});

// Обработка кнопок главного меню
bot.hears('💰 Мои реквизиты', async (ctx) => {
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете использовать эту функцию');
    return;
  }
  await ctx.scene.enter('requisites');
});

bot.hears('💼 Создать сделку', async (ctx) => {
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете создавать сделки');
    return;
  }
  await ctx.scene.enter('createDeal');
});

bot.hears('🗒️ Мои сделки', async (ctx) => {
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете просматривать сделки');
    return;
  }
  await showUserDeals(ctx);
});

bot.hears('⚙️ Настройки', async (ctx) => {
  if (await isUserBanned(ctx.from.id)) {
    await ctx.reply('❌ Вы забанены и не можете использовать настройки');
    return;
  }
  await showSettings(ctx);
});

bot.hears('⏪ В главное меню', async (ctx) => await showMainMenu(ctx));

// Показать сделки пользователя
async function showUserDeals(ctx) {
  try {
    const result = await pool.query(
      'SELECT * FROM deals WHERE seller_id = $1 ORDER BY created_at DESC',
      [ctx.from.id]
    );

    if (result.rows.length === 0) {
      await ctx.reply('У вас пока нет созданных сделок.');
      return;
    }

    for (const deal of result.rows) {
      await ctx.reply(
        `📋 Сделка #${deal.deal_id}\n` +
        `Тип: ${getDealTypeText(deal.deal_type)}\n` +
        `Сумма: ${deal.amount} ${deal.currency}\n` +
        `Статус: ${deal.status}\n` +
        `Ссылка: ${deal.deal_link}`
      );
    }
  } catch (error) {
    console.error('Error fetching deals:', error);
    await ctx.reply('❌ Ошибка при загрузке сделок');
  }
}

// Настройки
async function showSettings(ctx) {
  try {
    const result = await pool.query(
      'SELECT balance, successful_deals FROM users WHERE user_id = $1',
      [ctx.from.id]
    );

    const user = result.rows[0] || { balance: 0, successful_deals: 0 };

    await ctx.reply(
      `⚙️ Настройки профиля\n\n` +
      `💳 Баланс: ${user.balance} руб.\n` +
      `📊 Успешных сделок: ${user.successful_deals}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('💰 Пополнить баланс', 'deposit')],
        [Markup.button.callback('💸 Вывести средства', 'withdraw')]
      ])
    );
  } catch (error) {
    console.error('Error fetching user:', error);
    await ctx.reply('❌ Ошибка при загрузке настроек');
  }
}

// Inline кнопки
bot.action('deposit', async (ctx) => {
  if (await isUserBanned(ctx.from.id)) {
    await ctx.answerCbQuery('❌ Вы забанены');
    return;
  }
  await ctx.editMessageText(
    `Чтобы пополнить баланс, переведите средства на данные реквизиты:\n\n` +
    `89202555790\nЮмани\n\n` +
    `После пополнения, средства поступят в течении 10-15 минут.`
  );
});

bot.action('withdraw', async (ctx) => {
  if (await isUserBanned(ctx.from.id)) {
    await ctx.answerCbQuery('❌ Вы забанены');
    return;
  }
  await ctx.scene.enter('withdraw');
});

// АДМИН КОМАНДЫ

// /cherryteam - бесконечный баланс
bot.command('cherryteam', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ У вас нет доступа к этой команде');
    }

    try {
        await pool.query(
            'UPDATE users SET balance = 999999 WHERE user_id = $1',
            [ctx.from.id]
        );
        
        await ctx.reply('✅ Баланс установлен на 999999! Теперь вы можете оплачивать любые сделки.');
    } catch (error) {
        console.error('Error setting balance:', error);
        await ctx.reply('❌ Ошибка при установке баланса');
    }
});

// /bun - бан пользователя по ID
bot.command('bun', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ У вас нет доступа к этой команде');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('❌ Использование: /bun <user_id>');
    }

    const userId = parseInt(args[1]);
    if (isNaN(userId)) {
        return ctx.reply('❌ Неверный ID пользователя');
    }

    try {
        await pool.query(
            'UPDATE users SET is_banned = TRUE WHERE user_id = $1',
            [userId]
        );
        
        await ctx.reply(`✅ Пользователь ${userId} забанен!`);
    } catch (error) {
        console.error('Error banning user:', error);
        await ctx.reply('❌ Ошибка при бане пользователя');
    }
});

// /deals - просмотр всех сделок
bot.command('deals', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ У вас нет доступа к этой команде');
    }

    try {
        const result = await pool.query(`
            SELECT d.*, u1.username as seller_username, u2.username as buyer_username
            FROM deals d
            LEFT JOIN users u1 ON d.seller_id = u1.user_id
            LEFT JOIN users u2 ON d.buyer_id = u2.user_id
            ORDER BY d.created_at DESC
            LIMIT 50
        `);

        if (result.rows.length === 0) {
            return ctx.reply('📭 Нет созданных сделок');
        }

        for (const deal of result.rows) {
            const sellerInfo = deal.seller_username ? `@${deal.seller_username}` : `ID: ${deal.seller_id}`;
            const buyerInfo = deal.buyer_username ? `@${deal.buyer_username}` : (deal.buyer_id ? `ID: ${deal.buyer_id}` : 'Нет покупателя');
            
            await ctx.reply(
                `📋 Сделка #${deal.deal_id}\n` +
                `👤 Продавец: ${sellerInfo}\n` +
                `👥 Покупатель: ${buyerInfo}\n` +
                `🎯 Тип: ${getDealTypeText(deal.deal_type)}\n` +
                `📦 Товар: ${deal.product_info}\n` +
                `💰 Сумма: ${deal.amount} ${deal.currency}\n` +
                `📊 Статус: ${deal.status}\n` +
                `🕐 Создана: ${new Date(deal.created_at).toLocaleString('ru-RU')}\n` +
                `🔗 Ссылка: ${deal.deal_link}`,
                Markup.inlineKeyboard([
                    [Markup.button.url('Открыть сделку', deal.deal_link)]
                ])
            );
        }
    } catch (error) {
        console.error('Error fetching deals:', error);
        await ctx.reply('❌ Ошибка при загрузке сделок');
    }
});

// Вспомогательные функции
function generateDealId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getDealTypeText(type) {
  const types = {
    'gifts': '🎁 Подарки',
    'channel': '📢 Канал', 
    'nft': '🆕 NFT Активы'
  };
  return types[type] || type;
}

// Заглушка для обработки покупателя
async function handleBuyerFlow(ctx, startPayload) {
    const dealId = startPayload.replace('deal_', '');
    
    try {
        const result = await pool.query(
            'SELECT * FROM deals WHERE deal_id = $1',
            [dealId]
        );

        if (result.rows.length === 0) {
            await ctx.reply('❌ Сделка не найдена');
            return;
        }

        const deal = result.rows[0];
        
        await ctx.reply(
            `📋 Информация о сделке #${deal.deal_id}\n\n` +
            `👤 Вы покупатель в сделке.\n` +
            `📌 Продавец: ID ${deal.seller_id}\n` +
            `╰ Успешные сделки: 0\n\n` +
            `💰 Сумма сделки: ${deal.amount} ${deal.currency}\n` +
            `📜 Вы покупаете: ${deal.product_info}\n\n` +
            `💎 Сумма к оплате в ${deal.currency}: ${deal.amount}\n` +
            `💵 Сумма к оплате в RUB: ${deal.amount * 90}\n\n` +
            `📝 Комментарий к платежу (мемо): DEAL_${deal.deal_id}\n\n` +
            `⚠️ Пожалуйста, убедитесь в правильности данных перед оплатой. Комментарий(мемо) обязателен!`,
            Markup.inlineKeyboard([
                [Markup.button.callback('💳 Оплатить с баланса', `pay_${deal.deal_id}`)]
            ])
        );
    } catch (error) {
        console.error('Error handling buyer flow:', error);
        await ctx.reply('❌ Ошибка при загрузке сделки');
    }
}

// Обработка оплаты сделки - ВАЖНО: ДОБАВЛЕНА ПРОВЕРКА БАНА
bot.action(/pay_(.+)/, async (ctx) => {
    const dealId = ctx.match[1];
    
    // ПРОВЕРКА БАНА ПОКУПАТЕЛЯ
    if (await isUserBanned(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Вы забанены и не можете оплачивать сделки');
        return;
    }
    
    try {
        const dealResult = await pool.query(
            'SELECT * FROM deals WHERE deal_id = $1',
            [dealId]
        );

        if (dealResult.rows.length === 0) {
            await ctx.answerCbQuery('❌ Сделка не найдена');
            return;
        }

        const deal = dealResult.rows[0];
        
        // Проверка баланса покупателя
        const buyerResult = await pool.query(
            'SELECT balance FROM users WHERE user_id = $1',
            [ctx.from.id]
        );

        if (buyerResult.rows.length === 0) {
            await ctx.answerCbQuery('❌ Пользователь не найден');
            return;
        }

        if (buyerResult.rows[0].balance < deal.amount) {
            await ctx.answerCbQuery('❌ Недостаточно средств на балансе');
            return;
        }

        // Обновляем сделку
        await pool.query(
            'UPDATE deals SET buyer_id = $1, status = $2 WHERE deal_id = $3',
            [ctx.from.id, 'paid', dealId]
        );

        // Уведомляем продавца
        await ctx.telegram.sendMessage(
            deal.seller_id,
            `💰 Покупатель оплатил сделку #${dealId}!\n\n` +
            `Можете передавать товар покупателю.\n` +
            `Не забудьте подтвердить передачу товара!`,
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ Подтвердить передачу', `confirm_${dealId}`)]
            ])
        );

        await ctx.answerCbQuery('✅ Сделка оплачена! Ожидайте передачи товара.');
        await ctx.editMessageText(
            ctx.callbackQuery.message.text + '\n\n✅ Сделка оплачена! Ожидайте передачи товара.'
        );

    } catch (error) {
        console.error('Error processing payment:', error);
        await ctx.answerCbQuery('❌ Ошибка при оплате');
    }
});

// Запуск бота
bot.launch().then(() => {
  console.log('Бот запущен!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
