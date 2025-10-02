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

// Используем polling с настройками для Railway
const bot = new TelegramBot(TOKEN, { 
    polling: {
        interval: 300,
        autoStart: false
    }
});

// Middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// База данных
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`;
const JSONBIN_PUT_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const headers = {
    'X-Master-Key': JSONBIN_ACCESS_KEY,
    'Content-Type': 'application/json'
};

let families = {};

// Функции для работы с данными
async function getTasks() {
    try {
        const response = await axios.get(JSONBIN_URL, { headers });
        return response.data.record.tasks || [];
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error.message);
        return [];
    }
}

async function saveTasks(tasks) {
    try {
        await axios.put(JSONBIN_PUT_URL, { tasks, families }, { headers });
        console.log('✅ Данные сохранены');
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error.message);
        return false;
    }
}

async function loadData() {
    try {
        const response = await axios.get(JSONBIN_URL, { headers });
        const data = response.data.record;
        families = data.families || {};
        console.log('✅ Данные загружены');
        console.log(`📊 Задач: ${data.tasks?.length || 0}, Семей: ${Object.keys(families).length}`);
    } catch (error) {
        console.error('❌ Ошибка загрузки:', error.message);
        families = {};
    }
}

function getUserFamily(userId) {
    for (let familyId in families) {
        if (families[familyId].members.includes(userId.toString())) {
            return familyId;
        }
    }
    return null;
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;
    const userName = msg.from.first_name || 'Пользователь';
    
    console.log(`👋 Пользователь ${userName} (${userId}) запустил бота`);

    const keyboard = {
        inline_keyboard: [[{
            text: '📋 Открыть задачи',
            web_app: { url: MINI_APP_URL }
        }]]
    };

    const welcomeMessage = `👋 Привет, ${userName}!\n\nДобро пожаловать в Семейный задачник!\n\n📝 Создавайте задачи\n🔔 Получайте напоминания\n👨‍👩‍👧‍👦 Работайте вместе с семьей\n\nНажмите кнопку ниже чтобы открыть приложение:`;

    bot.sendMessage(userId, welcomeMessage, {
        reply_markup: keyboard
    }).catch(error => {
        console.error('❌ Ошибка отправки:', error.message);
    });
});

// Команда /mytasks
bot.onText(/\/mytasks/, async (msg) => {
    const userId = msg.chat.id;
    
    console.log(`📋 Запрос задач от пользователя ${userId}`);

    try {
        const tasks = await getTasks();
        const userTasks = tasks.filter(task => task.userId == userId);
        
        console.log(`📊 Найдено задач пользователя: ${userTasks.length}`);

        if (userTasks.length === 0) {
            await bot.sendMessage(userId, '📝 У вас пока нет задач.\n\nОткройте Mini App через /start чтобы создать первую задачу!');
            return;
        }

        let message = '📋 Ваши задачи:\n\n';
        userTasks.forEach((task, index) => {
            const date = new Date(task.datetime).toLocaleString('ru-RU');
            const status = task.notified ? '🔔 Уведомлено' : (new Date(task.datetime) < new Date() ? '✅ Завершено' : '⏰ Ожидает');
            message += `${index + 1}. ${task.title}\n   📅 ${date}\n   ${status}\n\n`;
        });

        await bot.sendMessage(userId, message);
        console.log(`✅ Список задач отправлен пользователю ${userId}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        await bot.sendMessage(userId, '❌ Ошибка при загрузке задач');
    }
});

// Команда /help
bot.onText(/\/help/, (msg) => {
    const userId = msg.chat.id;
    
    const helpMessage = `📖 Доступные команды:

/start - Открыть приложение с задачами
/mytasks - Показать мои задачи
/help - Эта справка

💡 Основной функционал в Mini App (кнопка в /start)`;

    bot.sendMessage(userId, helpMessage).catch(error => {
        console.error('❌ Ошибка отправки:', error.message);
    });
});

// Обработка всех сообщений для диагностики
bot.on('message', (msg) => {
    const userId = msg.chat.id;
    const text = msg.text;
    
    if (!text.startsWith('/')) {
        console.log(`💬 Сообщение от ${userId}: "${text}"`);
    }
});

// Endpoint для Mini App
app.post('/addtask', async (req, res) => {
    try {
        const taskData = req.body;
        console.log('📨 Новая задача:', taskData);

        if (!taskData.userId || !taskData.title || !taskData.datetime) {
            return res.status(400).json({ success: false, error: 'Заполните все поля' });
        }

        const newTask = {
            id: Date.now().toString(),
            userId: taskData.userId,
            title: taskData.title,
            datetime: taskData.datetime,
            notified: false,
            createdAt: new Date().toISOString(),
            isFamilyTask: false
        };

        const tasks = await getTasks();
        tasks.push(newTask);
        await saveTasks(tasks);

        // Уведомление пользователю
        try {
            await bot.sendMessage(taskData.userId, `✅ Задача "${taskData.title}" добавлена!\n📅 Напоминание придет за 5 часов до начала.`);
        } catch (error) {
            console.error('❌ Не удалось отправить уведомление:', error.message);
        }

        res.json({ success: true, message: 'Задача добавлена', taskId: newTask.id });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/gettasks', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'userId обязателен' });

        const tasks = await getTasks();
        const userTasks = tasks.filter(task => task.userId == userId);
        
        res.json({ success: true, tasks: userTasks, count: userTasks.length });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: 'Ошибка загрузки' });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Family Task Manager Bot is running' });
});

// Функция уведомлений
async function checkNotifications() {
    try {
        const tasks = await getTasks();
        console.log(`🔍 Проверка уведомлений... Задач: ${tasks.length}`);
        // Логика уведомлений здесь
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
    }
}

nodeCron.schedule('* * * * *', checkNotifications);

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    
    await loadData();
    
    // Запускаем polling
    bot.startPolling().then(() => {
        console.log('✅ Бот запущен в режиме polling');
        console.log('✅ Семейный задачник готов!');
    }).catch(error => {
        console.error('❌ Ошибка запуска бота:', error);
    });
});

// Обработка ошибок
bot.on('error', (error) => console.error('❌ Ошибка бота:', error));
bot.on('polling_error', (error) => console.error('❌ Ошибка polling:', error));
