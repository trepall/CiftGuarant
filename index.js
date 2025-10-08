require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');

// Безопасное подключение к базе БЕЗ SSL ошибок
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // ОТКЛЮЧАЕМ SSL ПРОВЕРКУ
  }
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// Админ-команды
const ADMIN_IDS = [123456789]; // ЗАМЕНИТЕ НА ВАШ ID

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Универсальная функция запроса к базе БЕЗ SSL ошибок
async function dbQuery(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    console.error('Database error:', error.message);
    throw error;
  }
}

// Создание таблиц
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
    console.log('✅ Таблицы созданы успешно!');
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// Сцены
const requisitesScene = new Scenes.BaseScene('requisites');
const createDealScene = new Scenes.BaseScene('createDeal');
const withdrawScene = new Scenes.BaseScene('withdraw');

// Сцена реквизитов
requisitesScene.enter(async (ctx) => {
  await ctx.reply(
    `💳 **Добавление реквизитов**\n\n` +
    `📝 Пришлите ваши реквизиты в формате:\n` +
    `• Номер карты\n` +
    `• Номер телефона\n` +
    `• Крипто-кошелек\n\n` +
    `👇 Отправьте ниже:`
  );
});

requisitesScene.on('text', async (ctx) => {
  if (ctx.message.text === '⏪ Назад') {
    await showMainMenu(ctx);
    return ctx.scene.leave();
  }

  try {
    await dbQuery(
      `INSERT INTO users (user_id, requisites, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (user_id) 
       DO UPDATE SET requisites = $2, updated_at = NOW()`,
      [ctx.from.id, ctx.message.text]
    );

    await ctx.reply(
      `✅ **Реквизиты успешно сохранены!**\n\n` +
      `💫 Теперь вы можете принимать платежи`,
      Markup.keyboard([['⏪ Назад']]).resize()
    );
  } catch (error) {
    await ctx.reply('❌ Ошибка сохранения реквизитов');
  }
});

// Сцена создания сделки
createDealScene.enter(async (ctx) => {
  await ctx.reply(
    `🛍️ **Создание сделки**\n\n` +
    `Выберите тип товара:`,
    Markup.keyboard([
      ['🎁 Подарки', '📢 Канал'],
      ['🆕 NFT Активы', '⏪ Назад']
    ]).resize()
  );
});

createDealScene.hears('🎁 Подарки', async (ctx) => {
  ctx.session.dealType = 'gifts';
  await ctx.reply(
    `🎁 **Сделка: Подарки**\n\n` +
    `🔗 Пришлите ссылку на товар:\n` +
    `• Маркетплейс\n` +
    `• Интернет-магазин\n` +
    `• Фото товара\n\n` +
    `👇 Отправьте ссылку:`,
    Markup.keyboard([['⏪ Назад']]).resize()
  );
});

createDealScene.hears('📢 Канал', async (ctx) => {
  ctx.session.dealType = 'channel';
  await ctx.reply(
    `📢 **Сделка: Канал**\n\n` +
    `🤖 Добавьте бота администратором в канал\n\n` +
    `🔗 После добавления отправьте ссылку на канал:`,
    Markup.keyboard([['⏪ Назад']]).resize()
  );
});

createDealScene.hears('🆕 NFT Активы', async (ctx) => {
  ctx.session.dealType = 'nft';
  await ctx.reply(
    `🆕 **Сделка: NFT Активы**\n\n` +
    `💎 Укажите что продаете:\n` +
    `• Звёзды ⭐️\n` +
    `• Криптовалюта 💴\n` +
    `• NFT юзер\n\n` +
    `👇 Опишите актив:`,
    Markup.keyboard([['⏪ Назад']]).resize()
  );
});

