const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const { initGemini, generateGeminiResponse } = require('./providers/gemini');
const config = require('./config').default;
const ContactManager = require('./utils/contact-manager');

let botReadyTimestamp = null;
let contactManager;

// Переменные для автоматической рассылки
let autoSendingActive = false;
let autoSendingInterval = null;

const start = async () => {
    console.log('🚀 Starting WhatsApp Advanced Bot...');

    // Инициализируем менеджер контактов
    contactManager = new ContactManager();

    // Используем файловую аутентификацию
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
    });

    // Обработка подключения
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Показываем QR код
        if (qr) {
            console.log('\n📱 QR Code for WhatsApp Web:');
            console.log('Copy this text and convert to QR: ' + qr);
            console.log('Or use online QR generator with this text ^\n');
            
            try {
                qrcode.generate(qr, { small: true });
            } catch (e) {
                console.log('QR generation failed, use the text above');
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting: ' + shouldReconnect);
            
            if (shouldReconnect) {
                start();
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');
            botReadyTimestamp = new Date();
            
            // Initialize Gemini
            try {
                initGemini();
                console.log("✓ Gemini AI initialized successfully");
            } catch (error) {
                console.log("✗ Failed to initialize Gemini: " + error.message);
            }

            // Показываем статистику при запуске
            const stats = contactManager.getStats();
            console.log(`📊 Статистика: ${stats.contacts.total} контактов, отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}`);
        }
    });

    // Сохранение учетных данных
    sock.ev.on('creds.update', saveCreds);

    // Обработка входящих сообщений от других пользователей
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        
        if (!message.message) return;
        if (message.key.fromMe === true) return;
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';

        if (!messageText) return;

        console.log(`[INCOMING MESSAGE] From ${message.key.remoteJid}: ${messageText}`);

        try {
            // ТОЛЬКО команды помощи - НЕТ автоответов ИИ!
            if (messageText.startsWith('!help')) {
                await handlePublicHelp(sock, message);
            }

            // ВСЕ ОСТАЛЬНЫЕ СООБЩЕНИЯ ИГНОРИРУЕМ
            
        } catch (error) {
            console.log(`Error handling incoming message: ${error.message}`);
        }
    });

    // Обработка собственных сообщений (команды управления) - ТОЛЬКО ДЛЯ СОБСТВЕННЫХ СООБЩЕНИЙ
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        
        if (!message.message) return;
        if (message.key.fromMe !== true) return; // ТОЛЬКО свои сообщения
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';

        if (!messageText) return;

        console.log(`[OWN MESSAGE] Received: ${messageText}`);

        try {
            // === КОМАНДЫ УПРАВЛЕНИЯ КОНТАКТАМИ ===
            
            if (messageText.startsWith('!add ')) {
                await handleAddContact(sock, message, messageText);
                return;
            }

            if (messageText.startsWith('!import')) {
                await handleImport(sock, message, messageText);
                return;
            }

            if (messageText === '!scan') {
                await handleScanUploads(sock, message);
                return;
            }

            if (messageText === '!list') {
                await handleListContacts(sock, message);
                return;
            }

            if (messageText === '!stats') {
                await handleStats(sock, message);
                return;
            }

            if (messageText === '!clean') {
                await handleClean(sock, message);
                return;
            }

            if (messageText === '!clear') {
                await handleClearAllContacts(sock, message);
                return;
            }

            if (messageText === '!clear confirm') {
                await handleClearConfirm(sock, message);
                return;
            }

            if (messageText === '!validate') {
                await handleValidateContacts(sock, message);
                return;
            }

            if (messageText === '!quickvalidate') {
                await handleQuickValidate(sock, message);
                return;
            }

            if (messageText === '!cleaninvalid') {
                await handleCleanInvalidContacts(sock, message);
                return;
            }

            if (messageText === '!cleanpending') {
                await handleCleanPending(sock, message);
                return;
            }

            // === КОМАНДЫ РАССЫЛКИ ===

            if (messageText === '!send') {
                await handleSmartSending(sock, message, config.massMessageText);
                return;
            }

            if (messageText === '!send1') {
                await handleSmartSending(sock, message, config.massMessageText1);
                return;
            }

            if (messageText === '!send2') {
                await handleSmartSending(sock, message, config.massMessageText2);
                return;
            }

            if (messageText === '!send3') {
                await handleSmartSending(sock, message, config.massMessageText3);
                return;
            }

            if (messageText.startsWith('!send ')) {
                await handleSmartSending(sock, message, messageText.replace('!send ', ''));
                return;
            }

            if (messageText.startsWith('!batch ')) {
                await handleBatchSending(sock, message, messageText);
                return;
            }

            if (messageText === '!test') {
                await handleTestPersonalization(sock, message);
                return;
            }

            if (messageText === '!texts') {
                await handleShowTexts(sock, message);
                return;
            }

            // === АВТОМАТИЧЕСКАЯ РАССЫЛКА ===

            if (messageText === '!autostart') {
                await handleSimpleAutoSending(sock, message);
                return;
            }

            if (messageText === '!autostop') {
                await handleStopAutoSending(sock, message);
                return;
            }

            if (messageText === '!autostatus') {
                await handleAutoStatus(sock, message);
                return;
            }

            if (messageText === '!resetcounter') {
                await handleResetCounter(sock, message);
                return;
            }

            if (messageText.startsWith('!setcounter')) {
                await handleSetCounter(sock, message, messageText);
                return;
            }

            if (messageText === '!resetstats') {
                await handleResetStats(sock, message);
                return;
            }

            if (messageText === '!resetsent') {
                await handleResetSentStatus(sock, message);
                return;
            }

            if (messageText === '!continue') {
                const stats = contactManager.getStats();
                const allContacts = contactManager.getAllContacts().filter(c => c.status === 'active');
                const sentContacts = allContacts.filter(c => c.lastSent);
                const unsentContacts = allContacts.filter(c => !c.lastSent);
                
                await sendReply(sock, message, `
            📊 СОСТОЯНИЕ РАССЫЛКИ:

            📱 Всего активных: ${allContacts.length}
            ✅ Уже отправлено: ${sentContacts.length} контактам  
            ⏳ Осталось: ${unsentContacts.length} контактам
            📤 Лимит сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}

            🚀 Для продолжения: !autostart
                `);
                return;
            }

            if (messageText === '!debug') {
                const allContacts = contactManager.getAllContacts().filter(c => c.status === 'active');
                const sentContacts = allContacts.filter(c => c.lastSent);
                const unsentContacts = allContacts.filter(c => !c.lastSent);
                
                let response = `🔍 ОТЛАДКА КОНТАКТОВ:\n\n`;
                response += `✅ ОТПРАВЛЕНО (${sentContacts.length}):\n`;
                sentContacts.slice(0, 15).forEach((contact, i) => {
                    response += `${i+1}. ${contact.phone} (${contact.name})\n`;
                });
                
                response += `\n⏳ НЕ ОТПРАВЛЕНО (${unsentContacts.length}):\n`;
                unsentContacts.slice(0, 15).forEach((contact, i) => {
                    response += `${i+1}. ${contact.phone} (${contact.name})\n`;
                });
                
                await sendReply(sock, message, response);
                return;
            }

            if (messageText === '!markfirst10') {
                const allContacts = contactManager.getAllContacts().filter(c => c.status === 'active');
                const first10 = allContacts.slice(0, 9);
                
                first10.forEach(contact => {
                    contact.lastSent = new Date();
                    contact.sentCount = 1;
                });
                
                contactManager.saveContacts();
                
                await sendReply(sock, message, `✅ Помечены первые 10 контактов как отправленные:\n${first10.map(c => `• ${c.phone} (${c.name})`).join('\n')}`);
                return;
            }

            // === AI КОМАНДЫ ===

            if (messageText.startsWith('!ai') || messageText.startsWith('!gpt')) {
                const prompt = messageText.replace(/^!(ai|gpt)\s*/, '');
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt);
                }
                return;
            }

            if (messageText === '!help') {
                await handleAdvancedHelp(sock, message);
                return;
            }

        } catch (error) {
            console.log(`Error handling own message: ${error.message}`);
        }
    });
};

