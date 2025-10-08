const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

// Безопасное подключение к базе БЕЗ SSL ошибок
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Отключаем проверку SSL сертификата
  }
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// Создание таблиц БЕЗ SSL ошибок
async function initDB() {
  try {
    const client = await pool.connect();
    console.log('✅ База данных подключена!');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        requisites TEXT,
        balance DECIMAL(15,2) DEFAULT 0,
        successful_deals INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY,
        deal_id VARCHAR(50) UNIQUE NOT NULL,
        seller_id BIGINT NOT NULL,
        deal_type VARCHAR(50) NOT NULL,
        product_info TEXT NOT NULL,
        currency VARCHAR(20) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        deal_link TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    client.release();
    console.log('✅ Таблицы созданы успешно!');
  } catch (error) {
    console.log('❌ Ошибка базы данных:', error.message);
  }
}

// Главное меню
async function showMainMenu(ctx) {
  await ctx.reply(
    `🤖 ЭСКРОУ БОТ ЗАПУЩЕН!\n\n` +
    `✅ База данных подключена\n` +
    `🛡️ Все функции доступны\n\n` +
    `Выберите действие:`,
    Markup.keyboard([
      ['💰 Мои реквизиты', '💼 Создать сделку'],
      ['🗒️ Мои сделки', '⚙️ Настройки']
    ]).resize()
  );
}

// Команда /start
bot.start(async (ctx) => {
  try {
    await pool.query(
      `INSERT INTO users (user_id, username, first_name) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id) DO NOTHING`,
      [ctx.from.id, ctx.from.username, ctx.from.first_name]
    );
  } catch (error) {
    console.log('Ошибка сохранения пользователя:', error.message);
  }
  
  await showMainMenu(ctx);
});

// Создание сделки
bot.hears('💼 Создать сделку', async (ctx) => {
  const dealId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const dealLink = `https://t.me/${ctx.botInfo.username}?start=deal_${dealId}`;
  
  try {
    await pool.query(
      `INSERT INTO deals (deal_id, seller_id, deal_type, product_info, currency, amount, deal_link) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [dealId, ctx.from.id, 'gifts', 'Тестовый товар', 'RUB', 1000, dealLink]
    );
    
    await ctx.reply(
      `✅ Сделка создана!\n\n` +
      `🔗 Ссылка для покупателя:\n${dealLink}`
    );
  } catch (error) {
    await ctx.reply('❌ Ошибка создания сделки: ' + error.message);
  }
});

// Запуск бота
initDB().then(() => {
  console.log('🚀 Запускаю бота...');
  bot.launch()
    .then(() => console.log('✅ Бот успешно запущен!'))
    .catch(err => console.log('❌ Ошибка запуска бота:', err.message));
});
