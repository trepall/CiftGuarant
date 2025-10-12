const { Telegraf } = require('telegraf');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Простая проверка
console.log('🔧 Token check:', process.env.BOT_TOKEN ? `YES (${process.env.BOT_TOKEN.length} chars)` : 'NO');

app.get('/', (req, res) => {
  res.send('Bot is alive');
});

app.listen(PORT, () => {
  console.log('Server started on port', PORT);
});

// Самый простой бот
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply('БОТ РАБОТАЕТ! ✅');
});

bot.command('test', (ctx) => {
  ctx.reply('TEST OK!');
});

console.log('🚀 Starting bot...');
bot.launch()
  .then(() => console.log('✅ BOT STARTED SUCCESSFULLY!'))
  .catch(err => {
    console.log('❌ BOT FAILED:', err.message);
    console.log('Full error:', err);
  });

// Keep alive
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