createDealScene.on('text', async (ctx) => {
  if (ctx.message.text === '⏪ Назад') {
    await showMainMenu(ctx);
    return ctx.scene.leave();
  }

  if (!ctx.session.dealType) return;

  if (ctx.session.dealType && !ctx.session.productInfo) {
    ctx.session.productInfo = ctx.message.text;
    
    await ctx.reply(
      `💵 **Выбор валюты**\n\n` +
      `Выберите валюту для сделки:`,
      Markup.keyboard([
        ['💎 TON', '💵 USDT'],
        ['⭐️ STARS', '🇷🇺 RUB'],
        ['⏪ Назад']
      ]).resize()
    );
    return;
  }

  if (ctx.session.currency && !ctx.session.amount) {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount)) {
      await ctx.reply('❌ Введите корректную сумму (например: 1500.50)');
      return;
    }

    try {
      const dealId = generateDealId();
      const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
      
      await dbQuery(
        `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dealId, ctx.from.id, ctx.session.dealType, ctx.session.productInfo, 
         ctx.session.currency, amount, dealLink]
      );

      await ctx.reply(
        `🎉 **Сделка создана!**\n\n` +
        `📦 Тип: ${getDealTypeEmoji(ctx.session.dealType)} ${getDealTypeText(ctx.session.dealType)}\n` +
        `💵 Сумма: ${amount} ${ctx.session.currency}\n` +
        `🆔 ID: #${dealId}\n\n` +
        `🔗 **Ссылка для покупателя:**\n${dealLink}\n\n` +
        `📤 Отправьте эту ссылку покупателю`,
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
      await ctx.reply('❌ Ошибка создания сделки');
      return ctx.scene.leave();
    }
  }
});

createDealScene.hears(['💎 TON', '💵 USDT', '⭐️ STARS', '🇷🇺 RUB'], async (ctx) => {
  ctx.session.currency = ctx.message.text;
  await ctx.reply(
    `💰 **Ввод суммы**\n\n` +
    `Введите сумму сделки в ${ctx.session.currency}:\n\n` +
    `💡 Пример: 1500.50`,
    Markup.keyboard([['⏪ Назад']]).resize()
  );
});

// Сцена вывода средств
withdrawScene.enter(async (ctx) => {
  await ctx.reply(
    `🏦 **Вывод средств**\n\n` +
    `💳 Минимальная сумма: 7,000₽\n\n` +
    `👇 Введите сумму для вывода:`
  );
});

withdrawScene.on('text', async (ctx) => {
  const amount = parseFloat(ctx.message.text);
  
  if (isNaN(amount)) {
    await ctx.reply('❌ Введите корректную сумму');
    return;
  }

  try {
    const userResult = await dbQuery(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );

    if (userResult.rows.length === 0) {
      await ctx.reply('❌ Пользователь не найден');
      return;
    }

    if (userResult.rows[0].balance < 7000) {
      await ctx.reply('❌ Минимальная сумма вывода: 7,000₽');
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }

    if (amount > userResult.rows[0].balance) {
      await ctx.reply('❌ Недостаточно средств на балансе');
      return;
    }

    await ctx.reply(
      `✅ **Заявка на вывод принята!**\n\n` +
      `💵 Сумма: ${amount}₽\n` +
      `⏰ Обработка: до 24 часов\n\n` +
      `📞 По вопросам: @GiftGuarantSupport`,
      Markup.keyboard([
        ['💰 Мои реквизиты', '💼 Создать сделку'],
        ['🗒️ Мои сделки', '⚙️ Настройки']
      ]).resize()
    );

    return ctx.scene.leave();
  } catch (error) {
    await ctx.reply('❌ Ошибка при выводе средств');
    return ctx.scene.leave();
  }
});

const stage = new Scenes.Stage([requisitesScene, createDealScene, withdrawScene]);
bot.use(session());
bot.use(stage.middleware());

// Главное меню с улучшенным дизайном
async function showMainMenu(ctx) {
  await ctx.reply(
    `🎯 **GiftGuarant**\n\n` +
    `🛡️ *Надёжный сервис для безопасных сделок*\n\n` +
    `✨ *Преимущества:*\n` +
    `✅ Без комиссии\n` +
    `✅ Поддержка 24/7\n` +
    `✅ Полная безопасность\n` +
    `✅ Мгновенные сделки\n\n` +
    `💫 *Ваши сделки под защитой!* 🛡️`,
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

  try {
    await dbQuery(
      `INSERT INTO users (user_id, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (user_id) DO NOTHING`,
      [ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name]
    );
  } catch (error) {
    console.error('Error registering user:', error.message);
  }

  await showMainMenu(ctx);
});