// === ОБРАБОТЧИКИ КОМАНД ===

// Функция для публичной справки (для других пользователей)
const handlePublicHelp = async (sock, message) => {
    const helpText = `
🤖 WhatsApp Bot

ℹ️ Этот бот предназначен только для рассылки.
Автоматические ответы отключены.

Если у вас есть вопросы, свяжитесь с администратором напрямую.
    `;
    await sendReply(sock, message, helpText);
};

const handleCleanPending = async (sock, message) => {
    const removed = contactManager.cleanPendingContacts();
    await sendReply(sock, message, `🧹 Удалено ${removed} контактов в ожидании`);
};

const handleResetCounter = async (sock, message) => {
    const stats = contactManager.getStats();
    const oldCount = stats.sending.sentToday;
    
    // Сбрасываем счетчик
    contactManager.stats.sentToday = 10; // Ставим 10 (реально отправленные)
    contactManager.saveStats();
    
    await sendReply(sock, message, `
🔄 СЧЕТЧИК ОТПРАВОК ИСПРАВЛЕН:

📊 Было: ${oldCount}/100
📊 Стало: 10/100

✅ Теперь у вас осталось 90 отправок на сегодня!
🚀 Можете продолжать рассылку: !autostart или !continue
    `);
};

const handleSetCounter = async (sock, message, text) => {
    const args = text.replace('!setcounter', '').trim();
    const newCount = parseInt(args);
    
    if (isNaN(newCount) || newCount < 0 || newCount > 100) {
        await sendReply(sock, message, 'Использование: !setcounter число\nПример: !setcounter 10');
        return;
    }
    
    const oldTodayCount = contactManager.stats.sentToday;
    const oldTotalCount = contactManager.stats.totalSent;
    
    // Исправляем оба счетчика
    contactManager.stats.sentToday = newCount;
    contactManager.stats.totalSent = newCount; // Тоже ставим правильное значение
    contactManager.saveStats();
    
    await sendReply(sock, message, `
🔄 СЧЕТЧИКИ ИСПРАВЛЕНЫ:

📊 СЕГОДНЯ:
• Было: ${oldTodayCount}/100  
• Стало: ${newCount}/100
• Осталось: ${100 - newCount}

📊 ВСЕГО ОТПРАВЛЕНО:
• Было: ${oldTotalCount}
• Стало: ${newCount}

✅ Теперь все счетчики правильные!
${newCount >= 100 ? '⚠️ Лимит исчерпан!' : '🚀 Можете продолжать рассылку!'}
    `);
};

