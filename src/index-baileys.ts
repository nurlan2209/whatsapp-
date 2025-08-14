import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import * as cli from "./cli/ui";
import { initGemini, generateGeminiResponse } from "./providers/gemini";
import config from "./config";

let botReadyTimestamp: Date | null = null;

const start = async () => {
    cli.printIntro();

    // Используем файловую аутентификацию
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

    const sock = makeWASocket({
        auth: state,
        // Убираем printQRInTerminal, будем обрабатывать сами
    })

    // Обработка подключения
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        // Показываем QR код
        if (qr) {
            console.log('\n📱 QR Code for WhatsApp Web:')
            console.log('Copy this text and convert to QR: ' + qr)
            console.log('Or use online QR generator with this text ^\n')
            
            // Пытаемся показать QR в терминале
            try {
                qrcode.generate(qr, { small: true })
            } catch (e) {
                console.log('QR generation failed, use the text above')
            }
        }
        
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            cli.printError('Connection closed due to ' + lastDisconnect?.error + ', reconnecting: ' + shouldReconnect)
            
            if(shouldReconnect) {
                start()
            }
        } else if(connection === 'open') {
            cli.printAuthenticated()
            cli.printOutro()
            botReadyTimestamp = new Date()
            
            // Initialize Gemini
            try {
                initGemini();
                cli.print("✓ Gemini AI initialized successfully");
            } catch (error: any) {
                cli.printError("✗ Failed to initialize Gemini: " + error.message);
            }
        }
    })

    // Сохранение учетных данных
    sock.ev.on('creds.update', saveCreds)

    // Обработка сообщений от других пользователей
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message) return
        
        // Обрабатываем только входящие сообщения (НЕ от бота)
        if (message.key.fromMe === true) return
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || ''

        if (!messageText) return

        cli.print(`[INCOMING MESSAGE] From ${message.key.remoteJid}: ${messageText}`)

        try {
            // AI команды от других пользователей
            if (messageText.startsWith('!ai') || messageText.startsWith('!gpt')) {
                const prompt = messageText.replace(/^!(ai|gpt)\s*/, '')
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt)
                }
                return
            }

            if (messageText.startsWith('!help')) {
                await handleHelp(sock, message)
                return
            }

            // Другие команды доступны только владельцу (в собственных сообщениях)

        } catch (error: any) {
            cli.printError(`Error handling incoming message: ${error.message}`)
        }
    })

    // Обработка СОБСТВЕННЫХ сообщений (команды управления)
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message) return
        
        // Обрабатываем только СВОИ сообщения
        if (message.key.fromMe !== true) return
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || ''

        if (!messageText) return

        cli.print(`[OWN MESSAGE] Received: ${messageText}`)

        try {
            // Команды массовой рассылки (только для владельца)
            if (messageText.startsWith('!send')) {
                await handleMassMessage(sock, message, messageText)
                return
            }

            if (messageText.startsWith('!add')) {
                await handleAddNumber(sock, message, messageText)
                return
            }

            if (messageText.startsWith('!check')) {
                await handleCheckNumbers(sock, message)
                return
            }

            if (messageText.startsWith('!help')) {
                await handleHelp(sock, message)
                return
            }

            // AI команды
            if (messageText.startsWith('!ai') || messageText.startsWith('!gpt')) {
                const prompt = messageText.replace(/^!(ai|gpt)\s*/, '')
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt)
                }
                return
            }

        } catch (error: any) {
            cli.printError(`Error handling own message: ${error.message}`)
        }
    })
}

// Простая база данных номеров в памяти
let phoneNumbers: string[] = []

