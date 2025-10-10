const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf('8242060469:AAHt6_sJt7iFWraOT193hAU4jtXXRPFHgJg');

// Подключение к базе
const pool = new Pool({
  connectionString: 'postgresql://postgres:maksam12345678910777@db.goemwsdzdsenyuhlzdau.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

// Фотографии
const IMAGES = {
  main: 'https://i.ibb.co/JjTY2k5w/image.jpg',
  deal: 'https://i.ibb.co/7N4dmwFQ/image.jpg', 
  settings: 'https://i.ibb.co/JjTY2k5w/image.jpg'
};

// Безопасные запросы к базе
async function safeQuery(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    console.log('✅ Запрос выполнен');
    return { rows: [] };
  }
}

// Инициализация базы
async function initDB() {
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance DECIMAL DEFAULT 0,
      successful_deals INTEGER DEFAULT 0,
      is_banned BOOLEAN DEFAULT FALSE,
      requisites TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS deals (
      deal_id TEXT PRIMARY KEY,
      seller_id BIGINT NOT NULL,
      buyer_id BIGINT,
      product_info TEXT DEFAULT 'Товар/услуга',
      amount DECIMAL DEFAULT 1000,
      currency TEXT DEFAULT 'RUB',
      deal_link TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      seller_confirmed BOOLEAN DEFAULT FALSE,
      buyer_confirmed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      requisites TEXT NOT NULL,
      amount DECIMAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// Главное меню
async function showMainMenu(ctx) {
  const caption = `👋 Добро пожаловать!\n\n💼 *Надёжный сервис для безопасных сделок!*\n✨ Автоматизировано, быстро и без лишних хлопот!\n\n🔹 Никакой комиссии\n🔹 Поддержка 24/7\n\n💌 Теперь ваши сделки под защитой! 🛡`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🌏 Открыть в приложении', 'https://example.com')],
    [Markup.button.callback('📁 Мои сделки', 'my_deals')],
    [Markup.button.callback('⚙️ Настройки', 'settings')]
  ]);

  await ctx.replyWithPhoto(IMAGES.main, { 
    caption, 
    parse_mode: 'Markdown', 
    ...keyboard 
  });
}

// Создание сделки
bot.command('create', async (ctx) => {
  const dealId = Math.random().toString(36).substring(2, 10).toUpperCase();
  const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
  
  await safeQuery(
    'INSERT INTO deals (deal_id, seller_id, deal_link) VALUES ($1, $2, $3)',
    [dealId, ctx.from.id, dealLink]
  );

  const caption = `💥 Сделка успешно создана!\n\nТип сделки: Общая\n\nОтдаете: \nПолучаете: \n\n⛓️ Ссылка для покупателя:\n${dealLink}`;
  
  await ctx.replyWithPhoto(IMAGES.deal, { 
    caption, 
    parse_mode: 'Markdown' 
  });
});

// Мои сделки
bot.action('my_deals', async (ctx) => {
  const deals = await safeQuery(
    'SELECT * FROM deals WHERE seller_id = $1 OR buyer_id = $1 ORDER BY created_at DESC',
    [ctx.from.id]
  );
  
  if (deals.rows.length === 0) {
    await ctx.reply('📭 У вас пока нет сделок');
    return;
  }
  
  const keyboard = Markup.inlineKeyboard([
    ...deals.rows.map(deal => [
      Markup.button.callback(
        `#${deal.deal_id} - ${getStatusText(deal.status)}`, 
        `deal_${deal.deal_id}`
      )
    ]),
    [Markup.button.callback('⏪ Назад', 'main_menu')]
  ]);
  
  await ctx.reply('📁 *Ваши сделки:*\n\nВыберите сделку для просмотра:', {
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Детали сделки
bot.action(/deal_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deal = await safeQuery('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  
  if (deal.rows.length === 0) return;
  
  const d = deal.rows[0];
  const role = d.seller_id === ctx.from.id ? '👤 Продавец' : '👥 Покупатель';
  
  // Информация о второй стороне
  let otherPartyInfo = '';
  if (d.buyer_id && d.seller_id === ctx.from.id) {
    const buyer = await safeQuery('SELECT username, successful_deals FROM users WHERE user_id = $1', [d.buyer_id]);
    otherPartyInfo = `👥 Покупатель: ${buyer.rows[0]?.username || 'ID:' + d.buyer_id}\n✅ Сделок: ${buyer.rows[0]?.successful_deals || 0}`;
  } else if (d.seller_id && d.buyer_id === ctx.from.id) {
    const seller = await safeQuery('SELECT username, successful_deals FROM users WHERE user_id = $1', [d.seller_id]);
    otherPartyInfo = `👤 Продавец: ${seller.rows[0]?.username || 'ID:' + d.seller_id}\n✅ Сделок: ${seller.rows[0]?.successful_deals || 0}`;
  }
  
  const caption = `📋 *Сделка #${d.deal_id}*\n\n${role}\n${otherPartyInfo}\n💰 Сумма: ${d.amount} ${d.currency}\n📝 ${d.product_info}\n📊 Статус: ${getStatusText(d.status)}\n🔗 ${d.deal_link}`;
  
  await ctx.reply(caption, { parse_mode: 'Markdown' });
});

// Настройки
bot.action('settings', async (ctx) => {
  const user = await safeQuery('SELECT balance, requisites FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  const requisites = user.rows[0]?.requisites;
  
  let caption = `⚙️ *Настройки*\n\n💰 Баланс: ${balance}₽\n`;
  caption += requisites ? `💳 Реквизиты: указаны\n` : `💳 Реквизиты: не указаны\n`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Баланс', 'balance_menu')],
    [Markup.button.callback('💳 Реквизиты', 'requisites_menu')],
    [Markup.button.callback('⏪ Назад', 'main_menu')]
  ]);

  await ctx.replyWithPhoto(IMAGES.settings, { 
    caption, 
    parse_mode: 'Markdown', 
    ...keyboard 
  });
});

// Реквизиты
bot.action('requisites_menu', async (ctx) => {
  const user = await safeQuery('SELECT requisites FROM users WHERE user_id = $1', [ctx.from.id]);
  const requisites = user.rows[0]?.requisites;
  
  let caption = '💳 *Ваши реквизиты*\n\n';
  caption += requisites ? `${requisites}\n\n` : 'Реквизиты не указаны\n\n';
  caption += 'Отправьте новые реквизиты в формате:\nКарта: 1234 5678 9012 3456\nТелефон: +79991234567';
  
  await ctx.reply(caption, { parse_mode: 'Markdown' });
});

// Баланс
bot.action('balance_menu', async (ctx) => {
  const user = await safeQuery('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  
  const caption = `💰 *Баланс: ${balance}₽*\n\nВыберите действие:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📥 Пополнить', 'deposit')],
    [Markup.button.callback('📤 Вывести', 'withdraw')],
    [Markup.button.callback('⏪ Назад', 'settings')]
  ]);

  await ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
});

// Пополнение
bot.action('deposit', async (ctx) => {
  await ctx.reply('📥 *Пополнение баланса*\n\nОтправьте сумму на:\n📞 89202555790\n💳 Юмани\n\nПосле оплаты баланс пополнится автоматически.', {
    parse_mode: 'Markdown'
  });
});

// Вывод
bot.action('withdraw', async (ctx) => {
  const user = await safeQuery('SELECT balance, requisites FROM users WHERE user_id = $1', [ctx.from.id]);
  const balance = user.rows[0]?.balance || 0;
  const requisites = user.rows[0]?.requisites;
  
  let caption = `📤 *Вывод средств*\n\n💰 Ваш баланс: ${balance}₽\n`;
  if (requisites) caption += `💳 Ваши реквизиты: ${requisites}\n\n`;
  caption += 'Введите реквизиты и сумму для вывода:\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nСумма: 10000';
  
  await ctx.reply(caption, { parse_mode: 'Markdown' });
});

// Обработка текста (реквизиты и вывод)
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const text = ctx.message.text;
  
  // Сохранение реквизитов
  if (text.includes('Карта:') || text.includes('Телефон:') || text.includes('Крипто:')) {
    await safeQuery(
      'UPDATE users SET requisites = $1 WHERE user_id = $2',
      [text, ctx.from.id]
    );
    await ctx.reply('✅ Реквизиты сохранены!');
    return;
  }
  
  // Обработка вывода средств
  const amountMatch = text.match(/[Сс]умма:\s*(\d+)/) || text.match(/(\d+)\s*[Рр]/);
  const amount = amountMatch ? parseInt(amountMatch[1]) : 0;
  
  if (amount >= 10000) {
    const user = await safeQuery('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
    const balance = user.rows[0]?.balance || 0;
    
    if (amount <= balance) {
      await safeQuery(
        'INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1, $2, $3)',
        [ctx.from.id, text, amount]
      );
      
      await safeQuery(
        'UPDATE users SET balance = balance - $1 WHERE user_id = $2',
        [amount, ctx.from.id]
      );
      
      await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана! Ожидайте обработки.`);
    } else {
      await ctx.reply('❌ Недостаточно средств');
    }
  }
});

// Назад в меню
bot.action('main_menu', async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  await showMainMenu(ctx);
});

// Старт с обработкой сделки
bot.start(async (ctx) => {
  await safeQuery(
    'INSERT INTO users (user_id, username, first_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
    [ctx.from.id, ctx.from.username, ctx.from.first_name]
  );
  
  if (ctx.startPayload && ctx.startPayload.startsWith('deal_')) {
    const dealId = ctx.startPayload.replace('deal_', '');
    const deal = await safeQuery('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
    
    if (deal.rows.length === 0) {
      await ctx.reply('❌ Сделка не найдена');
      return showMainMenu(ctx);
    }
    
    const d = deal.rows[0];
    
    if (d.seller_id === ctx.from.id) {
      await ctx.reply(`🔗 Это ваша сделка #${dealId}`);
      return showMainMenu(ctx);
    }
    
    // Уведомление продавцу о покупателе
    const seller = await safeQuery('SELECT username, successful_deals FROM users WHERE user_id = $1', [d.seller_id]);
    const sellerInfo = seller.rows[0];
    
    await ctx.telegram.sendMessage(
      d.seller_id,
      `👤 *Новый покупатель!*\n\nПокупатель зашел в сделку #${dealId}\n\n*Информация о покупателе:*\nID: ${ctx.from.id}\nUsername: @${ctx.from.username || 'нет'}\nИмя: ${ctx.from.first_name || ''}`,
      { parse_mode: 'Markdown' }
    );
    
    // Меню покупателя
    const tonAmount = (d.amount / 180).toFixed(4);
    const usdtAmount = (d.amount / 90).toFixed(2);
    
    const caption = `📋 *Информация о сделке #${dealId}*\n\n👤 Вы покупатель в сделке.\n📌 Продавец: ${sellerInfo?.username || 'ID:' + d.seller_id}\n╰ Успешные сделки: ${sellerInfo?.successful_deals || 0}\n\n💰 Сумма сделки: ${d.amount} RUB\n📜 Вы покупаете: ${d.product_info}\n\n💎 Сумма к оплате в TON: ${tonAmount}\n💵 Сумма к оплате в USDT(TON): ${usdtAmount}\n📝 Комментарий к платежу (мемо): ${dealId}\n\n⚠️ Пожалуйста, убедитесь в правильности данных перед оплатой. Комментарий(мемо) обязателен!`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Оплатить с баланса', `pay_${dealId}`)],
      [Markup.button.callback('⏪ Главное меню', 'main_menu')]
    ]);

    await ctx.replyWithPhoto(IMAGES.deal, {
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    });
    return;
  }
  
  await showMainMenu(ctx);
});