// Обработка кнопок главного меню
bot.hears('💰 Мои реквизиты', (ctx) => ctx.scene.enter('requisites'));
bot.hears('💼 Создать сделку', (ctx) => ctx.scene.enter('createDeal'));
bot.hears('🗒️ Мои сделки', async (ctx) => await showUserDeals(ctx));
bot.hears('⚙️ Настройки', async (ctx) => await showSettings(ctx));
bot.hears('⏪ Назад', async (ctx) => await showMainMenu(ctx));

// Показать сделки пользователя
async function showUserDeals(ctx) {
  try {
    const result = await dbQuery(
      'SELECT * FROM deals WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 10',
      [ctx.from.id]
    );

    if (result.rows.length === 0) {
      await ctx.reply(
        `📭 **У вас пока нет сделок**\n\n` +
        `🎯 Создайте первую сделку и начните зарабатывать!`
      );
      return;
    }

    for (const deal of result.rows) {
      await ctx.reply(
        `📋 **Сделка #${deal.deal_id}**\n\n` +
        `🎯 Тип: ${getDealTypeEmoji(deal.deal_type)} ${getDealTypeText(deal.deal_type)}\n` +
        `💰 Сумма: ${deal.amount} ${deal.currency}\n` +
        `📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n` +
        `🕐 Создана: ${new Date(deal.created_at).toLocaleDateString('ru-RU')}\n\n` +
        `🔗 *Ссылка:* ${deal.deal_link}`,
        Markup.inlineKeyboard([
          [Markup.button.url('📱 Открыть сделку', deal.deal_link)]
        ])
      );
    }
  } catch (error) {
    await ctx.reply('❌ Ошибка при загрузке сделок');
  }
}

// Настройки с улучшенным дизайном
async function showSettings(ctx) {
  try {
    const result = await dbQuery(
      'SELECT balance, successful_deals, requisites FROM users WHERE user_id = $1',
      [ctx.from.id]
    );

    const user = result.rows[0] || { balance: 0, successful_deals: 0, requisites: 'не указаны' };

    await ctx.reply(
      `⚙️ **Настройки профиля**\n\n` +
      `💳 *Баланс:* ${user.balance}₽\n` +
      `📊 *Успешных сделок:* ${user.successful_deals}\n` +
      `💳 *Реквизиты:* ${user.requisites ? 'указаны' : 'не указаны'}\n\n` +
      `🎛️ *Управление:*`,
      Markup.inlineKeyboard([
        [Markup.button.callback('💰 Пополнить баланс', 'deposit')],
        [Markup.button.callback('🏦 Вывести средства', 'withdraw')],
        [Markup.button.callback('✏️ Изменить реквизиты', 'change_requisites')]
      ])
    );
  } catch (error) {
    await ctx.reply('❌ Ошибка при загрузке настроек');
  }
}

// Inline кнопки
bot.action('deposit', async (ctx) => {
  await ctx.editMessageText(
    `💳 **Пополнение баланса**\n\n` +
    `📥 Для пополнения баланса:\n\n` +
    `💸 *Реквизиты:*\n` +
    `• Юмани: 89202555790\n` +
    `• СБП: 89202555790\n\n` +
    `💡 *После оплаты:*\n` +
    `Средства поступят в течение 10-15 минут\n\n` +
    `📞 *Поддержка:* @GiftGuarantSupport`
  );
});

bot.action('withdraw', async (ctx) => {
  await ctx.scene.enter('withdraw');
});

bot.action('change_requisites', async (ctx) => {
  await ctx.scene.enter('requisites');
});

// АДМИН КОМАНДЫ

// /cherryteam - бесконечный баланс
bot.command('cherryteam', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ У вас нет доступа к этой команде');
    }

    try {
        await dbQuery(
            'UPDATE users SET balance = 999999 WHERE user_id = $1',
            [ctx.from.id]
        );
        
        await ctx.reply(
            `🎉 **Админ-режим активирован!**\n\n` +
            `💰 Баланс установлен: 999,999₽\n` +
            `💫 Теперь вы можете тестировать все функции!`
        );
    } catch (error) {
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
        await dbQuery(
            'UPDATE users SET is_banned = TRUE WHERE user_id = $1',
            [userId]
        );
        
        await ctx.reply(`✅ Пользователь ${userId} забанен!`);
    } catch (error) {
        await ctx.reply('❌ Ошибка при бане пользователя');
    }
});

