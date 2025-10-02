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

// Функция для создания семьи
async function createFamily(userId, familyName) {
    try {
        const familyId = Date.now().toString();
        families[familyId] = {
            id: familyId,
            name: familyName,
            members: [userId.toString()],
            createdBy: userId,
            createdAt: new Date().toISOString()
        };
        
        const tasks = await getTasks();
        const saved = await saveTasks(tasks);
        
        if (!saved) {
            throw new Error('Не удалось сохранить семью');
        }
        
        console.log(`✅ Семья создана: ${familyName} (ID: ${familyId})`);
        return familyId;
    } catch (error) {
        console.error('❌ Ошибка создания семьи:', error);
        throw error;
    }
}

// Функция для добавления участника в семью
async function addToFamily(familyId, userId) {
    try {
        if (families[familyId] && !families[familyId].members.includes(userId.toString())) {
            families[familyId].members.push(userId.toString());
            
            const tasks = await getTasks();
            const saved = await saveTasks(tasks);
            
            if (!saved) {
                throw new Error('Не удалось сохранить изменения');
            }
            
            console.log(`✅ Пользователь ${userId} добавлен в семью ${familyId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Ошибка добавления в семью:', error);
        throw error;
    }
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;
    const userName = msg.from.first_name || 'Пользователь';
    
    console.log(`👋 Пользователь ${userName} (${userId}) запустил бота`);

    const familyId = getUserFamily(userId);
    const familyText = familyId ? `\n👨‍👩‍👧‍👦 Вы в семье "${families[familyId].name}"` : '\n💡 Используйте /createfamily чтобы создать семью';

    const keyboard = {
        inline_keyboard: [[{
            text: '📋 Открыть задачи',
            web_app: { url: MINI_APP_URL }
        }]]
    };

    const welcomeMessage = `👋 Привет, ${userName}!\n\nДобро пожаловать в Семейный задачник!${familyText}\n\n📝 Создавайте задачи\n🔔 Получайте напоминания\n👨‍👩‍👧‍👦 Работайте вместе с семьей\n\nНажмите кнопку ниже чтобы открыть приложение:`;

    bot.sendMessage(userId, welcomeMessage, {
        reply_markup: keyboard
    }).catch(error => {
        console.error('❌ Ошибка отправки:', error.message);
    });
});

// Команда /createfamily
bot.onText(/\/createfamily (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    const familyName = match[1];

    try {
        if (getUserFamily(userId)) {
            await bot.sendMessage(userId, '❌ Вы уже состоите в семье!');
            return;
        }

        if (familyName.length < 2 || familyName.length > 50) {
            await bot.sendMessage(userId, '❌ Название семьи должно быть от 2 до 50 символов');
            return;
        }

        const familyId = await createFamily(userId, familyName);
        await bot.sendMessage(userId, 
            `✅ Семья "${familyName}" создана!\n\n` +
            `Теперь вы можете приглашать других участников командой:\n` +
            `/invite [ID пользователя]\n\n` +
            `💡 Ваш ID: ${userId}\n` +
            `Поделитесь им с теми, кого хотите пригласить.`
        );
        
    } catch (error) {
        console.error('❌ Ошибка при создании семьи:', error);
        await bot.sendMessage(userId, '❌ Ошибка при создании семьи. Пожалуйста, попробуйте позже.');
    }
});

// Команда /invite
bot.onText(/\/invite (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    const inviteUserId = match[1];

    try {
        const familyId = getUserFamily(userId);
        if (!familyId) {
            await bot.sendMessage(userId, '❌ Вы не состоите в семье! Создайте семью сначала командой /createfamily [название]');
            return;
        }

        const family = families[familyId];
        const added = await addToFamily(familyId, inviteUserId);

        if (added) {
            // Отправляем уведомление приглашенному
            try {
                await bot.sendMessage(
                    inviteUserId, 
                    `👨‍👩‍👧‍👦 Вас пригласили в семью "${family.name}"!\n\n` +
                    `Теперь вы можете видеть и создавать общие задачи.`
                );
            } catch (tgError) {
                console.error('❌ Не удалось отправить уведомление приглашенному:', tgError.message);
            }

            await bot.sendMessage(userId, '✅ Пользователь приглашен в семью!');
        } else {
            await bot.sendMessage(userId, '❌ Пользователь уже в семье или ошибка добавления.');
        }
    } catch (error) {
        console.error('❌ Ошибка приглашения:', error);
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
        try {
            const user = await bot.getChatMember(memberId, memberId);
            const userName = user.user.first_name || `Пользователь ${memberId}`;
            message += `• ${userName} (ID: ${memberId})\n`;
        } catch (error) {
            message += `• Пользователь ${memberId}\n`;
        }
    }

    message += `\n💡 Для приглашения:\n/invite [ID пользователя]\n\nВаш ID: ${userId}`;

    await bot.sendMessage(userId, message);
});

// Команда /mytasks
bot.onText(/\/mytasks/, async (msg) => {
    const userId = msg.chat.id;
    
    console.log(`📋 Запрос задач от пользователя ${userId}`);

    try {
        const tasks = await getTasks();
        const familyId = getUserFamily(userId);
        
        // Показываем свои задачи + задачи семьи
        const userTasks = tasks.filter(task => 
            task.userId == userId || 
            (task.familyId && task.familyId === familyId)
        );
        
        console.log(`📊 Найдено задач пользователя: ${userTasks.length}`);

        if (userTasks.length === 0) {
            await bot.sendMessage(userId, '📝 У вас пока нет задач.\n\nОткройте Mini App через /start чтобы создать первую задачу!');
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
        console.log(`✅ Список задач отправлен пользователю ${userId}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        await bot.sendMessage(userId, '❌ Ошибка при загрузке задач');
    }
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
        console.error('❌ Ошибка отправки:', error.message);
    });
});

