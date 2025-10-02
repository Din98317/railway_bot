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
const RAILWAY_URL = process.env.RAILWAY_STATIC_URL || 'railwaybot-production-e3bc.up.railway.app';

const bot = new TelegramBot(TOKEN);

// Middleware для обработки JSON
app.use(express.json());

// CORS для Mini App
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// URL для работы с JSONBin
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`;
const JSONBIN_PUT_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;

const headers = {
    'X-Master-Key': JSONBIN_ACCESS_KEY,
    'Content-Type': 'application/json'
};

// Хранилище семей
let families = {};

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
        await axios.put(JSONBIN_PUT_URL, { tasks, families }, { headers });
        console.log('✅ Данные успешно сохранены');
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения данных:', error.message);
        return false;
    }
}

// Функция для загрузки данных из базы
async function loadData() {
    try {
        const response = await axios.get(JSONBIN_URL, { headers });
        const data = response.data.record;
        families = data.families || {};
        console.log('✅ Данные загружены из базы');
        console.log(`📊 Задач: ${data.tasks?.length || 0}, Семей: ${Object.keys(families).length}`);
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error.message);
        families = {};
    }
}

// Функция для получения семьи пользователя
function getUserFamily(userId) {
    for (let familyId in families) {
        if (families[familyId].members.includes(userId.toString())) {
            return familyId;
        }
    }
    return null;
}

// Функция для создания семьи
async function createFamily(userId, familyName) {
    const familyId = Date.now().toString();
    families[familyId] = {
        id: familyId,
        name: familyName,
        members: [userId.toString()],
        createdBy: userId,
        createdAt: new Date().toISOString()
    };
    await saveTasks(await getTasks());
    return familyId;
}

// Функция для добавления участника в семью
async function addToFamily(familyId, userId) {
    if (families[familyId] && !families[familyId].members.includes(userId.toString())) {
        families[familyId].members.push(userId.toString());
        await saveTasks(await getTasks());
        return true;
    }
    return false;
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;
    const userName = msg.from.first_name || 'Пользователь';
    
    const familyId = getUserFamily(userId);
    const familyText = familyId ? `\n👨‍👩‍👧‍👦 Вы в семье "${families[familyId].name}"` : '\n💡 Используйте /createfamily чтобы создать семью';

    const keyboard = {
        inline_keyboard: [[{
            text: '📋 Открыть задачи',
            web_app: { url: MINI_APP_URL }
        }]]
    };

    const welcomeMessage = `👋 Привет, ${userName}! Добро пожаловать в Семейный задачник!${familyText}\n\n📝 Создавайте личные и общие задачи\n🔔 Получайте напоминания за 5 часов\n👨‍👩‍👧‍👦 Работайте вместе с семьей\n\nНажмите кнопку ниже чтобы открыть приложение:`;

    bot.sendMessage(userId, welcomeMessage, {
        reply_markup: keyboard
    }).then(() => {
        console.log(`✅ Отправлен /start пользователю ${userId}`);
    }).catch(error => {
        console.error('❌ Ошибка отправки сообщения:', error.message);
    });
});

// Команда /mytasks
bot.onText(/\/mytasks/, async (msg) => {
    const userId = msg.chat.id;
    
    console.log(`🔄 Обработка /mytasks для пользователя ${userId}`);
    
    try {
        const tasks = await getTasks();
        const familyId = getUserFamily(userId);
        
        // Показываем свои задачи + задачи семьи
        const userTasks = tasks.filter(task => 
            task.userId == userId || 
            (task.familyId && task.familyId === familyId)
        );
        
        console.log(`📊 Найдено задач: ${userTasks.length} для пользователя ${userId}`);
        
        if (userTasks.length === 0) {
            await bot.sendMessage(userId, '📝 У вас пока нет задач. Создайте первую задачу через Mini App!');
            return;
        }

        let message = '📋 Ваши задачи:\n\n';
        userTasks.forEach((task, index) => {
            const date = new Date(task.datetime).toLocaleString('ru-RU');
            const status = task.notified ? '🔔 Уведомлено' : (new Date(task.datetime) < new Date() ? '✅ Завершено' : '⏰ Ожидает');
            const type = task.isFamilyTask ? '👨‍👩‍👧‍👦 Семейная' : '👤 Личная';
            message += `${index + 1}. ${task.title}\n   ${type}\n   📅 ${date}\n   ${status}\n\n`;
        });

        await bot.sendMessage(userId, message);
        console.log(`✅ Отправлен список задач пользователю ${userId}`);
        
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error);
        await bot.sendMessage(userId, '❌ Ошибка при загрузке задач');
    }
});

// Команда для создания семьи
bot.onText(/\/createfamily (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    const familyName = match[1];

    if (getUserFamily(userId)) {
        bot.sendMessage(userId, '❌ Вы уже состоите в семье!');
        return;
    }

    try {
        const familyId = await createFamily(userId, familyName);
        await bot.sendMessage(userId, `✅ Семья "${familyName}" создана!\n\nТеперь вы можете приглашать других участников командой:\n/invite [ID пользователя]\n\n💡 Ваш ID: ${userId}\nПоделитесь им с теми, кого хотите пригласить.`);
    } catch (error) {
        await bot.sendMessage(userId, '❌ Ошибка при создании семьи');
    }
});

// Команда для приглашения
bot.onText(/\/invite (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    const inviteUserId = match[1];

    const familyId = getUserFamily(userId);
    if (!familyId) {
        await bot.sendMessage(userId, '❌ Вы не состоите в семье! Создайте семью сначала командой /createfamily [название]');
        return;
    }

    try {
        const family = families[familyId];
        const added = await addToFamily(familyId, inviteUserId);

        if (added) {
            await bot.sendMessage(
                inviteUserId, 
                `👨‍👩‍👧‍👦 Вас пригласили в семью "${family.name}"!\nТеперь вы можете видеть и создавать общие задачи.`
            );
            await bot.sendMessage(userId, '✅ Пользователь приглашен в семью!');
        } else {
            await bot.sendMessage(userId, '❌ Пользователь уже в семье или ошибка добавления.');
        }
    } catch (error) {
        await bot.sendMessage(userId, '❌ Не удалось отправить приглашение. Возможно, пользователь не начал диалог с ботом.');
    }
});

// Команда /myfamily
bot.onText(/\/myfamily/, async (msg) => {
    const userId = msg.chat.id;
    
    const familyId = getUserFamily(userId);
    if (!familyId) {
        await bot.sendMessage(userId, '❌ Вы не состоите в семье.\nСоздайте семью: /createfamily [название]');
        return;
    }

    const family = families[familyId];
    let message = `👨‍👩‍👧‍👦 Семья "${family.name}"\n\nУчастники (${family.members.length}):\n`;
    
    for (const memberId of family.members) {
        message += `• ${memberId}\n`;
    }

    message += `\n💡 Для приглашения:\n/invite [ID пользователя]\n\nВаш ID: ${userId}`;

    await bot.sendMessage(userId, message);
});

// Команда /help
bot.onText(/\/help/, (msg) => {
    const userId = msg.chat.id;
    
    const helpMessage = `📖 Семейный задачник - команды:

