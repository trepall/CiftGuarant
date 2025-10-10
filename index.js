require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к базе Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Твои фотографии
const IMAGES = {
  main: 'https://i.ibb.co/JjTY2k5w/image.jpg',       // Главное меню
  deal: 'https://i.ibb.co/7N4dmwFQ/image.jpg',       // Сделки
  settings: 'https://i.ibb.co/JjTY2k5w/image.jpg'    // Настройки
};

// Проверка подключения к базе
async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ База данных доступна');
    return true;
  } catch (error) {
    console.error('❌ База данных недоступна:', error.message);
    return false;
  }
}

// Инициализация базы
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        balance DECIMAL(15,2) DEFAULT 0,
        successful_deals INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE,
        requisites TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY,
        deal_id VARCHAR(50) UNIQUE NOT NULL,
        seller_id BIGINT NOT NULL,
        buyer_id BIGINT,
        product_info TEXT,
        amount DECIMAL(15,2) DEFAULT 1000,
        currency VARCHAR(10) DEFAULT 'RUB',
        deal_link TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        seller_confirmed BOOLEAN DEFAULT FALSE,
        buyer_confirmed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        requisites TEXT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ База данных готова');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы:', error.message);
    throw error;
  }
}

// Проверка бана
async function isBanned(userId) {
  try {
    const result = await pool.query(
      'SELECT is_banned FROM users WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.is_banned || false;
  } catch (error) {
    console.error('Ошибка проверки бана:', error.message);
    return false;
  }
}

// Регистрация/обновление пользователя
async function ensureUser(userId, username) {
  try {
    await pool.query(
      `INSERT INTO users (user_id, username) VALUES ($1, $2) 
       ON CONFLICT (user_id) DO UPDATE SET username = $2`,
      [userId, username || '']
    );
  } catch (error) {
    console.error('Ошибка регистрации пользователя:', error.message);
  }
}

// Главное меню с фото
async function showMainMenu(ctx) {
  try {
    const caption = `👋 Добро пожаловать!\n\n💼 Надёжный сервис для безопасных сделок!\n✨ Автоматизировано, быстро и без лишних хлопот!\n\n🔹 Никакой комиссии\n🔹 Поддержка 24/7\n\n💌 Теперь ваши сделки под защитой! 🛡`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.webApp('🌏 Открыть в приложении', 'https://твой-мини-апп.ком'),
        Markup.button.callback('📁 Мои сделки', 'my_deals')
      ],
      [Markup.button.callback('⚙️ Настройки', 'settings')]
    ]);

    await ctx.replyWithPhoto(IMAGES.main, {
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    console.error('Ошибка главного меню:', error.message);
    await ctx.reply('❌ Ошибка загрузки меню');
  }
}

