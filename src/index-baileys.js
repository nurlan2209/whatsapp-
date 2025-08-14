const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const { initGemini, generateGeminiResponse } = require('./providers/gemini');
const config = require('./config').default;

let botReadyTimestamp = null;

const start = async () => {
    console.log('🚀 Starting WhatsApp Gemini Bot...');

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
        }
    });

    // Сохранение учетных данных
    sock.ev.on('creds.update', saveCreds);

    // Обработка сообщений от других пользователей
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        
        if (!message.message) return;
        if (message.key.fromMe === true) return;
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';

        if (!messageText) return;

        console.log(`[INCOMING] From ${message.key.remoteJid}: ${messageText}`);

        try {
            // AI команды от других пользователей
            if (messageText.startsWith('!ai') || messageText.startsWith('!gpt')) {
                const prompt = messageText.replace(/^!(ai|gpt)\s*/, '');
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt);
                }
                return;
            }

            if (messageText.startsWith('!help')) {
                await handleHelp(sock, message);
                return;
            }

        } catch (error) {
            console.log(`Error handling incoming message: ${error.message}`);
        }
    });

    // Обработка СОБСТВЕННЫХ сообщений
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        
        if (!message.message) return;
        if (message.key.fromMe !== true) return;
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';

        if (!messageText) return;

        console.log(`[OWN] Received: ${messageText}`);

        try {
            if (messageText.startsWith('!send')) {
                await handleMassMessage(sock, message, messageText);
                return;
            }

            if (messageText.startsWith('!add')) {
                await handleAddNumber(sock, message, messageText);
                return;
            }

            if (messageText.startsWith('!list')) {
                await handleListNumbers(sock, message);
                return;
            }

            if (messageText.startsWith('!check')) {
                await handleCheckNumbers(sock, message);
                return;
            }

            if (messageText.startsWith('!help')) {
                await handleHelp(sock, message);
                return;
            }

            if (messageText.startsWith('!ai') || messageText.startsWith('!gpt')) {
                const prompt = messageText.replace(/^!(ai|gpt)\s*/, '');
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt);
                }
                return;
            }

        } catch (error) {
            console.log(`Error handling own message: ${error.message}`);
        }
    });
};

// База данных номеров в памяти
let phoneNumbers = [];

const handleMassMessage = async (sock, message, text) => {
    const messageToSend = text.replace('!send', '').trim() || 'Привет! Это сообщение от моего бота.';
    
    if (phoneNumbers.length === 0) {
        await sendReply(sock, message, 'Нет номеров для рассылки. Добавьте номера командой !add');
        return;
    }

    await sendReply(sock, message, `Начинаю рассылку по ${phoneNumbers.length} номерам...`);

    let success = 0;
    let errors = 0;

    for (const phone of phoneNumbers) {
        try {
            let formattedNumber = phone.replace(/[^\d+]/g, '');
            
            if (formattedNumber.startsWith('8')) {
                formattedNumber = '+7' + formattedNumber.substring(1);
            }
            
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = '+' + formattedNumber;
            }
            
            const jid = formattedNumber.replace('+', '') + '@s.whatsapp.net';
            
            console.log(`Trying to send to: ${formattedNumber}`);
            
            try {
                const checkResult = await sock.onWhatsApp(formattedNumber.replace('+', ''));
                if (!checkResult || !Array.isArray(checkResult) || checkResult.length === 0 || !checkResult[0]?.exists) {
                    console.log(`❌ ${formattedNumber} is not registered on WhatsApp`);
                    errors++;
                    continue;
                }
            } catch (checkError) {
                console.log(`Could not check ${formattedNumber}, skipping`);
                errors++;
                continue;
            }
            
            await sock.sendMessage(jid, { text: messageToSend });
            success++;
            console.log(`✅ Sent to ${formattedNumber}`);
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            
        } catch (error) {
            errors++;
            console.log(`❌ Failed to send to ${phone}: ${error.message}`);
        }
    }

    await sendReply(sock, message, `Рассылка завершена!\n✅ Успешно: ${success}\n❌ Ошибок: ${errors}`);
};

const handleAddNumber = async (sock, message, text) => {
    const phone = text.replace('!add', '').trim();
    
    if (!phone) {
        await sendReply(sock, message, 'Укажите номер. Пример: !add +77012345678');
        return;
    }

    const cleanPhone = phone.replace(/[^\d+]/g, '');
    
    if (!phoneNumbers.includes(cleanPhone)) {
        phoneNumbers.push(cleanPhone);
        await sendReply(sock, message, `Номер ${cleanPhone} добавлен. Всего номеров: ${phoneNumbers.length}`);
    } else {
        await sendReply(sock, message, `Номер ${cleanPhone} уже есть в списке`);
    }
};

const handleListNumbers = async (sock, message) => {
    if (phoneNumbers.length === 0) {
        await sendReply(sock, message, 'Список номеров пуст');
        return;
    }

    const numbersList = phoneNumbers.map((phone, index) => `${index + 1}. ${phone}`).join('\n');
    await sendReply(sock, message, `📱 Номера (${phoneNumbers.length}):\n${numbersList}`);
};

const handleCheckNumbers = async (sock, message) => {
    if (phoneNumbers.length === 0) {
        await sendReply(sock, message, 'Список номеров пуст');
        return;
    }

    await sendReply(sock, message, `Проверяю ${phoneNumbers.length} номеров...`);
    
    let valid = 0;
    let invalid = 0;
    const results = [];

    for (const phone of phoneNumbers) {
        try {
            let formattedNumber = phone.replace(/[^\d+]/g, '');
            
            if (formattedNumber.startsWith('8')) {
                formattedNumber = '+7' + formattedNumber.substring(1);
            }
            
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = '+' + formattedNumber;
            }
            
            try {
                const checkResult = await sock.onWhatsApp(formattedNumber.replace('+', ''));
                
                if (checkResult && Array.isArray(checkResult) && checkResult.length > 0 && checkResult[0]?.exists) {
                    results.push(`✅ ${formattedNumber} - активен`);
                    valid++;
                } else {
                    results.push(`❌ ${formattedNumber} - не найден`);
                    invalid++;
                }
            } catch (checkError) {
                results.push(`⚠️ ${formattedNumber} - ошибка проверки`);
                invalid++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            results.push(`⚠️ ${phone} - ошибка проверки`);
            invalid++;
        }
    }

    const report = `Результат проверки:\n${results.slice(0, 10).join('\n')}${results.length > 10 ? '\n...' : ''}\n\n📊 Итого:\n✅ Активных: ${valid}\n❌ Неактивных: ${invalid}`;
    await sendReply(sock, message, report);
};

const handleHelp = async (sock, message) => {
    const helpText = `
🤖 WhatsApp Gemini Bot

📤 РАССЫЛКА:
!send текст - Массовая рассылка
!add +номер - Добавить номер
!list - Показать номера  
!check - Проверить номера

🤖 AI:
!ai вопрос - Общение с Gemini
!gpt вопрос - То же самое

📋 ПРИМЕРЫ:
!add +77012345678
!list - показать все номера
!check - проверить все номера
!send Привет! Предлагаю свои услуги
!ai Напиши рекламный текст

💡 СОВЕТЫ:
• Команды рассылки работают только для отправителя
• AI команды доступны всем пользователям
• Номера сохраняются только до перезапуска
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