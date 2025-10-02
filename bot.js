const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const nodeCron = require('node-cron');

// Получаем переменные окружения из Railway
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8438607431:AAHQZWYuENj3af5THn8TgFWofTx0WyT8_gU';
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://github.com/Din98317/new_tasks_tg/blob/main/index.html';

const bot = new TelegramBot(TOKEN, { polling: true });

// URL для работы с JSONBin
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`;
const JSONBIN_PUT_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;

const headers = {
    'X-Master-Key': JSONBIN_ACCESS_KEY,
    'Content-Type': 'application/json'
};

// Функция для получения всех задач из базы
async function getTasks() {
    try {
        const response = await axios.get(JSONBIN_URL, { headers });
        return response.data.record.tasks || [];
    } catch (error) {
        console.error('Ошибка получения задач:', error.message);
        return [];
    }
}

// Функция для сохранения задач в базу
async function saveTasks(tasks) {
    try {
        await axios.put(JSONBIN_PUT_URL, { tasks }, { headers });
        console.log('Задачи успешно сохранены');
    } catch (error) {
        console.error('Ошибка сохранения задач:', error.message);
    }
}

// Обработчик команды /addtask из Mini App
bot.onText(/\/addtask (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    try {
        const taskData = JSON.parse(match[1]);
        
        // Добавляем ID задачи и убеждаемся что userId правильный
        const newTask = {
            id: Date.now().toString(),
            userId: userId,
            title: taskData.title,
            datetime: taskData.datetime,
            notified: false
        };

        const tasks = await getTasks();
        tasks.push(newTask);
        await saveTasks(tasks);

        await bot.sendMessage(userId, `✅ Задача "${taskData.title}" добавлена!`);
    } catch (error) {
        console.error('Ошибка добавления задачи:', error);
        await bot.sendMessage(userId, '❌ Ошибка при добавлении задачи');
    }
});

// Обработчик команды /getmytasks из Mini App
bot.onText(/\/getmytasks/, async (msg) => {
    const userId = msg.chat.id;
    try {
        const tasks = await getTasks();
        const userTasks = tasks.filter(task => task.userId == userId);
        
        if (userTasks.length === 0) {
            await bot.sendMessage(userId, '📝 У вас пока нет задач');
            return;
        }

        let message = '📋 Ваши задачи:\n\n';
        userTasks.forEach(task => {
            const date = new Date(task.datetime).toLocaleString('ru-RU');
            message += `• ${task.title}\n  📅 ${date}\n\n`;
        });

        await bot.sendMessage(userId, message);
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        await bot.sendMessage(userId, '❌ Ошибка при загрузке задач');
    }
});

// Функция проверки и отправки уведомлений
async function checkNotifications() {
    try {
        const tasks = await getTasks();
        const now = new Date();
        
        for (const task of tasks) {
            if (task.notified) continue;

            const taskDate = new Date(task.datetime);
            const timeDiff = taskDate.getTime() - now.getTime();
            const hoursDiff = timeDiff / (1000 * 60 * 60);

            // Если до задачи осталось 4 часа или меньше
            if (hoursDiff <= 4 && hoursDiff > 0) {
                const message = `🔔 Напоминание!\nЧерез ${Math.round(hoursDiff)} часа начнется:\n"${task.title}"`;
                
                try {
                    await bot.sendMessage(task.userId, message);
                    console.log(`Уведомление отправлено пользователю ${task.userId} для задачи "${task.title}"`);
                    
                    // Помечаем задачу как уведомленную
                    task.notified = true;
                } catch (error) {
                    console.error(`Не удалось отправить уведомление пользователю ${task.userId}:`, error.message);
                }
            }
        }

        // Сохраняем обновленные задачи
        await saveTasks(tasks);
    } catch (error) {
        console.error('Ошибка проверки уведомлений:', error);
    }
}

// Проверяем задачи каждую минуту
nodeCron.schedule('* * * * *', checkNotifications);

// Команда для установки web app
bot.onText(/\/start/, (msg) => {
    const keyboard = {
        inline_keyboard: [[{
            text: '📋 Открыть задачи',
            web_app: { url: MINI_APP_URL }
        }]]
    };

    bot.sendMessage(msg.chat.id, 'Добро пожаловать в менеджер задач! Нажмите кнопку ниже чтобы открыть приложение.', {
        reply_markup: keyboard
    });
});

// Обработка ошибок бота
bot.on('error', (error) => {
    console.error('Ошибка бота:', error);
});

bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error);
});

console.log('🚀 Бот запущен на Railway...');