const handleResetStats = async (sock, message) => {
    const oldStats = contactManager.getStats();
    
    // Полный сброс статистики
    contactManager.stats = {
        date: new Date().toISOString().split('T')[0],
        sentToday: 0,
        totalSent: 0,
        lastBatchTime: null
    };
    contactManager.saveStats();
    
    await sendReply(sock, message, `
🔄 СТАТИСТИКА ПОЛНОСТЬЮ СБРОШЕНА:

📊 ДО СБРОСА:
• Сегодня: ${oldStats.sending.sentToday}/100
• Всего: ${oldStats.sending.totalSent}

📊 ПОСЛЕ СБРОСА:  
• Сегодня: 0/100
• Всего: 0
• Доступно: 100 отправок

🆕 Статистика начинается с нуля!
    `);
};


const handleAddContact = async (sock, message, text) => {
    const args = text.replace('!add', '').trim().split(',');
    const phone = args[0]?.trim();
    const name = args[1]?.trim();

    if (!phone) {
        await sendReply(sock, message, 'Использование: !add +номер[,имя]\nПример: !add +77012345678,Иван Петров');
        return;
    }

    const result = contactManager.addContact(phone, name);
    await sendReply(sock, message, result.message);
};

const handleImport = async (sock, message, text) => {
    const filePath = text.replace('!import', '').trim();
    
    if (!filePath) {
        await sendReply(sock, message, 'Использование: !import путь/к/файлу.txt\nПример: !import uploads/numbers.txt');
        return;
    }

    const result = contactManager.importFromFile(filePath);
    
    let response = `📁 Импорт завершен:\n✅ Добавлено: ${result.added}`;
    
    if (result.errors.length > 0) {
        response += `\n❌ Ошибок: ${result.errors.length}`;
        if (result.errors.length <= 5) {
            response += '\n\nОшибки:\n' + result.errors.slice(0, 5).join('\n');
        }
    }

    await sendReply(sock, message, response);
};

const handleScanUploads = async (sock, message) => {
    const files = contactManager.scanUploadsFolder();
    
    if (files.length === 0) {
        await sendReply(sock, message, '📁 Папка uploads пуста.\n\nПоложите файлы с номерами в папку uploads/ и используйте команду !scan');
        return;
    }

    let response = `📁 Найдено файлов: ${files.length}\n\n`;
    let totalAdded = 0;

    for (const file of files) {
        const result = contactManager.importFromFile(file);
        response += `📄 ${file}:\n  ✅ Добавлено: ${result.added}\n  ❌ Ошибок: ${result.errors.length}\n\n`;
        totalAdded += result.added;
    }

    response += `🎉 Итого добавлено: ${totalAdded} контактов`;
    await sendReply(sock, message, response);
};

const handleListContacts = async (sock, message) => {
    const contacts = contactManager.getAllContacts();
    
    if (contacts.length === 0) {
        await sendReply(sock, message, '📱 Список контактов пуст');
        return;
    }

    const stats = contactManager.getStats();
    let response = `📱 Контакты (${contacts.length}):\n\n`;
    
    // Показываем первые 20 контактов
    const displayContacts = contacts.slice(0, 20);
    displayContacts.forEach((contact, index) => {
        const status = contact.status === 'active' ? '✅' : 
                      contact.status === 'blocked' ? '❌' : 
                      contact.status === 'pending' ? '⏳' : '❓';
        
        response += `${index + 1}. ${status} ${contact.phone}`;
        if (contact.name) response += ` (${contact.name})`;
        if (contact.source) response += ` [${contact.source}]`;
        response += '\n';
    });

    if (contacts.length > 20) {
        response += `\n... и еще ${contacts.length - 20} контактов`;
    }

    response += `\n📊 Статистика:\n✅ Активных: ${stats.contacts.active}\n⏳ Ожидают: ${stats.contacts.pending}\n❌ Заблокированных: ${stats.contacts.blocked}`;

    await sendReply(sock, message, response);
};

const handleStats = async (sock, message) => {
    const stats = contactManager.getStats();
    
    const response = `
📊 Детальная статистика:

📱 КОНТАКТЫ:
• Всего: ${stats.contacts.total}
• Активных: ${stats.contacts.active}
• В ожидании: ${stats.contacts.pending}
• Заблокированных: ${stats.contacts.blocked}

📤 ОТПРАВКА:
• Сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
• Всего отправлено: ${stats.sending.totalSent}
• Последний батч: ${stats.sending.lastBatch ? new Date(stats.sending.lastBatch).toLocaleString('ru') : 'Никогда'}

⚙️ ЛИМИТЫ:
• Максимум за батч: ${stats.limits.MAX_NUMBERS_PER_BATCH}
• Дневной лимит: ${stats.limits.DAILY_MESSAGE_LIMIT}
• Задержка: ${stats.limits.MIN_DELAY_BETWEEN_MESSAGES/1000}-${stats.limits.MAX_DELAY_BETWEEN_MESSAGES/1000} сек
• Пауза между батчами: ${stats.limits.BATCH_COOLDOWN/1000/60} мин
    `;
    
    await sendReply(sock, message, response);
};

