const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

console.log('🔧 1. Загрузка модулей...');

// 1. Тестируем токен бота
try {
  const bot = new Telegraf('8242060469:AAHt6_sJt7iFWraOT193hAU4jtXXRPFHgJg');
  console.log('✅ Токен бота: ОК');
} catch (error) {
  console.log('❌ Токен бота: ОШИБКА', error.message);
  process.exit(1);
}

// 2. Тестируем подключение к БД
console.log('🔧 2. Тестируем подключение к Supabase...');

const pool = new Pool({
  connectionString: 'postgresql://postgres:maksam12345678910777@db.goemwsdzdsenyuhlzdau.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function testDatabase() {
  try {
    const client = await pool.connect();
    console.log('✅ Подключение к БД: УСПЕШНО');
    
    const result = await client.query('SELECT NOW() as time');
    console.log('✅ Запрос к БД: УСПЕШНО', result.rows[0].time);
    
    client.release();
    return true;
  } catch (error) {
    console.log('❌ Ошибка БД:', error.message);
    console.log('🔍 Детали:', {
      code: error.code,
      detail: error.detail
    });
    return false;
  }
}

// 3. Запускаем тесты
async function runTests() {
  console.log('🧪 Запуск тестов...');
  
  // Тест БД
  const dbSuccess = await testDatabase();
  
  if (!dbSuccess) {
    console.log('🚨 Проблема с БД. Проверьте:');
    console.log('1. Правильность connection string');
    console.log('2. Доступность Supabase из вашего сервера');
    console.log('3. Настройки firewall в Supabase');
    return;
  }
  
  // Тест бота
  try {
    const bot = new Telegraf('8242060469:AAHt6_sJt7iFWraOT193hAU4jtXXRPFHgJg');
    const botInfo = await bot.telegram.getMe();
    console.log('✅ Бот авторизован:', botInfo.username);
    
    console.log('🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ! Бот готов к работе.');
    
  } catch (error) {
    console.log('❌ Ошибка бота:', error.message);
  }
}

runTests();