const handleMassMessage = async (sock: any, message: any, text: string) => {
    const messageToSend = text.replace('!send', '').trim() || 'Привет! Это сообщение от моего бота.'
    
    if (phoneNumbers.length === 0) {
        await sendReply(sock, message, 'Нет номеров для рассылки. Добавьте номера командой !add')
        return
    }

    await sendReply(sock, message, `Начинаю рассылку по ${phoneNumbers.length} номерам...`)

    let success = 0
    let errors = 0

    for (const phone of phoneNumbers) {
        try {
            // Улучшенное форматирование номера
            let formattedNumber = phone.replace(/[^\d+]/g, '') // Убираем все кроме цифр и +
            
            // Если номер начинается с 8, заменяем на +7
            if (formattedNumber.startsWith('8')) {
                formattedNumber = '+7' + formattedNumber.substring(1)
            }
            
            // Если номер не начинается с +, добавляем +
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = '+' + formattedNumber
            }
            
            // Добавляем @s.whatsapp.net для WhatsApp ID
            const jid = formattedNumber.replace('+', '') + '@s.whatsapp.net'
            
            cli.print(`Trying to send to: ${formattedNumber} (${jid})`)
            
            // Проверяем существует ли номер в WhatsApp
            const [result] = await sock.onWhatsApp(formattedNumber.replace('+', ''))
            if (!result || !result.exists) {
                cli.printError(`Number ${formattedNumber} is not registered on WhatsApp`)
                errors++
                continue
            }
            
            await sock.sendMessage(jid, { text: messageToSend })
            success++
            cli.print(`✓ Sent to ${formattedNumber}`)
            
            // Увеличенная задержка между сообщениями
            await new Promise(resolve => setTimeout(resolve, 5000)) // 5 секунд
            
        } catch (error: any) {
            errors++
            cli.printError(`✗ Failed to send to ${phone}: ${error.message}`)
        }
    }

    await sendReply(sock, message, `Рассылка завершена!\n✅ Успешно: ${success}\n❌ Ошибок: ${errors}`)
}

const handleAddNumber = async (sock: any, message: any, text: string) => {
    const phone = text.replace('!add', '').trim()
    
    if (!phone) {
        await sendReply(sock, message, 'Укажите номер. Пример: !add +77012345678')
        return
    }

    const cleanPhone = phone.replace(/[^\d+]/g, '')
    
    if (!phoneNumbers.includes(cleanPhone)) {
        phoneNumbers.push(cleanPhone)
        await sendReply(sock, message, `Номер ${cleanPhone} добавлен. Всего номеров: ${phoneNumbers.length}`)
    } else {
        await sendReply(sock, message, `Номер ${cleanPhone} уже есть в списке`)
    }
}

const handleCheckNumbers = async (sock: any, message: any) => {
    if (phoneNumbers.length === 0) {
        await sendReply(sock, message, 'Список номеров пуст')
        return
    }

    await sendReply(sock, message, `Проверяю ${phoneNumbers.length} номеров...`)
    
    let valid = 0
    let invalid = 0
    const results = []

    for (const phone of phoneNumbers) {
        try {
            let formattedNumber = phone.replace(/[^\d+]/g, '')
            
            if (formattedNumber.startsWith('8')) {
                formattedNumber = '+7' + formattedNumber.substring(1)
            }
            
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = '+' + formattedNumber
            }
            
            const [result] = await sock.onWhatsApp(formattedNumber.replace('+', ''))
            
            if (result && result.exists) {
                results.push(`✅ ${formattedNumber} - активен`)
                valid++
            } else {
                results.push(`❌ ${formattedNumber} - не найден`)
                invalid++
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000)) // Пауза между проверками
            
        } catch (error: any) {
            results.push(`⚠️ ${phone} - ошибка проверки`)
            invalid++
        }
    }

    const report = `Результат проверки:\n${results.join('\n')}\n\n📊 Итого:\n✅ Активных: ${valid}\n❌ Неактивных: ${invalid}`
    await sendReply(sock, message, report)
}

const handleHelp = async (sock: any, message: any) => {
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
!check - проверить все номера
!send Привет! Предлагаю свои услуги
!ai Напиши рекламный текст
    `
    await sendReply(sock, message, helpText)
}

const handleAI = async (sock: any, message: any, prompt: string) => {
    try {
        cli.print(`[AI] Processing: ${prompt}`)
        
        const response = await generateGeminiResponse(prompt, message.key.remoteJid || 'unknown')
        await sendReply(sock, message, response)
        
        cli.print(`[AI] Response sent: ${response.substring(0, 100)}...`)
    } catch (error: any) {
        cli.printError(`[AI] Error: ${error.message}`)
        await sendReply(sock, message, 'Ошибка при обработке запроса: ' + error.message)
    }
}

const sendReply = async (sock: any, message: any, text: string) => {
    try {
        await sock.sendMessage(message.key.remoteJid, { text })
    } catch (error: any) {
        cli.printError(`Failed to send reply: ${error.message}`)
    }
}

start().catch(error => {
    cli.printError(`Failed to start bot: ${error.message}`)
    process.exit(1)
})

export { botReadyTimestamp }