const handleSmartSending = async (sock, message, messageToSend) => {
    // Автоматический умный батч
    const contacts = contactManager.getContactsForSending();
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для рассылки');
        return;
    }

    const limitCheck = contactManager.canSendMessages(contacts.length);
    if (!limitCheck.canSend) {
        await sendReply(sock, message, `❌ ${limitCheck.reason}`);
        return;
    }

    await sendSmartBatch(sock, message, contacts, messageToSend);
};

// Умная отправка батча с персонализацией
const sendSmartBatch = async (sock, message, contacts, messageTemplate) => {
    await sendReply(sock, message, `🚀 Начинаю персонализированную рассылку по ${contacts.length} контактам...`);

    let success = 0;
    let errors = 0;

    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        
        try {
            // Проверяем существование номера
            const checkResult = await sock.onWhatsApp(contact.phone.replace('+', ''));
            if (!checkResult || !Array.isArray(checkResult) || checkResult.length === 0 || !checkResult[0]?.exists) {
                console.log(`❌ ${contact.phone} не зарегистрирован в WhatsApp`);
                contactManager.markMessageSent(contact.phone, false);
                errors++;
                continue;
            }

            // Персонализируем сообщение с названием организации
            let personalizedMessage = messageTemplate;
            
            if (contact.name) {
                // Заменяем плейсхолдер {НазваниеОрганизации} на реальное название
                personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, contact.name);
                personalizedMessage = personalizedMessage.replace(/{название}/g, contact.name);
                personalizedMessage = personalizedMessage.replace(/{организация}/g, contact.name);
            } else {
                // Если нет названия, используем общее обращение
                personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, 'уважаемая компания');
                personalizedMessage = personalizedMessage.replace(/{название}/g, 'уважаемая компания');
                personalizedMessage = personalizedMessage.replace(/{организация}/g, 'уважаемая компания');
            }

            // Отправляем сообщение
            const jid = contact.phone.replace('+', '') + '@s.whatsapp.net';
            await sock.sendMessage(jid, { text: personalizedMessage });
            
            // Отмечаем успешную отправку
            contactManager.markMessageSent(contact.phone, true);
            success++;
            
            console.log(`✅ Отправлено: ${contact.phone} → ${contact.name || 'без названия'}`);

            // Прогресс для длинных рассылок
            if (contacts.length > 5 && (i + 1) % 5 === 0) {
                await sendReply(sock, message, `📊 Прогресс: ${i + 1}/${contacts.length} (✅${success} ❌${errors})`);
            }

            // Случайная задержка между сообщениями
            const delay = contactManager.getRandomDelay();
            console.log(`⏱️ Пауза ${delay/1000} секунд...`);
            await new Promise(resolve => setTimeout(resolve, delay));

        } catch (error) {
            console.log(`❌ Ошибка отправки ${contact.phone}: ${error.message}`);
            contactManager.markMessageSent(contact.phone, false);
            errors++;
        }
    }

    // Финальный отчет
    const stats = contactManager.getStats();
    const report = `
🎉 Персонализированная рассылка завершена!

📊 РЕЗУЛЬТАТ:
✅ Успешно: ${success}
❌ Ошибок: ${errors}
📱 Всего контактов: ${contacts.length}

📈 СТАТИСТИКА ДНЯ:
📤 Отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
🔄 Всего отправлено: ${stats.sending.totalSent}
    `;
    
    await sendReply(sock, message, report);
};