/start - Открыть приложение
/mytasks - Мои задачи (личные и семейные)
/createfamily [название] - Создать семью
/invite [ID] - Пригласить в семью
/myfamily - Информация о семье
/help - Справка

📱 Основной функционал в Mini App:
• Создание личных и семейных задач
• Редактирование и удаление
• Просмотр всех задач семьи

💡 Ваш ID: ${userId} - поделитесь им для приглашения`;

    bot.sendMessage(userId, helpMessage).catch(error => {
        console.error('❌ Ошибка отправки сообщения:', error.message);
    });
});

// Endpoint для добавления задач из Mini App
app.post('/addtask', async (req, res) => {
    try {
        const taskData = req.body;
        
        console.log('📨 Получена новая задача:', taskData);

        if (!taskData.userId || !taskData.title || !taskData.datetime) {
            return res.status(400).json({ 
                success: false, 
                error: 'Не все обязательные поля заполнены' 
            });
        }

        const familyId = getUserFamily(taskData.userId);
        const isFamilyTask = taskData.isFamilyTask || false;

        const newTask = {
            id: Date.now().toString(),
            userId: taskData.userId,
            title: taskData.title,
            datetime: taskData.datetime,
            notified: false,
            createdAt: new Date().toISOString(),
            isFamilyTask: isFamilyTask,
            familyId: isFamilyTask ? familyId : null
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

        // Отправляем уведомление всем участникам семьи для семейных задач
        if (isFamilyTask && familyId) {
            const family = families[familyId];
            if (family) {
                for (const memberId of family.members) {
                    if (memberId !== taskData.userId.toString()) {
                        try {
                            await bot.sendMessage(
                                memberId, 
                                `👨‍👩‍👧‍👦 Новая семейная задача!\n"${taskData.title}"\n📅 ${new Date(taskData.datetime).toLocaleString('ru-RU')}`
                            );
                        } catch (tgError) {
                            console.error('❌ Не удалось отправить сообщение участнику:', tgError.message);
                        }
                    }
                }
            }
        }

        // Отправляем уведомление создателю
        try {
            const taskType = isFamilyTask ? 'семейная задача' : 'личная задача';
            await bot.sendMessage(
                taskData.userId, 
                `✅ ${taskType} "${taskData.title}" добавлена!\n📅 Напоминание придет за 5 часов до начала.`
            );
        } catch (tgError) {
            console.error('❌ Не удалось отправить сообщение в Telegram:', tgError.message);
        }

        res.status(200).json({ 
            success: true, 
            message: 'Задача добавлена',
            taskId: newTask.id,
            isFamilyTask: isFamilyTask
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
        const familyId = getUserFamily(userId);
        
        // Показываем свои задачи + задачи семьи
        const userTasks = tasks.filter(task => 
            task.userId == userId || 
            (task.familyId && task.familyId === familyId)
        );
        
        res.status(200).json({ 
            success: true, 
            tasks: userTasks,
            count: userTasks.length,
            familyId: familyId,
            family: familyId ? families[familyId] : null
        });
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении задач' 
        });
    }
});

// Endpoint для обновления задачи
app.put('/updatetask', async (req, res) => {
    try {
        const { taskId, userId, title, datetime } = req.body;
        
        console.log('✏️ Запрос на обновление задачи:', { taskId, userId, title, datetime });

        if (!taskId || !userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'taskId и userId обязательны' 
            });
        }

        const tasks = await getTasks();
        const taskIndex = tasks.findIndex(task => task.id === taskId);
        
        if (taskIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Задача не найдена' 
            });
        }

        // Проверяем права на редактирование
        const task = tasks[taskIndex];
        const familyId = getUserFamily(userId);
        if (task.userId != userId && (!task.familyId || task.familyId !== familyId)) {
            return res.status(403).json({ 
                success: false, 
                error: 'Нет прав для редактирования этой задачи' 
            });
        }

        // Обновляем поля
        if (title) tasks[taskIndex].title = title;
        if (datetime) {
            tasks[taskIndex].datetime = datetime;
            tasks[taskIndex].notified = false;
        }

        const saved = await saveTasks(tasks);

        if (!saved) {
            return res.status(500).json({ 
                success: false, 
                error: 'Ошибка сохранения изменений' 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Задача обновлена',
            task: tasks[taskIndex]
        });

    } catch (error) {
        console.error('❌ Ошибка обновления задачи:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при обновлении задачи' 
        });
    }
});

// Endpoint для удаления задачи
app.delete('/deletetask', async (req, res) => {
    try {
        const { taskId, userId } = req.body;
        
        console.log('🗑️ Запрос на удаление задачи:', { taskId, userId });

        if (!taskId || !userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'taskId и userId обязательны' 
            });
        }

        const tasks = await getTasks();
        const taskIndex = tasks.findIndex(task => task.id === taskId);
        
        if (taskIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Задача не найдена' 
            });
        }

        // Проверяем права на удаление
        const task = tasks[taskIndex];
        const familyId = getUserFamily(userId);
        if (task.userId != userId && (!task.familyId || task.familyId !== familyId)) {
            return res.status(403).json({ 
                success: false, 
                error: 'Нет прав для удаления этой задачи' 
            });
        }

        const deletedTask = tasks[taskIndex];
        tasks.splice(taskIndex, 1);

        const saved = await saveTasks(tasks);

        if (!saved) {
            return res.status(500).json({ 
                success: false, 
                error: 'Ошибка сохранения изменений' 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Задача удалена'
        });

    } catch (error) {
        console.error('❌ Ошибка удаления задачи:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при удалении задачи' 
        });
    }
});

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    console.log('📨 Получен webhook от Telegram');
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check endpoints
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Family Task Manager Bot is running',
        service: 'Telegram Family Tasks Bot',
        timestamp: new Date().toISOString(),
        webhook: true
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Family Task Manager Bot',
        time: new Date().toLocaleString('ru-RU'),
        uptime: process.uptime(),
        familiesCount: Object.keys(families).length
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

            if (hoursDiff <= 5 && hoursDiff > 0) {
                const message = `🔔 Напоминание!\nЧерез ${Math.round(hoursDiff)} часа начнется:\n"${task.title}"`;
                
                // Для личных задач - только создателю
                if (!task.isFamilyTask) {
                    try {
                        await bot.sendMessage(task.userId, message);
                        console.log(`✅ Уведомление отправлено пользователю ${task.userId} для задачи "${task.title}"`);
                        task.notified = true;
                        notificationsSent++;
                    } catch (error) {
                        console.error(`❌ Не удалось отправить уведомление пользователю ${task.userId}:`, error.message);
                    }
                } else {
                    // Для семейных задач - всем участникам семьи
                    const family = families[task.familyId];
                    if (family) {
                        for (const memberId of family.members) {
                            try {
                                await bot.sendMessage(memberId, message);
                                console.log(`✅ Семейное уведомление отправлено пользователю ${memberId} для задачи "${task.title}"`);
                            } catch (error) {
                                console.error(`❌ Не удалось отправить уведомление участнику ${memberId}:`, error.message);
                            }
                        }
                        task.notified = true;
                        notificationsSent++;
                    }
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

// Настройка webhook при запуске
async function setupWebhook() {
    try {
        const webhookUrl = `https://${RAILWAY_URL}/webhook`;
        await bot.setWebHook(webhookUrl);
        console.log(`✅ Webhook установлен: ${webhookUrl}`);
    } catch (error) {
        console.error('❌ Ошибка настройки webhook:', error.message);
    }
}

// Запускаем сервер
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
    console.log(`🔗 Railway URL: https://${RAILWAY_URL}`);
    
    // Загружаем данные и настраиваем webhook
    await loadData();
    await setupWebhook();
    
    console.log('✅ Семейный задачник готов к работе с Webhook!');
});

// Обработка ошибок бота
bot.on('error', (error) => {
    console.error('❌ Ошибка бота:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Получен SIGTERM, graceful shutdown...');
    process.exit(0);
});