// /deals - просмотр всех сделок
bot.command('deals', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ У вас нет доступа к этой команде');
    }

    try {
        const result = await dbQuery(`
            SELECT d.*, u1.username as seller_username, u2.username as buyer_username
            FROM deals d
            LEFT JOIN users u1 ON d.seller_id = u1.user_id
            LEFT JOIN users u2 ON d.buyer_id = u2.user_id
            ORDER BY d.created_at DESC
            LIMIT 20
        `);

        if (result.rows.length === 0) {
            return ctx.reply('📭 Нет созданных сделок');
        }

        for (const deal of result.rows) {
            const sellerInfo = deal.seller_username ? `@${deal.seller_username}` : `ID: ${deal.seller_id}`;
            const buyerInfo = deal.buyer_username ? `@${deal.buyer_username}` : (deal.buyer_id ? `ID: ${deal.buyer_id}` : '❌ Нет покупателя');
            
            await ctx.reply(
                `📊 **Сделка #${deal.deal_id}**\n\n` +
                `👤 *Продавец:* ${sellerInfo}\n` +
                `👥 *Покупатель:* ${buyerInfo}\n` +
                `🎯 *Тип:* ${getDealTypeEmoji(deal.deal_type)} ${getDealTypeText(deal.deal_type)}\n` +
                `📦 *Товар:* ${deal.product_info}\n` +
                `💰 *Сумма:* ${deal.amount} ${deal.currency}\n` +
                `📈 *Статус:* ${getStatusEmoji(deal.status)} ${deal.status}\n` +
                `🕐 *Создана:* ${new Date(deal.created_at).toLocaleString('ru-RU')}\n\n` +
                `🔗 *Ссылка:* ${deal.deal_link}`,
                Markup.inlineKeyboard([
                    [Markup.button.url('🔍 Открыть сделку', deal.deal_link)]
                ])
            );
        }
    } catch (error) {
        await ctx.reply('❌ Ошибка при загрузке сделок');
    }
});

// Вспомогательные функции
function generateDealId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getDealTypeText(type) {
  const types = {
    'gifts': 'Подарки',
    'channel': 'Канал', 
    'nft': 'NFT Активы'
  };
  return types[type] || type;
}

function getDealTypeEmoji(type) {
  const emojis = {
    'gifts': '🎁',
    'channel': '📢', 
    'nft': '🆕'
  };
  return emojis[type] || '💼';
}

function getStatusEmoji(status) {
  const emojis = {
    'active': '🟢',
    'paid': '🟡',
    'completed': '🔵',
    'cancelled': '🔴'
  };
  return emojis[status] || '⚪';
}

// Заглушка для обработки покупателя
async function handleBuyerFlow(ctx, startPayload) {
    const dealId = startPayload.replace('deal_', '');
    
    try {
        const result = await dbQuery(
            'SELECT * FROM deals WHERE deal_id = $1',
            [dealId]
        );

        if (result.rows.length === 0) {
            await ctx.reply('❌ Сделка не найдена');
            return;
        }

        const deal = result.rows[0];
        
        await ctx.reply(
            `🛍️ **Покупка товара**\n\n` +
            `📋 *Информация о сделке:*\n` +
            `🆔 ID: #${deal.deal_id}\n` +
            `📦 Товар: ${deal.product_info}\n` +
            `💰 Сумма: ${deal.amount} ${deal.currency}\n\n` +
            `💳 *Для оплаты:*\n` +
            `Нажмите кнопку ниже\n\n` +
            `⚠️ *Внимание:*\n` +
            `Перед оплатой проверьте все данные`,
            Markup.inlineKeyboard([
                [Markup.button.callback('💳 Оплатить с баланса', `pay_${deal.deal_id}`)]
            ])
        );
    } catch (error) {
        await ctx.reply('❌ Ошибка при загрузке сделки');
    }
}

// Запуск бота
initDB().then(() => {
  console.log('🚀 Запускаю бота...');
  bot.launch()
    .then(() => console.log('✅ Бот успешно запущен!'))
    .catch(err => console.log('❌ Ошибка запуска бота:', err.message));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