// Простая автоматическая рассылка с настройками из .env
const handleSimpleAutoSending = async (sock, message) => {
    if (autoSendingActive) {
        await sendReply(sock, message, '⚠️ Автоматическая рассылка уже запущена! Используйте !autostop для остановки.');
        return;
    }

    const batchSize = parseInt(process.env.MAX_NUMBERS_PER_BATCH || '10');
    const intervalMs = parseInt(process.env.BATCH_COOLDOWN || '900000');
    const intervalMinutes = intervalMs / 1000 / 60;
    const messageText = config.massMessageText;

    const allActiveContacts = contactManager.getAllContacts().filter(c => c.status === 'active');
    
    // ПРАВИЛЬНАЯ ЛОГИКА: Ищем контакты которым НЕ отправляли (без lastSent)
    const unsentContacts = allActiveContacts.filter(c => !c.lastSent);
    const sentContacts = allActiveContacts.filter(c => c.lastSent);
    
    if (allActiveContacts.length === 0) {
        await sendReply(sock, message, 'Нет активных контактов для рассылки. Сначала запустите !validate');
        return;
    }

    if (unsentContacts.length === 0) {
        await sendReply(sock, message, `✅ Рассылка уже завершена! Всем ${allActiveContacts.length} активным контактам уже отправлено.\n\n🔄 Для новой рассылки нужно добавить новые контакты.`);
        return;
    }

    // Проверяем можем ли отправлять
    const stats = contactManager.getStats();
    const remainingDaily = stats.sending.dailyLimit - stats.sending.sentToday;
    
    if (remainingDaily <= 0) {
        await sendReply(sock, message, `❌ Дневной лимит исчерпан (${stats.sending.sentToday}/${stats.sending.dailyLimit}). Попробуйте завтра.`);
        return;
    }

    // Ограничиваем рассылку оставшимся лимитом
    const contactsToSend = unsentContacts.slice(0, remainingDaily);
    
    // Разбиваем на батчи
    const batches = [];
    for (let i = 0; i < contactsToSend.length; i += batchSize) {
        batches.push(contactsToSend.slice(i, i + batchSize));
    }

    const isResume = sentContacts.length > 0; // Это продолжение?

    await sendReply(sock, message, `
🚀 ${isResume ? 'ПРОДОЛЖЕНИЕ' : 'ЗАПУСК'} АВТОМАТИЧЕСКОЙ РАССЫЛКИ

📊 АНАЛИЗ КОНТАКТОВ:
• Всего активных: ${allActiveContacts.length}
• Уже отправлено: ${sentContacts.length} контактам
• Осталось отправить: ${unsentContacts.length} контактам
• К отправке сейчас: ${contactsToSend.length} (лимит: ${remainingDaily})

📊 ПАРАМЕТРЫ РАССЫЛКИ:
• Размер батча: ${batchSize}
• Интервал: ${intervalMinutes} минут
• Всего батчей: ${batches.length}
• Общее время: ~${Math.ceil(batches.length * intervalMinutes / 60)} часов

📤 Текст сообщения:
${messageText}

${isResume ? '🔄 Продолжаем с того места где остановились!' : '🆕 Начинаем новую рассылку!'}

⏰ Первый батч отправляется через 10 секунд...
Для остановки: !autostop
Статус: !autostatus
    `);

    autoSendingActive = true;
    let currentBatch = 0;

    // Функция отправки одного батча
    const sendNextBatch = async () => {
        if (!autoSendingActive || currentBatch >= batches.length) {
            autoSendingActive = false;
            if (autoSendingInterval) {
                clearInterval(autoSendingInterval);
                autoSendingInterval = null;
            }
            
            // Подсчитываем финальную статистику
            const finalStats = contactManager.getStats();
            const totalSentNow = contactManager.getAllContacts().filter(c => c.lastSent).length;
            
            await sendReply(sock, message, `
🎉 АВТОМАТИЧЕСКАЯ РАССЫЛКА ЗАВЕРШЕНА!

📊 ИТОГОВАЯ СТАТИСТИКА:
• Обработано батчей: ${currentBatch}/${batches.length}
• Отправлено в этой сессии: ${Math.min(currentBatch * batchSize, contactsToSend.length)}
• Всего отправлено контактам: ${totalSentNow}/${allActiveContacts.length}
• Осталось: ${allActiveContacts.length - totalSentNow} контактов

📈 ЛИМИТЫ:
• Использовано сегодня: ${finalStats.sending.sentToday}/${finalStats.sending.dailyLimit}
• Осталось на сегодня: ${finalStats.sending.dailyLimit - finalStats.sending.sentToday}

🔄 СЛЕДУЮЩИЕ ШАГИ:
${allActiveContacts.length - totalSentNow > 0 ? 
  `• Осталось ${allActiveContacts.length - totalSentNow} контактов\n• Для продолжения: !autostart (завтра или когда лимит обновится)` : 
  '• ✅ Всем активным контактам отправлено!\n• Добавьте новые контакты для продолжения рассылки'}

Подробную статистику: !stats
            `);
            return;
        }

        const batch = batches[currentBatch];
        console.log(`[AUTO SENDING] Отправка батча ${currentBatch + 1}/${batches.length} (${batch.length} контактов)`);
        
        await sendReply(sock, message, `📤 Отправка батча ${currentBatch + 1}/${batches.length} (${batch.length} контактов)...\n\n👥 Контакты:\n${batch.map(c => `• ${c.phone} (${c.name || 'без названия'})`).join('\n')}`);
        
        try {
            await sendSmartBatch(sock, message, batch, messageText);
            currentBatch++;
            
            const remainingBatches = batches.length - currentBatch;
            const remainingContacts = remainingBatches * batchSize;
            
            if (currentBatch < batches.length) {
                await sendReply(sock, message, `✅ Батч ${currentBatch}/${batches.length} завершен.\n\n📊 Осталось:\n• Батчей: ${remainingBatches}\n• Контактов: ~${remainingContacts}\n⏰ Следующий через ${intervalMinutes} минут.`);
            }
        } catch (error) {
            console.log(`[AUTO SENDING] Ошибка в батче ${currentBatch + 1}: ${error.message}`);
            await sendReply(sock, message, `❌ Ошибка в батче ${currentBatch + 1}: ${error.message}`);
        }
    };

    // Запускаем первый батч через 10 секунд
    setTimeout(async () => {
        await sendNextBatch();
        
        // Запускаем интервал для остальных батчей
        if (batches.length > 1) {
            autoSendingInterval = setInterval(sendNextBatch, intervalMs);
        }
    }, 10000);
};