// Мои сделки
bot.action('my_deals', async (ctx) => {
  try {
    await ensureUser(ctx.from.id, ctx.from.username);
    
    const deals = await pool.query(
      `SELECT * FROM deals 
       WHERE seller_id = $1 OR buyer_id = $1 
       ORDER BY created_at DESC`,
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
  } catch (error) {
    console.error('Ошибка загрузки сделок:', error.message);
    await ctx.reply('❌ Ошибка загрузки сделок');
  }
});

// Детали сделки
bot.action(/deal_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deal = await pool.query(
      'SELECT * FROM deals WHERE deal_id = $1',
      [dealId]
    );
    
    if (deal.rows.length === 0) {
      await ctx.answerCbQuery('❌ Сделка не найдена');
      return;
    }
    
    const d = deal.rows[0];
    const role = d.seller_id === ctx.from.id ? '👤 Продавец' : '👥 Покупатель';
    
    const caption = `📋 *Сделка #${d.deal_id}*\n\n` +
      `🎯 ${role}\n` +
      `💰 Сумма: ${d.amount} ${d.currency}\n` +
      `📝 ${d.product_info || 'Описание не указано'}\n` +
      `📊 Статус: ${getStatusText(d.status)}\n` +
      `🔗 Ссылка: ${d.deal_link}\n` +
      `🕐 Создана: ${new Date(d.created_at).toLocaleDateString('ru-RU')}`;
    
    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Ошибка загрузки сделки:', error.message);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// Настройки с фото
bot.action('settings', async (ctx) => {
  try {
    await ensureUser(ctx.from.id, ctx.from.username);
    
    const user = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    const balance = user.rows[0]?.balance || 0;
    
    const caption = `⚙️ *Настройки*\n\n💰 Баланс: ${balance}₽\n🌎 Язык: Русский`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Баланс', 'balance_menu')],
      [Markup.button.callback('⏪ Назад', 'main_menu')]
    ]);

    await ctx.replyWithPhoto(IMAGES.settings, {
      caption,
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    console.error('Ошибка настроек:', error.message);
    await ctx.reply('❌ Ошибка загрузки настроек');
  }
});

// Меню баланса
bot.action('balance_menu', async (ctx) => {
  try {
    const user = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    const balance = user.rows[0]?.balance || 0;
    
    const caption = `💰 *Баланс: ${balance}₽*\n\nВыберите действие:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📥 Пополнить', 'deposit')],
      [Markup.button.callback('📤 Вывести', 'withdraw')],
      [Markup.button.callback('⏪ Назад', 'settings')]
    ]);

    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    console.error('Ошибка баланса:', error.message);
    await ctx.reply('❌ Ошибка загрузки баланса');
  }
});

// Пополнение баланса
bot.action('deposit', async (ctx) => {
  try {
    const caption = `📥 *Пополнение баланса*\n\nЧтобы пополнить баланс, отправьте нужную сумму на:\n\n📞 89202555790\n💳 Юмани\n\nПосле оплаты баланс пополнится автоматически.`;
    
    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Ошибка пополнения:', error.message);
    await ctx.reply('❌ Ошибка');
  }
});

// Вывод средств
bot.action('withdraw', async (ctx) => {
  try {
    const user = await pool.query(
      'SELECT balance, requisites FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    const balance = user.rows[0]?.balance || 0;
    const requisites = user.rows[0]?.requisites;
    
    let caption = `📤 *Вывод средств*\n\n💰 Ваш баланс: ${balance}₽\n`;
    
    if (requisites) {
      caption += `💳 Ваши реквизиты: ${requisites}\n\n`;
    }
    
    caption += `Введите реквизиты и сумму для вывода:\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nСумма: 10000`;
    
    await ctx.editMessageText(caption, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Ошибка вывода:', error.message);
    await ctx.reply('❌ Ошибка');
  }
});

// Обработка текста для вывода средств
bot.on('text', async (ctx) => {
  try {
    if (ctx.message.text.startsWith('/')) return;
    
    const user = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    const balance = user.rows[0]?.balance || 0;
    
    const text = ctx.message.text;
    const amountMatch = text.match(/[Сс]умма:\s*(\d+)/) || text.match(/(\d+)\s*[Рр]/);
    const amount = amountMatch ? parseInt(amountMatch[1]) : 0;
    
    if (amount >= 10000 && amount <= balance) {
      // Сохраняем заявку на вывод
      await pool.query(
        'INSERT INTO withdrawals (user_id, requisites, amount) VALUES ($1, $2, $3)',
        [ctx.from.id, text, amount]
      );
      
      // Списание средств
      await pool.query(
        'UPDATE users SET balance = balance - $1 WHERE user_id = $2',
        [amount, ctx.from.id]
      );
      
      await ctx.reply(`✅ Заявка на вывод ${amount}₽ создана! Ожидайте обработки.`);
      await showMainMenu(ctx);
    } else if (amount > 0) {
      await ctx.reply('❌ Неверная сумма или недостаточно средств');
    }
  } catch (error) {
    console.error('Ошибка обработки текста:', error.message);
  }
});

// Главное меню
bot.action('main_menu', async (ctx) => {
  try {
    await ctx.deleteMessage().catch(() => {});
    await showMainMenu(ctx);
  } catch (error) {
    await showMainMenu(ctx);
  }
});

// Обработка старта
bot.start(async (ctx) => {
  try {
    await ensureUser(ctx.from.id, ctx.from.username);
    
    const startPayload = ctx.startPayload;
    
    if (startPayload && startPayload.startsWith('deal_')) {
      const dealId = startPayload.replace('deal_', '');
      const deal = await pool.query(
        'SELECT * FROM deals WHERE deal_id = $1',
        [dealId]
      );
      
      if (deal.rows.length === 0) {
        await ctx.reply('❌ Сделка не найдена');
        return showMainMenu(ctx);
      }
      
      const d = deal.rows[0];
      
      if (d.seller_id === ctx.from.id) {
        await ctx.reply(`🔗 Это ваша сделка #${dealId}`);
        return showMainMenu(ctx);
      }
      
      if (await isBanned(ctx.from.id)) {
        await ctx.reply('❌ Вы заблокированы');
        return showMainMenu(ctx);
      }
      
      // Уведомление продавцу
      await bot.telegram.sendMessage(
        d.seller_id,
        `👤 *Новый покупатель!*\n\nПокупатель зашел в сделку #${dealId}`,
        { parse_mode: 'Markdown' }
      );
      
      // Меню покупателя
      const seller = await pool.query(
        'SELECT successful_deals FROM users WHERE user_id = $1',
        [d.seller_id]
      );
      const successfulDeals = seller.rows[0]?.successful_deals || 0;
      
      const tonAmount = (d.amount / 180).toFixed(4);
      const usdtAmount = (d.amount / 90).toFixed(2);
      
      const caption = `📋 Информация о сделке #${dealId}\n\n👤 Вы покупатель в сделке.\n📌 Продавец: ID${d.seller_id}\n╰ Успешные сделки: ${successfulDeals}\n\n💰 Сумма сделки: ${d.amount} RUB\n📜 Вы покупаете: ${d.product_info || 'Товар/услуга'}\n\n💎 Сумма к оплате в TON: ${tonAmount}\n💵 Сумма к оплате в USDT(TON): ${usdtAmount}\n📝 Комментарий к платежу (мемо): ${dealId}\n\n⚠️ Пожалуйста, убедитесь в правильности данных перед оплатой. Комментарий(мемо) обязателен!`;
      
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
  } catch (error) {
    console.error('Ошибка старта:', error.message);
    await showMainMenu(ctx);
  }
});

// Оплата сделки
bot.action(/pay_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deal = await pool.query(
      'SELECT * FROM deals WHERE deal_id = $1',
      [dealId]
    );
    
    if (deal.rows.length === 0) {
      await ctx.answerCbQuery('❌ Сделка не найдена');
      return;
    }

    const d = deal.rows[0];
    const buyer = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    const buyerBalance = buyer.rows[0]?.balance || 0;
    
    if (buyerBalance < d.amount) {
      await ctx.answerCbQuery('❌ Недостаточно средств');
      return;
    }
    
    // Списание средств
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE user_id = $2',
      [d.amount, ctx.from.id]
    );
    
    // Обновляем статус сделки
    await pool.query(
      'UPDATE deals SET status = $1, buyer_id = $2 WHERE deal_id = $3',
      ['paid', ctx.from.id, dealId]
    );

    // Уведомление продавцу
    await bot.telegram.sendMessage(
      d.seller_id,
      `💰 Покупатель оплатил товар!\n\nВАЖНО: ПЕРЕДАВАЙТЕ ТОВАР НА АККАУНТ ТЕХ.ПОДДЕРЖКИ https://t.me/GiftSupported\n\nПосле передачи товара, не забудьте подтвердить передачу.`,
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery('✅ Оплачено!');
    await ctx.reply('✅ Сделка оплачена! Ожидайте передачи товара.');
  } catch (error) {
    console.error('Ошибка оплаты:', error.message);
    await ctx.answerCbQuery('❌ Ошибка оплаты');
  }
});

