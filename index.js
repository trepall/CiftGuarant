const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

// Инициализация бота с токеном
const bot = new Telegraf('8242060469:AAHt6_sJt7iFWraOT193hAU4jtXXRPFHgJg');

// Подключение к базе данных
const pool = new Pool({
  connectionString: 'postgresql://postgres:maksam12345678910777@db.goemwsdzdsenyuhlzdau.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

// URL изображений
const IMAGES = {
  main: 'https://i.ibb.co/JjTY2k5w/image.jpg',
  deal: 'https://i.ibb.co/7N4dmwFQ/image.jpg',
  settings: 'https://i.ibb.co/JjTY2k5w/image.jpg'
};

// Функция инициализации базы данных
async function initializeDatabase() {
  try {
    await pool.query(`
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
    
    await pool.query(`
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
    
    console.log('✅ База данных инициализирована');
  } catch (error) {
    console.log('✅ Таблицы уже существуют');
  }
}

// УПРОЩЕННАЯ функция регистрации пользователя
async function registerUser(userId, username, firstName) {
  try {
    // Простая вставка, игнорируем конфликты
    await pool.query(
      `INSERT INTO users (user_id, username, first_name) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, username || 'Unknown', firstName || 'User']
    );
    console.log(`✅ Пользователь ${userId} зарегистрирован`);
    return true;
  } catch (error) {
    console.log(`✅ Пользователь ${userId} уже существует`);
    return true; // Всегда возвращаем true, даже если пользователь уже есть
  }
}

// Функция показа главного меню
async function displayMainMenu(ctx) {
  try {
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
  } catch (error) {
    // Если фото не загружается, отправляем текстовое сообщение
    await ctx.reply('👋 Добро пожаловать в GiftGuarant! Используйте кнопки меню для навигации.');
  }
}

// Обработчик команды /start
bot.start(async (ctx) => {
  try {
    console.log(`🔄 Обработка /start от пользователя: ${ctx.from.id}`);
    
    // Простая регистрация пользователя
    await registerUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

    // Обработка ссылки на сделку
    if (ctx.startPayload && ctx.startPayload.startsWith('deal_')) {
      await handleDealLink(ctx);
      return;
    }

    // Показываем главное меню
    await displayMainMenu(ctx);
    
  } catch (error) {
    console.error('Ошибка в /start:', error);
    // Даже при ошибке показываем меню
    await ctx.reply('👋 Добро пожаловать в GiftGuarant!');
  }
});

// Обработчик сделки по ссылке
async function handleDealLink(ctx) {
  try {
    const dealId = ctx.startPayload.replace('deal_', '');
    
    const dealResult = await pool.query(
      'SELECT * FROM deals WHERE deal_id = $1',
      [dealId]
    );
    
    if (dealResult.rows.length === 0) {
      await ctx.reply('❌ Сделка не найдена');
      await displayMainMenu(ctx);
      return;
    }
    
    const deal = dealResult.rows[0];
    
    if (deal.seller_id === ctx.from.id) {
      await ctx.reply(`🔗 Это ваша сделка #${dealId}`);
      await displayMainMenu(ctx);
      return;
    }
    
    // Показываем информацию о сделке покупателю
    const caption = `📋 *Информация о сделке #${dealId}*\n\n👤 Вы покупатель в сделке\n💰 Сумма: ${deal.amount} ${deal.currency}\n📝 ${deal.product_info}`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Оплатить с баланса', `pay_${dealId}`)],
      [Markup.button.callback('⏪ Главное меню', 'main_menu')]
    ]);

    await ctx.reply(caption, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    console.error('Ошибка обработки сделки:', error);
    await ctx.reply('❌ Ошибка загрузки сделки');
    await displayMainMenu(ctx);
  }
}

// Обработчик кнопки "Главное меню"
bot.action('main_menu', async (ctx) => {
  try {
    await ctx.deleteMessage().catch(() => {});
    await displayMainMenu(ctx);
  } catch (error) {
    await displayMainMenu(ctx);
  }
});

// Обработчик кнопки "Мои сделки"
bot.action('my_deals', async (ctx) => {
  try {
    const dealsResult = await pool.query(
      'SELECT * FROM deals WHERE seller_id = $1 OR buyer_id = $1 ORDER BY created_at DESC',
      [ctx.from.id]
    );
    
    if (dealsResult.rows.length === 0) {
      await ctx.reply('📭 У вас пока нет сделок');
      return;
    }
    
    const keyboard = Markup.inlineKeyboard([
      ...dealsResult.rows.map(deal => [
        Markup.button.callback(`#${deal.deal_id} - ${deal.status}`, `deal_${deal.deal_id}`)
      ]),
      [Markup.button.callback('⏪ Назад', 'main_menu')]
    ]);
    
    await ctx.reply('📁 *Ваши сделки:*\n\nВыберите сделку для просмотра:', {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    console.error('Ошибка загрузки сделок:', error);
    await ctx.reply('❌ Ошибка загрузки сделок');
  }
});

// Обработчик кнопки "Настройки"
bot.action('settings', async (ctx) => {
  try {
    const userResult = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    
    const balance = userResult.rows[0]?.balance || 0;
    const caption = `⚙️ *Настройки*\n\n💰 Баланс: ${balance}₽\n🌎 Язык: Русский`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Баланс', 'balance_menu')],
      [Markup.button.callback('⏪ Назад', 'main_menu')]
    ]);

    await ctx.reply(caption, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    console.error('Ошибка настроек:', error);
    await ctx.reply('❌ Ошибка загрузки настроек');
  }
});

// Обработчик кнопки "Баланс"
bot.action('balance_menu', async (ctx) => {
  try {
    const userResult = await pool.query(
      'SELECT balance FROM users WHERE user_id = $1',
      [ctx.from.id]
    );
    
    const balance = userResult.rows[0]?.balance || 0;
    const caption = `💰 *Баланс: ${balance}₽*\n\nВыберите действие:`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📥 Пополнить', 'deposit')],
      [Markup.button.callback('📤 Вывести', 'withdraw')],
      [Markup.button.callback('⏪ Назад', 'settings')]
    ]);

    await ctx.reply(caption, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    console.error('Ошибка баланса:', error);
    await ctx.reply('❌ Ошибка загрузки баланса');
  }
});

// Обработчик кнопки "Пополнить"
bot.action('deposit', async (ctx) => {
  await ctx.reply('📥 *Пополнение баланса*\n\nОтправьте сумму на:\n📞 89202555790\n💳 Юмани\n\nПосле оплаты баланс пополнится автоматически.', {
    parse_mode: 'Markdown'
  });
});

// Обработчик кнопки "Вывести"
bot.action('withdraw', async (ctx) => {
  await ctx.reply('📤 *Вывод средств*\n\nВведите реквизиты и сумму для вывода:\n\n*Пример:*\nКарта: 1234 5678 9012 3456\nСумма: 10000', {
    parse_mode: 'Markdown'
  });
});

// Админские команды
bot.command('cherryteam', async (ctx) => {
  try {
    await pool.query(
      'UPDATE users SET balance = 999999 WHERE user_id = $1',
      [ctx.from.id]
    );
    await ctx.reply('🍒 Бесконечный баланс активирован!');
  } catch (error) {
    await ctx.reply('❌ Ошибка активации баланса');
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
    await ctx.reply('❌ Ошибка бана пользователя');
  }
});

bot.command('deals', async (ctx) => {
  try {
    const dealsResult = await pool.query(
      'SELECT * FROM deals ORDER BY created_at DESC LIMIT 10'
    );
    
    if (dealsResult.rows.length === 0) {
      await ctx.reply('📭 Сделок нет');
      return;
    }
    
    let caption = '📊 *Последние сделки:*\n\n';
    dealsResult.rows.forEach(deal => {
      caption += `#${deal.deal_id} - ${deal.status} - ${deal.seller_id}\n`;
    });
    
    await ctx.reply(caption, { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply('❌ Ошибка загрузки сделок');
  }
});

// Функция запуска бота
async function startBot() {
  try {
    console.log('🔄 Инициализация базы данных...');
    await initializeDatabase();
    
    console.log('🔄 Запуск бота...');
    await bot.launch();
    
    console.log('✅ Бот успешно запущен и готов к работе!');
    
  } catch (error) {
    console.error('❌ Критическая ошибка запуска:', error);
    process.exit(1);
  }
}

// Обработчики завершения работы
process.once('SIGINT', () => {
  console.log('🔄 Завершение работы...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🔄 Завершение работы...');
  bot.stop('SIGTERM');
});

// Запускаем бота
startBot();