// Остановка автоматической рассылки
const handleStopAutoSending = async (sock, message) => {
    if (!autoSendingActive) {
        await sendReply(sock, message, 'ℹ️ Автоматическая рассылка не активна');
        return;
    }

    autoSendingActive = false;
    if (autoSendingInterval) {
        clearInterval(autoSendingInterval);
        autoSendingInterval = null;
    }

    await sendReply(sock, message, '🛑 Автоматическая рассылка ОСТАНОВЛЕНА');
};

// Статус автоматической рассылки
const handleAutoStatus = async (sock, message) => {
    const stats = contactManager.getStats();
    const batchSize = parseInt(process.env.MAX_NUMBERS_PER_BATCH || '10');
    const intervalMinutes = parseInt(process.env.BATCH_COOLDOWN || '900000') / 1000 / 60;
    
    const statusText = `
📊 СТАТУС АВТОМАТИЧЕСКОЙ РАССЫЛКИ

🤖 Статус: ${autoSendingActive ? '🟢 АКТИВНА' : '🔴 НЕАКТИВНА'}

⚙️ НАСТРОЙКИ ИЗ .ENV:
• Размер батча: ${batchSize}
• Интервал: ${intervalMinutes} минут
• Дневной лимит: ${stats.limits.DAILY_MESSAGE_LIMIT}

📱 КОНТАКТЫ:
• Всего: ${stats.contacts.total}
• Активных: ${stats.contacts.active}
• В ожидании: ${stats.contacts.pending}
• Заблокированных: ${stats.contacts.blocked}

📤 СЕГОДНЯ:
• Отправлено: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
• Всего отправлено: ${stats.sending.totalSent}

📝 ТЕКСТ РАССЫЛКИ:
${config.massMessageText}

🎯 КОМАНДЫ:
• !autostart - Запустить автоматическую рассылку
• !autostop - Остановить рассылку
• !autostatus - Этот статус
    `;
    
    await sendReply(sock, message, statusText);
};

const handleShowTexts = async (sock, message) => {
    const textsInfo = `
📝 ПЕРСОНАЛИЗИРОВАННЫЕ ТЕКСТЫ РАССЫЛКИ:

🤖 ОСНОВНОЙ ТЕКСТ (!send):
${config.massMessageText}

💼 ТЕКСТ 1 (!send1):
${config.massMessageText1}

🔥 ТЕКСТ 2 (!send2):
${config.massMessageText2}

⚡ ТЕКСТ 3 (!send3):
${config.massMessageText3}

📋 ПРИМЕР ПЕРСОНАЛИЗАЦИИ:
Для контакта "+77019321613,Астана Юрист"
Текст "{НазваниеОрганизации}" → "Астана Юрист"

📤 КОМАНДЫ:
!send - Рассылка основным текстом
!send1, !send2, !send3 - Рассылка готовыми текстами
!send СВОЙ ТЕКСТ - Рассылка кастомным текстом

✏️ В тексте используйте {НазваниеОрганизации} для автоподстановки
    `;
    await sendReply(sock, message, textsInfo);
};

const handleTestPersonalization = async (sock, message) => {
    const contacts = contactManager.getAllContacts().slice(0, 3); // Берем первые 3 контакта
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для тестирования персонализации');
        return;
    }

    let testResults = '🧪 ТЕСТ ПЕРСОНАЛИЗАЦИИ:\n\n';
    
    for (const contact of contacts) {
        let personalizedMessage = config.massMessageText;
        
        if (contact.name) {
            // Заменяем плейсхолдер {НазваниеОрганизации} на реальное название
            personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, contact.name);
            personalizedMessage = personalizedMessage.replace(/{название}/g, contact.name);
            personalizedMessage = personalizedMessage.replace(/{организация}/g, contact.name);
        } else {
            // Если нет названия, используем общее обращение
            personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, 'уважаемая компания');
            personalizedMessage = personalizedMessage.replace(/{название}/g, 'уважаемая компания');
            personalizedMessage = personalizedMessage.replace(/{организация}/g, 'уважаемая компания');
        }
        
        testResults += `📱 ${contact.phone} → ${contact.name || 'без названия'}\n`;
        testResults += `📝 Персонализированный текст:\n${personalizedMessage}\n\n---\n\n`;
    }
    
    await sendReply(sock, message, testResults);
};