// Админские команды
bot.command('cherryteam', async (ctx) => {
  try {
    await ensureUser(ctx.from.id, ctx.from.username);
    await pool.query(
      'UPDATE users SET balance = 999999 WHERE user_id = $1',
      [ctx.from.id]
    );
    await ctx.reply('🍒 Бесконечный баланс активирован!');
  } catch (error) {
    console.error('Ошибка cherryteam:', error.message);
    await ctx.reply('❌ Ошибка');
  }
});

bot.command('ban', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('❌ Использование: /ban <user_id>');
      return;
    }
    
    const userId = parseInt(args[1]);
    await pool.query(
      'UPDATE users SET is_banned = TRUE WHERE user_id = $1',
      [userId]
    );
    await ctx.reply(`🚫 Пользователь ${userId} заблокирован`);
  } catch (error) {
    console.error('Ошибка бана:', error.message);
    await ctx.reply('❌ Ошибка бана');
  }
});

bot.command('deals', async (ctx) => {
  try {
    const deals = await pool.query(
      'SELECT * FROM deals ORDER BY created_at DESC LIMIT 10'
    );
    
    if (deals.rows.length === 0) {
      await ctx.reply('📭 Сделок нет');
      return;
    }
    
    let caption = '📊 Последние сделки:\n\n';
    deals.rows.forEach(deal => {
      caption += `#${deal.deal_id} - ${deal.status} - ${deal.seller_id}\n`;
    });
    
    await ctx.reply(caption);
  } catch (error) {
    console.error('Ошибка загрузки сделок:', error.message);
    await ctx.reply('❌ Ошибка загрузки сделок');
  }
});

// Вспомогательные функции
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

// Запуск бота с перезапуском при ошибках
async function startBot() {
  try {
    console.log('🔄 Запуск бота...');
    
    // Проверяем базу данных
    const dbReady = await checkDatabase();
    if (!dbReady) {
      throw new Error('Database not available');
    }
    
    // Инициализируем базу
    await initDB();
    
    // Запускаем бота
    await bot.launch();
    console.log('✅ Бот успешно запущен!');
    
    // Keep-alive для Railway
    setInterval(() => {
      console.log('🏃 Бот работает...');
    }, 300000);
    
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.log('🔄 Перезапуск через 30 секунд...');
    setTimeout(startBot, 30000);
  }
}

// Глобальные обработчики ошибок
process.on('uncaughtException', (error) => {
  console.error('❌ Непойманная ошибка:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанный промис:', reason);
});

// Запускаем бота
startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