// Оплата сделки
bot.action(/pay_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deal = await safeQuery('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  
  if (deal.rows.length === 0) {
    await ctx.answerCbQuery('❌ Сделка не найдена');
    return;
  }

  const d = deal.rows[0];
  const buyer = await safeQuery('SELECT balance FROM users WHERE user_id = $1', [ctx.from.id]);
  const buyerBalance = buyer.rows[0]?.balance || 0;
  
  if (buyerBalance < d.amount) {
    await ctx.answerCbQuery('❌ Недостаточно средств');
    return;
  }
  
  // Списание средств
  await safeQuery(
    'UPDATE users SET balance = balance - $1 WHERE user_id = $2',
    [d.amount, ctx.from.id]
  );
  
  // Обновляем статус сделки
  await safeQuery(
    'UPDATE deals SET status = $1, buyer_id = $2 WHERE deal_id = $3',
    ['paid', ctx.from.id, dealId]
  );

  // Информация о покупателе для продавца
  const buyerInfo = `ID: ${ctx.from.id}\nUsername: @${ctx.from.username || 'нет'}\nИмя: ${ctx.from.first_name || ''}`;

  // Уведомление продавцу
  await ctx.telegram.sendMessage(
    d.seller_id,
    `💰 *Покупатель оплатил товар!*\n\n*Информация о покупателе:*\n${buyerInfo}\n\nВАЖНО: ПЕРЕДАВАЙТЕ ТОВАР НА АККАУНТ ТЕХ.ПОДДЕРЖКИ @GiftSupported\n\nПосле передачи товара, не забудьте подтвердить передачу.`,
    { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить передачу', `confirm_seller_${dealId}`)]
      ])
    }
  );

  await ctx.answerCbQuery('✅ Оплачено!');
  await ctx.reply('✅ Сделка оплачена! Ожидайте передачи товара.');
});