const handleValidateContacts = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    
    if (allContacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для валидации');
        return;
    }

    await sendReply(sock, message, `🔍 Валидирую ${allContacts.length} контактов (БЕЗ трат лимита отправок)...`);
    
    let validNumbers = 0;
    let invalidNumbers = 0;
    let whatsappChecked = 0;
    let whatsappValid = 0;
    let whatsappInvalid = 0;
    
    // Проверяем ВСЕ номера БЕЗ ТРАТ ЛИМИТА
    for (let i = 0; i < allContacts.length; i++) {
        const contact = allContacts[i];
        
        // Проверяем формат номера
        if (!contactManager.isValidMobileNumber(contact.phone)) {
            invalidNumbers++;
            contact.status = 'invalid'; // Помечаем как невалидный БЕЗ ТРАТ ЛИМИТА
            continue;
        }
        
        validNumbers++;
        
        // Проверяем в WhatsApp КАЖДЫЙ номер БЕЗ ОТПРАВКИ СООБЩЕНИЙ
        try {
            const checkResult = await sock.onWhatsApp(contact.phone.replace('+', ''));
            if (checkResult && Array.isArray(checkResult) && checkResult.length > 0 && checkResult[0]?.exists) {
                whatsappValid++;
                contact.status = 'active'; // Помечаем как готовый к рассылке БЕЗ ТРАТ ЛИМИТА
            } else {
                whatsappInvalid++;
                contact.status = 'invalid'; // Помечаем как недоступный БЕЗ ТРАТ ЛИМИТА
            }
            whatsappChecked++;
            
            // Показываем прогресс каждые 10 номеров
            if (whatsappChecked % 10 === 0) {
                await sendReply(sock, message, `⏳ Проверено в WhatsApp: ${whatsappChecked}/${allContacts.length} (✅${whatsappValid} ❌${whatsappInvalid})`);
            }
            
            // Пауза между проверками чтобы не заблокировали
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды
            
        } catch (error) {
            // При ошибке помечаем как недоступный БЕЗ ТРАТ ЛИМИТА
            whatsappInvalid++;
            whatsappChecked++;
            contact.status = 'invalid';
            
            // Если слишком много ошибок подряд - увеличиваем паузу
            if (error.message.includes('rate') || error.message.includes('limit')) {
                await sendReply(sock, message, '⚠️ Обнаружено ограничение скорости, увеличиваю паузу...');
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 секунд пауза
            }
        }
    }

    // Сохраняем изменения БЕЗ ТРАТ ЛИМИТА ОТПРАВОК
    contactManager.saveContacts();

    const report = `
📊 ПОЛНАЯ ВАЛИДАЦИЯ ЗАВЕРШЕНА (БЕЗ ТРАТ ЛИМИТА):

📱 ФОРМАТ НОМЕРОВ:
✅ Валидных: ${validNumbers}
❌ Невалидных: ${invalidNumbers}

💬 ПРОВЕРКА WHATSAPP (${whatsappChecked} номеров):
✅ Активных в WhatsApp: ${whatsappValid}
❌ Неактивных в WhatsApp: ${whatsappInvalid}

📈 ИТОГО:
• Всего проверено: ${allContacts.length}
• Готовых к рассылке: ${whatsappValid}
• Процент валидных: ${Math.round((whatsappValid / allContacts.length) * 100)}%

🎯 РЕКОМЕНДАЦИИ:
• Используйте !cleaninvalid для удаления невалидных
• Готово к рассылке: ${whatsappValid} номеров
• Лимит отправок НЕ потрачен!
    `;
    
    await sendReply(sock, message, report);
};

const handleAdvancedHelp = async (sock, message) => {
    const helpText = `
🤖 WhatsApp Продвинутый Бот для Рассылки

📱 УПРАВЛЕНИЕ КОНТАКТАМИ:
!add +номер[,имя] - Добавить контакт
!import путь/файл.txt - Импорт из файла
!scan - Сканировать папку uploads/
!list - Показать контакты
!validate - Валидировать все номера
!clean - Удалить заблокированные
!cleaninvalid - Удалить невалидные номера
!clear - Очистить ВСЕ контакты
!stats - Детальная статистика

📤 БЫСТРАЯ РАССЫЛКА (готовые тексты):
!send - Основной текст рассылки
!send1 - Альтернативный текст 1  
!send2 - Альтернативный текст 2
!send3 - Альтернативный текст 3
!texts - Показать все готовые тексты
!test - Тестировать персонализацию

📤 КАСТОМНАЯ РАССЫЛКА:
!send СВОЙ ТЕКСТ - Рассылка кастомным текстом
!batch 15 ТЕКСТ - Конкретный размер батча

🤖 УМНАЯ АВТОМАТИЧЕСКАЯ РАССЫЛКА:
!autostart - Запустить/продолжить автоматическую рассылку
!autostop - Остановить автоматическую рассылку
!autostatus - Статус и настройки рассылки

🤖 AI ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА:
!ai вопрос - Общение с Gemini (только вы)

⚙️ УПРАВЛЕНИЕ СЧЕТЧИКАМИ:
!setcounter число - Установить счетчик отправок
!resetstats - Сбросить всю статистику

⚠️ ВАЖНО:
• Автоответы ИИ ОТКЛЮЧЕНЫ
• Бот НЕ отвечает на обычные сообщения
• Только рассылка и управление контактами
• AI доступен только владельцу

📋 ПРИМЕРЫ:
!scan - импорт номеров
!validate - проверка всех номеров
!autostart - умная рассылка (сама найдет где остановилась)
!autostatus - проверить статус
!autostop - остановить рассылку

⚡ ЛИМИТЫ БЕЗОПАСНОСТИ:
• Максимум 10 номеров за раз
• 100 сообщений в день  
• Пауза 15 минут между батчами
• Случайные задержки 5-10 сек

🎯 ТЕПЕРЬ !autostart УМНЫЙ:
• Сам определяет кому уже отправлено
• Продолжает с нужного места
• Не дублирует отправки
• Показывает подробную статистику
    `;
    await sendReply(sock, message, helpText);
};

