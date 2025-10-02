const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const nodeCron = require('node-cron');
const express = require('express');

const app = express();

// Получаем переменные окружения из Railway
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY;
const MINI_APP_URL = process.env.MINI_APP_URL;

// Используем webhook вместо polling
const bot = new TelegramBot(TOKEN);

// Middleware для обработки JSON
app.use(express.json());

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
        console.log('✅ Задачи успешно сохранены');
    } catch (error) {
        console.error('❌ Ошибка сохранения задач:', error.message);
    }
}

// Endpoint для добавления задач из Mini App
app.post('/addtask', async (req, res) => {
    try {
        const taskData = req.body;
        
        console.log('📨 Получена новая задача:', taskData);

        const newTask = {
            id: Date.now().toString(),
            userId: taskData.userId,
            title: taskData.title,
            datetime: taskData.datetime,
            notified: false
        };

        const tasks = await getTasks();
        tasks.push(newTask);
        await saveTasks(tasks);

        // Отправляем уведомление пользователю
        await bot.sendMessage(taskData.userId, `✅ Задача "${taskData.title}" добавлена!\n📅 Напоминание придет за 4 часа до начала.`);

        res.status(200).json({ success: true, message: 'Задача добавлена' });
    } catch (error) {
        console.error('❌ Ошибка добавления задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка при добавлении задачи' });
    }
});

// Endpoint для получения задач пользователя
app.post('/gettasks', async (req, res) => {
    try {
        const { userId } = req.body;
        const tasks = await getTasks();
        const userTasks = tasks.filter(task => task.userId == userId);
        
        res.status(200).json({ success: true, tasks: userTasks });
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении задач' });
    }
});

// Команды бота
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;
    
    const keyboard = {
        inline_keyboard: [[{
            text: '📋 Открыть задачи',
            web_app: { url: MINI_APP_URL }
        }]]
    };

    const welcomeMessage = `👋 Добро пожаловать в менеджер семейных задач!\n\n📝 Создавайте задачи и получайте напоминания за 4 часа до начала.\n\nНажмите кнопку ниже чтобы открыть приложение:`;

    bot.sendMessage(userId, welcomeMessage, {
        reply_markup: keyboard
    });
});

// Функция проверки и отправки уведомлений
async function checkNotifications() {
    try {
        const tasks = await getTasks();
        const now = new Date();
        
        console.log(`🔍 Проверка уведомлений... Найдено задач: ${tasks.length}`);

        for (const task of tasks) {
            if (task.notified) continue;

            const taskDate = new Date(task.datetime);
            const timeDiff = taskDate.getTime() - now.getTime();
            const hoursDiff = timeDiff / (1000 * 60 * 60);

            if (hoursDiff <= 4 && hoursDiff > 0) {
                const message = `🔔 Напоминание!\nЧерез ${Math.round(hoursDiff)} часа начнется:\n"${task.title}"`;
                
                try {
                    await bot.sendMessage(task.userId, message);
                    console.log(`✅ Уведомление отправлено пользователю ${task.userId} для задачи "${task.title}"`);
                    task.notified = true;
                } catch (error) {
                    console.error(`❌ Не удалось отправить уведомление:`, error.message);
                }
            }
        }

        await saveTasks(tasks);
    } catch (error) {
        console.error('❌ Ошибка проверки уведомлений:', error);
    }
}

// Проверяем задачи каждую минуту
nodeCron.schedule('* * * * *', checkNotifications);

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Task Manager Bot is running',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Task Manager Bot',
        time: new Date().toLocaleString('ru-RU')
    });
});

// Запускаем сервер
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
    console.log('✅ Бот готов к работе!');
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('❌ Ошибка бота:', error);
});

process.on('SIGTERM', () => {
    console.log('🔄 Получен SIGTERM, graceful shutdown...');
    process.exit(0);
});