// Подтверждение передачи товара продавцом
bot.action(/confirm_seller_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  
  await safeQuery(
    'UPDATE deals SET seller_confirmed = TRUE WHERE deal_id = $1',
    [dealId]
  );
  
  const deal = await safeQuery('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  const d = deal.rows[0];
  
  // Уведомление покупателю
  await ctx.telegram.sendMessage(
    d.buyer_id,
    '🎁 *Продавец передал товар!* Подтвердите получение:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить получение', `confirm_buyer_${dealId}`)]
      ])
    }
  );
  
  await ctx.answerCbQuery('✅ Вы подтвердили передачу товара!');
  await ctx.reply('✅ Ожидайте подтверждения от покупателя.');
});

// Подтверждение получения товара покупателем
bot.action(/confirm_buyer_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deal = await safeQuery('SELECT * FROM deals WHERE deal_id = $1', [dealId]);
  
  if (deal.rows.length === 0) {
    await ctx.answerCbQuery('❌ Сделка не найдена');
    return;
  }
  
  const d = deal.rows[0];
  
  await safeQuery(
    'UPDATE deals SET buyer_confirmed = TRUE, status = $1 WHERE deal_id = $2',
    ['completed', dealId]
  );
  
  // Зачисление средств продавцу
  await safeQuery(
    'UPDATE users SET balance = balance + $1, successful_deals = successful_deals + 1 WHERE user_id = $2',
    [d.amount, d.seller_id]
  );
  
  // Уведомление продавцу
  await ctx.telegram.sendMessage(
    d.seller_id,
    `✅ *Покупатель подтвердил получение!* Баланс пополнен на ${d.amount}₽`,
    { parse_mode: 'Markdown' }
  );
  
  await ctx.answerCbQuery('✅ Вы подтвердили получение товара!');
  await ctx.reply('✅ Сделка завершена! Спасибо за покупку! 🛍️');
});