const handleAI = async (sock, message, prompt) => {
    try {
        console.log(`[AI] Processing: ${prompt}`);
        
        const response = await generateGeminiResponse(prompt, message.key.remoteJid || 'unknown');
        await sendReply(sock, message, response);
        
        console.log(`[AI] Response sent: ${response.substring(0, 100)}...`);
    } catch (error) {
        console.log(`[AI] Error: ${error.message}`);
        await sendReply(sock, message, 'Ошибка при обработке запроса: ' + error.message);
    }
};

// Добавь эти функции в index-advanced.js перед sendReply

const handleClean = async (sock, message) => {
    const removed = contactManager.cleanBlockedContacts();
    await sendReply(sock, message, `🧹 Удалено ${removed} заблокированных контактов`);
};

const handleClearAllContacts = async (sock, message) => {
    const totalContacts = contactManager.getAllContacts().length;
    
    if (totalContacts === 0) {
        await sendReply(sock, message, 'ℹ️ Список контактов уже пуст');
        return;
    }

    await sendReply(sock, message, `⚠️ Вы уверены, что хотите удалить ВСЕ ${totalContacts} контактов?\n\nОтправьте "!clear confirm" для подтверждения`);
};

const handleClearConfirm = async (sock, message) => {
    const cleared = contactManager.clearAllContacts();
    await sendReply(sock, message, `🗑️ Удалено ${cleared} контактов. Список полностью очищен!`);
};

const handleCleanInvalidContacts = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    const beforeCount = allContacts.length;
    
    // Фильтруем только валидные номера
    const validContacts = allContacts.filter(contact => contactManager.isValidMobileNumber(contact.phone));
    const removed = beforeCount - validContacts.length;
    
    if (removed > 0) {
        // Обновляем список контактов в менеджере
        contactManager.contacts = validContacts;
        contactManager.saveContacts();
        
        await sendReply(sock, message, `
🧹 ОЧИСТКА НЕВАЛИДНЫХ НОМЕРОВ:

❌ Удалено невалидных: ${removed}
📱 Было контактов: ${beforeCount}
📱 Стало контактов: ${validContacts.length}

Невалидные номера включают:
• Городские номера
• Короткие номера
• Номера неправильного формата
        `);
    } else {
        await sendReply(sock, message, '✅ Все номера валидны, нечего удалять');
    }
};

const handleQuickValidate = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    
    if (allContacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для валидации');
        return;
    }

    await sendReply(sock, message, `🔍 Быстрая валидация формата ${allContacts.length} номеров...`);
    
    let validNumbers = 0;
    let invalidNumbers = 0;
    
    for (const contact of allContacts) {
        if (!contactManager.isValidMobileNumber(contact.phone)) {
            invalidNumbers++;
            // Помечаем как invalid
            contact.status = 'invalid';
        } else {
            validNumbers++;
        }
    }
    
    // Сохраняем изменения
    contactManager.saveContacts();

    const report = `
📊 БЫСТРАЯ ВАЛИДАЦИЯ ЗАВЕРШЕНА:

📱 ФОРМАТ НОМЕРОВ:
✅ Валидных: ${validNumbers}
❌ Невалидных: ${invalidNumbers}

📈 ПРОЦЕНТ ВАЛИДНЫХ: ${Math.round((validNumbers / allContacts.length) * 100)}%

🎯 КОМАНДЫ:
• !cleaninvalid - удалить невалидные
• !validate - полная проверка с WhatsApp
• !autostart - запустить рассылку
    `;
    
    await sendReply(sock, message, report);
};

const handleBatchSending = async (sock, message, text) => {
    const args = text.replace('!batch', '').trim().split(' ');
    const batchSize = parseInt(args[0]) || 10;
    const messageToSend = args.slice(1).join(' ');

    if (!messageToSend) {
        await sendReply(sock, message, 'Использование: !batch количество текст сообщения\nПример: !batch 15 Привет! Предлагаю услуги');
        return;
    }

    const contacts = contactManager.getContactsForSending(batchSize);
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для рассылки');
        return;
    }

    const limitCheck = contactManager.canSendMessages(contacts.length);
    if (!limitCheck.canSend) {
        await sendReply(sock, message, `❌ ${limitCheck.reason}`);
        return;
    }

    await sendSmartBatch(sock, message, contacts, messageToSend);
};

const handleResetSentStatus = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    let resetCount = 0;
    
    allContacts.forEach(contact => {
        contact.sentCount = 0;
        delete contact.lastSent;
        resetCount++;
    });
    
    contactManager.saveContacts();
    
    await sendReply(sock, message, `
🔄 СБРОС СТАТУСА ОТПРАВКИ:

📱 Сброшено у контактов: ${resetCount}
📊 Всего контактов: ${allContacts.length}

✅ Теперь можно начать рассылку заново!
🚀 Используй: !autostart
    `);
};

const sendReply = async (sock, message, text) => {
    try {
        await sock.sendMessage(message.key.remoteJid, { text });
    } catch (error) {
        console.log(`Failed to send reply: ${error.message}`);
    }
};

start().catch(error => {
    console.log(`Failed to start bot: ${error.message}`);
    process.exit(1);
});

module.exports = { botReadyTimestamp };