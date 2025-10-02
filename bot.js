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

// Используем polling (проще и надежнее)
const bot = new TelegramBot(TOKEN, { 
    polling: true,
    request: {
        timeout: 30000  // Увеличиваем таймаут для Railway
    }
});

// Middleware для обработки JSON
app.use(express.json());

// CORS для Mini App
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

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
        console.error('❌ Ошибка получения задач:', error.message);
        return [];
    }
}

// Функция для сохранения задач в базу
async function saveTasks(tasks) {
    try {
        await axios.put(JSONBIN_PUT_URL, { tasks }, { headers });
        console.log('✅ Задачи успешно сохранены');
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения задач:', error.message);
        return false;
    }
}

// Endpoint для добавления задач из Mini App
app.post('/addtask', async (req, res) => {
    try {
        const taskData = req.body;
        
        console.log('📨 Получена новая задача:', taskData);

        // Валидация данных
        if (!taskData.userId || !taskData.title || !taskData.datetime) {
            return res.status(400).json({ 
                success: false, 
                error: 'Не все обязательные поля заполнены' 
            });
        }

        const newTask = {
            id: Date.now().toString(),
            userId: taskData.userId,
            title: taskData.title,
            datetime: taskData.datetime,
            notified: false,
            createdAt: new Date().toISOString()
        };

        const tasks = await getTasks();
        tasks.push(newTask);
        const saved = await saveTasks(tasks);

        if (!saved) {
            return res.status(500).json({ 
                success: false, 
                error: 'Ошибка сохранения в базу данных' 
            });
        }

        // Отправляем уведомление пользователю
        try {
            await bot.sendMessage(
                taskData.userId, 
                `✅ Задача "${taskData.title}" добавлена!\n📅 Напоминание придет за 4 часа до начала.`
            );
        } catch (tgError) {
            console.error('❌ Не удалось отправить сообщение в Telegram:', tgError.message);
        }

        res.status(200).json({ 
            success: true, 
            message: 'Задача добавлена',
            taskId: newTask.id
        });

    } catch (error) {
        console.error('❌ Ошибка добавления задачи:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

// Endpoint для получения задач пользователя
app.post('/gettasks', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId обязателен' 
            });
        }

        const tasks = await getTasks();
        const userTasks = tasks.filter(task => task.userId == userId);
        
        res.status(200).json({ 
            success: true, 
            tasks: userTasks,
            count: userTasks.length
        });
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении задач' 
        });
    }
});

// Команда /start
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
    }).catch(error => {
        console.error('❌ Ошибка отправки сообщения:', error.message);
    });
});

// Команда /mytasks - посмотреть задачи
bot.onText(/\/mytasks/, async (msg) => {
    const userId = msg.chat.id;
    
    try {
        const tasks = await getTasks();
        const userTasks = tasks.filter(task => task.userId == userId);
        
        if (userTasks.length === 0) {
            await bot.sendMessage(userId, '📝 У вас пока нет задач. Создайте первую задачу через Mini App!');
            return;
        }

        let message = '📋 Ваши задачи:\n\n';
        userTasks.forEach((task, index) => {
            const date = new Date(task.datetime).toLocaleString('ru-RU');
            const status = task.notified ? '🔔 Уведомлено' : '⏰ Ожидает';
            message += `${index + 1}. ${task.title}\n   📅 ${date}\n   ${status}\n\n`;
        });

        await bot.sendMessage(userId, message);
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error);
        await bot.sendMessage(userId, '❌ Ошибка при загрузке задач');
    }
});

// Команда /help
bot.onText(/\/help/, (msg) => {
    const userId = msg.chat.id;
    
    const helpMessage = `📖 Доступные команды:

/start - Запустить бота и открыть приложение
/mytasks - Показать все ваши задачи
/help - Показать эту справку

📱 Основной функционал доступен через Mini App (кнопка в /start)`;

    bot.sendMessage(userId, helpMessage).catch(error => {
        console.error('❌ Ошибка отправки сообщения:', error.message);
    });
});

// Функция проверки и отправки уведомлений
async function checkNotifications() {
    try {
        const tasks = await getTasks();
        const now = new Date();
        
        console.log(`🔍 Проверка уведомлений... Найдено задач: ${tasks.length}`);

        let notificationsSent = 0;

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
                    console.log(`✅ Уведомление отправлено пользователю ${task.userId} для задачи "${task.title}"`);
                    task.notified = true;
                    notificationsSent++;
                } catch (error) {
                    console.error(`❌ Не удалось отправить уведомление пользователю ${task.userId}:`, error.message);
                }
            }
        }

        if (notificationsSent > 0) {
            await saveTasks(tasks);
            console.log(`📨 Отправлено уведомлений: ${notificationsSent}`);
        }

    } catch (error) {
        console.error('❌ Ошибка проверки уведомлений:', error);
    }
}

// Проверяем задачи каждую минуту
nodeCron.schedule('* * * * *', checkNotifications);

// Health check endpoints
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Task Manager Bot is running',
        service: 'Telegram Tasks Bot',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Task Manager Bot',
        time: new Date().toLocaleString('ru-RU'),
        uptime: process.uptime()
    });
});

// Запускаем сервер
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
    console.log(`🔗 Health check: https://railwaybot-production-e3bc.up.railway.app/health`);
    console.log('✅ Бот готов к работе с polling!');
});

// Обработка ошибок бота
bot.on('error', (error) => {
    console.error('❌ Ошибка бота:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Ошибка polling:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Получен SIGTERM, graceful shutdown...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 Получен SIGINT, остановка...');
    bot.stopPolling();
    process.exit(0);
});