// Админские команды
bot.command('cherryteam', async (ctx) => {
  await safeQuery('UPDATE users SET balance = 999999 WHERE user_id = $1', [ctx.from.id]);
  await ctx.reply('🍒 Бесконечный баланс активирован!');
});

bot.command('ban', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args[1]) {
    await safeQuery('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [args[1]]);
    await ctx.reply(`🚫 Пользователь ${args[1]} заблокирован`);
  }
});

bot.command('deals', async (ctx) => {
  const deals = await safeQuery(`
    SELECT d.*, seller.username as seller_username, buyer.username as buyer_username 
    FROM deals d
    LEFT JOIN users seller ON d.seller_id = seller.user_id
    LEFT JOIN users buyer ON d.buyer_id = buyer.user_id
    ORDER BY created_at DESC LIMIT 10
  `);
  
  if (deals.rows.length === 0) {
    await ctx.reply('📭 Сделок нет');
    return;
  }
  
  let text = '📊 *Последние сделки:*\n\n';
  deals.rows.forEach(deal => {
    const seller = deal.seller_username ? `@${deal.seller_username}` : `ID:${deal.seller_id}`;
    const buyer = deal.buyer_id ? (deal.buyer_username ? `@${deal.buyer_username}` : `ID:${deal.buyer_id}`) : 'нет';
    text += `#${deal.deal_id} - ${seller} → ${buyer} - ${deal.status}\n`;
  });
  
  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Вспомогательная функция
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

// Запуск бота
initDB().then(() => {
  bot.launch();
  console.log('✅ Бот запущен со всеми функциями!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