// ========== НОВЫЕ ЭНДПОИНТЫ ДЛЯ MINI APP ==========

// Эндпоинт для создания семьи из Mini App
app.post('/createfamily', async (req, res) => {
    try {
        const { userId, familyName } = req.body;
        
        console.log('🏠 Запрос на создание семьи:', { userId, familyName });

        if (!userId || !familyName) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId и familyName обязательны' 
            });
        }

        if (getUserFamily(userId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Вы уже состоите в семье' 
            });
        }

        const familyId = await createFamily(userId, familyName);

        res.status(200).json({ 
            success: true, 
            message: 'Семья создана',
            familyId: familyId,
            family: families[familyId]
        });

    } catch (error) {
        console.error('❌ Ошибка создания семьи:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании семьи' 
        });
    }
});

// Эндпоинт для приглашения в семью из Mini App
app.post('/invitetofamily', async (req, res) => {
    try {
        const { userId, inviteUserId } = req.body;
        
        console.log('📨 Запрос на приглашение:', { userId, inviteUserId });

        if (!userId || !inviteUserId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId и inviteUserId обязательны' 
            });
        }

        const familyId = getUserFamily(userId);
        if (!familyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Вы не состоите в семье' 
            });
        }

        const family = families[familyId];
        const added = await addToFamily(familyId, inviteUserId);

        if (added) {
            // Отправляем уведомление приглашенному
            try {
                await bot.sendMessage(
                    inviteUserId, 
                    `👨‍👩‍👧‍👦 Вас пригласили в семью "${family.name}"!\n\n` +
                    `Теперь вы можете видеть и создавать общие задачи.`
                );
            } catch (tgError) {
                console.error('❌ Не удалось отправить уведомление приглашенному:', tgError.message);
            }

            res.status(200).json({ 
                success: true, 
                message: 'Пользователь приглашен в семью'
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Пользователь уже в семье или ошибка добавления' 
            });
        }

    } catch (error) {
        console.error('❌ Ошибка приглашения:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при приглашении' 
        });
    }
});

// Эндпоинт для получения информации о семье
app.post('/getfamily', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId обязателен' 
            });
        }

        const familyId = getUserFamily(userId);
        const family = familyId ? families[familyId] : null;

        res.status(200).json({ 
            success: true, 
            family: family,
            hasFamily: !!familyId
        });

    } catch (error) {
        console.error('❌ Ошибка получения семьи:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении информации о семье' 
        });
    }
});

// Обновленный эндпоинт для получения задач (добавляем информацию о семье)
app.post('/gettasks', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'userId обязателен' });

        const tasks = await getTasks();
        const familyId = getUserFamily(userId);
        
        // Показываем свои задачи + задачи семьи
        const userTasks = tasks.filter(task => 
            task.userId == userId || 
            (task.familyId && task.familyId === familyId)
        );
        
        res.json({ 
            success: true, 
            tasks: userTasks, 
            count: userTasks.length,
            family: familyId ? families[familyId] : null
        });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: 'Ошибка загрузки' });
    }
});

// Обновленный эндпоинт для добавления задач (добавляем поддержку семейных задач)
app.post('/addtask', async (req, res) => {
    try {
        const taskData = req.body;
        console.log('📨 Новая задача:', taskData);

        if (!taskData.userId || !taskData.title || !taskData.datetime) {
            return res.status(400).json({ success: false, error: 'Заполните все поля' });
        }

        const familyId = getUserFamily(taskData.userId);
        const isFamilyTask = taskData.isFamilyTask || false;

        // Проверяем, можно ли создать семейную задачу
        if (isFamilyTask && !familyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Для создания семейной задачи нужно состоять в семье' 
            });
        }

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
        await saveTasks(tasks);

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

        // Уведомление пользователю
        try {
            const taskType = isFamilyTask ? 'семейная задача' : 'личная задача';
            await bot.sendMessage(
                taskData.userId, 
                `✅ ${taskType} "${taskData.title}" добавлена!\n📅 Напоминание придет за 5 часов до начала.`
            );
        } catch (error) {
            console.error('❌ Не удалось отправить уведомление:', error.message);
        }

        res.json({ success: true, message: 'Задача добавлена', taskId: newTask.id });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Family Task Manager Bot is running',
        familiesCount: Object.keys(families).length
    });
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
