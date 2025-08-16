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
            // === УПРАВЛЕНИЕ КОНТАКТАМИ (5 команд) ===
            
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

            if (messageText === '!validate') {
                await handleValidateContacts(sock, message);
                return;
            }

            // === РАССЫЛКА (3 команды) ===

            if (messageText === '!send') {
                await handleSmartSending(sock, message, config.massMessageText);
                return;
            }

            if (messageText.startsWith('!send ')) {
                await handleSmartSending(sock, message, messageText.replace('!send ', ''));
                return;
            }

            if (messageText === '!clean') {
                await handleCleanProblematic(sock, message);
                return;
            }

            // === АВТОМАТИЗАЦИЯ (3 команды) ===

            if (messageText === '!autostart') {
                await handleSimpleAutoSending(sock, message);
                return;
            }

            if (messageText === '!autostop') {
                await handleStopAutoSending(sock, message);
                return;
            }

            if (messageText === '!stats') {
                await handleDetailedStats(sock, message);
                return;
            }

            // === УТИЛИТЫ (4 команды) ===

            if (messageText.startsWith('!ai ')) {
                const prompt = messageText.replace('!ai ', '');
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt);
                }
                return;
            }

            if (messageText === '!help') {
                await handleSimpleHelp(sock, message);
                return;
            }

            if (messageText === '!reset') {
                await handleResetSentStatus(sock, message);
                return;
            }

            if (messageText === '!status') {
                await handleQuickStatus(sock, message);
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
    
    const displayContacts = contacts.slice(0, 20);
    displayContacts.forEach((contact, index) => {
        const status = contact.status === 'active' ? '✅' : 
                      contact.status === 'blocked' ? '❌' : 
                      contact.status === 'pending' ? '⏳' : 
                      contact.status === 'invalid' ? '🚫' : '❓';
        
        response += `${index + 1}. ${status} ${contact.phone}`;
        if (contact.name) response += ` (${contact.name})`;
        response += '\n';
    });

    if (contacts.length > 20) {
        response += `\n... и еще ${contacts.length - 20} контактов`;
    }

    response += `\n\n📊 Статистика:\n✅ Активных: ${stats.contacts.active}\n⏳ Ожидают: ${stats.contacts.pending}\n🚫 Проблемных: ${stats.contacts.blocked}`;

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

const handleCleanProblematic = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    const beforeCount = allContacts.length;
    
    const invalidCount = allContacts.filter(c => c.status === 'invalid').length;
    const blockedCount = allContacts.filter(c => c.status === 'blocked').length;
    const pendingCount = allContacts.filter(c => c.status === 'pending').length;
    
    const goodContacts = allContacts.filter(contact => contact.status === 'active');
    const removedCount = beforeCount - goodContacts.length;
    
    if (removedCount > 0) {
        contactManager.contacts = goodContacts;
        contactManager.saveContacts();
        
        await sendReply(sock, message, `
🧹 ОЧИСТКА ЗАВЕРШЕНА:

❌ Удалено проблемных: ${removedCount}
   • Невалидных: ${invalidCount}
   • Заблокированных: ${blockedCount}  
   • Непроверенных: ${pendingCount}

✅ Осталось активных: ${goodContacts.length}

💡 Остались только проверенные номера в WhatsApp
        `);
    } else {
        await sendReply(sock, message, '✅ Все контакты уже активные, нечего удалять');
    }
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

    const stats = contactManager.getStats();
    const remainingDaily = stats.sending.dailyLimit - stats.sending.sentToday;
    
    if (remainingDaily <= 0) {
        await sendReply(sock, message, `❌ Дневной лимит исчерпан (${stats.sending.sentToday}/${stats.sending.dailyLimit}). Попробуйте завтра.`);
        return;
    }

    const contactsToSend = unsentContacts.slice(0, remainingDaily);
    const batches = [];
    for (let i = 0; i < contactsToSend.length; i += batchSize) {
        batches.push(contactsToSend.slice(i, i + batchSize));
    }

    const isResume = sentContacts.length > 0;

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

⏰ Первый батч отправляется через 10 секунд...
Для остановки: !autostop
    `);

    autoSendingActive = true;
    let currentBatch = 0;

    const sendNextBatch = async () => {
        if (!autoSendingActive || currentBatch >= batches.length) {
            autoSendingActive = false;
            if (autoSendingInterval) {
                clearInterval(autoSendingInterval);
                autoSendingInterval = null;
            }
            
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

${allActiveContacts.length - totalSentNow > 0 ? 
  `🔄 Для продолжения: !autostart (завтра или когда лимит обновится)` : 
  '✅ Всем активным контактам отправлено!'}
            `);
            return;
        }

        const batch = batches[currentBatch];
        console.log(`[AUTO SENDING] Отправка батча ${currentBatch + 1}/${batches.length} (${batch.length} контактов)`);
        
        await sendReply(sock, message, `📤 Отправка батча ${currentBatch + 1}/${batches.length} (${batch.length} контактов)...`);
        
        try {
            await sendSmartBatch(sock, message, batch, messageText);
            currentBatch++;
            
            const remainingBatches = batches.length - currentBatch;
            
            if (currentBatch < batches.length) {
                await sendReply(sock, message, `✅ Батч ${currentBatch}/${batches.length} завершен.\n\n📊 Осталось батчей: ${remainingBatches}\n⏰ Следующий через ${intervalMinutes} минут.`);
            }
        } catch (error) {
            console.log(`[AUTO SENDING] Ошибка в батче ${currentBatch + 1}: ${error.message}`);
            await sendReply(sock, message, `❌ Ошибка в батче ${currentBatch + 1}: ${error.message}`);
        }
    };

    setTimeout(async () => {
        await sendNextBatch();
        
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

const handleDetailedStats = async (sock, message) => {
    const stats = contactManager.getStats();
    const allContacts = contactManager.getAllContacts();
    const sentContacts = allContacts.filter(c => c.lastSent);
    const unsentContacts = allContacts.filter(c => !c.lastSent && c.status === 'active');
    
    const response = `
📊 ПОДРОБНАЯ СТАТИСТИКА:

📱 КОНТАКТЫ:
• Всего: ${stats.contacts.total}
• Активных: ${stats.contacts.active}
• Проблемных: ${stats.contacts.blocked + stats.contacts.pending}

📤 РАССЫЛКА:
• Отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
• Всего отправлено: ${stats.sending.totalSent}
• Остается лимита: ${stats.sending.dailyLimit - stats.sending.sentToday}

🎯 ПРОГРЕСС:
• Обработано контактов: ${sentContacts.length}
• Осталось активных: ${unsentContacts.length}
• Процент завершения: ${stats.contacts.active > 0 ? Math.round((sentContacts.length / stats.contacts.active) * 100) : 0}%

⚙️ ЛИМИТЫ:
• Батч: ${stats.limits.MAX_NUMBERS_PER_BATCH}
• Задержка: ${stats.limits.MIN_DELAY_BETWEEN_MESSAGES/1000}-${stats.limits.MAX_DELAY_BETWEEN_MESSAGES/1000} сек
• Пауза между батчами: ${stats.limits.BATCH_COOLDOWN/1000/60} мин

🤖 АВТОМАТИЧЕСКАЯ РАССЫЛКА: ${autoSendingActive ? '🟢 АКТИВНА' : '🔴 НЕАКТИВНА'}

📅 Последний батч: ${stats.sending.lastBatch ? new Date(stats.sending.lastBatch).toLocaleString('ru') : 'Никогда'}
    `;
    
    await sendReply(sock, message, response);
};

const handleQuickStatus = async (sock, message) => {
    const stats = contactManager.getStats();
    const allContacts = contactManager.getAllContacts();
    const unsentContacts = allContacts.filter(c => !c.lastSent && c.status === 'active');
    
    const response = `
⚡ БЫСТРЫЙ СТАТУС:

📱 Активных контактов: ${stats.contacts.active}
📤 Отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
⏳ Осталось отправить: ${unsentContacts.length}
🤖 Авто-рассылка: ${autoSendingActive ? '🟢 Активна' : '🔴 Неактивна'}

${unsentContacts.length > 0 ? '🚀 Готов к рассылке: !autostart' : '✅ Всем отправлено!'}
    `;
    
    await sendReply(sock, message, response);
};

const handleValidateContacts = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    
    if (allContacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для валидации');
        return;
    }

    await sendReply(sock, message, `🔍 Валидирую ${allContacts.length} контактов...`);
    
    let validNumbers = 0;
    let invalidNumbers = 0;
    let whatsappChecked = 0;
    let whatsappValid = 0;
    let whatsappInvalid = 0;
    
    for (let i = 0; i < allContacts.length; i++) {
        const contact = allContacts[i];
        
        if (!contactManager.isValidMobileNumber(contact.phone)) {
            invalidNumbers++;
            contact.status = 'invalid';
            continue;
        }
        
        validNumbers++;
        
        try {
            const checkResult = await sock.onWhatsApp(contact.phone.replace('+', ''));
            if (checkResult && Array.isArray(checkResult) && checkResult.length > 0 && checkResult[0]?.exists) {
                whatsappValid++;
                contact.status = 'active';
            } else {
                whatsappInvalid++;
                contact.status = 'invalid';
            }
            whatsappChecked++;
            
            if (whatsappChecked % 10 === 0) {
                await sendReply(sock, message, `⏳ Проверено: ${whatsappChecked}/${allContacts.length} (✅${whatsappValid} ❌${whatsappInvalid})`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            whatsappInvalid++;
            whatsappChecked++;
            contact.status = 'invalid';
            
            if (error.message.includes('rate') || error.message.includes('limit')) {
                await sendReply(sock, message, '⚠️ Обнаружено ограничение скорости, увеличиваю паузу...');
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    contactManager.saveContacts();

    const report = `
📊 ВАЛИДАЦИЯ ЗАВЕРШЕНА:

📱 ФОРМАТ НОМЕРОВ:
✅ Валидных: ${validNumbers}
❌ Невалидных: ${invalidNumbers}

💬 ПРОВЕРКА WHATSAPP:
✅ Активных: ${whatsappValid}
❌ Неактивных: ${whatsappInvalid}

📈 ИТОГО:
Готовых к рассылке: ${whatsappValid} из ${allContacts.length}
Процент валидных: ${Math.round((whatsappValid / allContacts.length) * 100)}%

🎯 Используйте !clean для удаления проблемных номеров
    `;
    
    await sendReply(sock, message, report);
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

const handleSimpleHelp = async (sock, message) => {
    const helpText = `
🤖 WhatsApp Бот для Рассылки

📱 КОНТАКТЫ:
!add +номер[,имя] - Добавить контакт
!import файл.txt - Импорт из файла
!scan - Сканировать uploads/
!list - Показать контакты
!validate - Проверить все номера

📤 РАССЫЛКА:
!send - Основной текст рассылки
!send ВАШ ТЕКСТ - Кастомная рассылка
!clean - Удалить проблемные контакты

🤖 АВТОМАТИЗАЦИЯ:
!autostart - Умная авто-рассылка
!autostop - Остановить рассылку
!stats - Подробная статистика

🔧 УТИЛИТЫ:
!ai вопрос - Общение с AI
!reset - Сбросить статус отправки
!status - Быстрый статус
!help - Эта справка

💡 ПРИМЕРЫ:
!scan → !validate → !autostart
!send Привет! Предлагаем услуги
!status - посмотреть прогресс

⚡ ЛИМИТЫ БЕЗОПАСНОСТИ:
• 10 номеров за батч
• 100 сообщений в день  
• 15 минут между батчами
• Случайные задержки 5-10 сек
    `;
    await sendReply(sock, message, helpText);
};

const handleResetSentStatus = async (sock, message) => {
    const allContacts = contactManager.getAllContacts();
    let resetCount = 0;
    
    allContacts.forEach(contact => {
        if (contact.lastSent) {
            contact.sentCount = 0;
            delete contact.lastSent;
            resetCount++;
        }
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