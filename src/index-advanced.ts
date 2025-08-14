import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import * as cli from "./cli/ui";
import { initGemini, generateGeminiResponse } from "./providers/gemini";
import config from "./config";
import ContactManager from './utils/contact-manager';

let botReadyTimestamp: Date | null = null;
let contactManager: ContactManager;

const start = async () => {
    cli.printIntro();

    // Инициализируем менеджер контактов
    contactManager = new ContactManager();

    // Используем файловую аутентификацию
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

    const sock = makeWASocket({
        auth: state,
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

            // Показываем статистику при запуске
            const stats = contactManager.getStats();
            cli.print(`📊 Статистика: ${stats.contacts.total} контактов, отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}`);
        }
    })

    // Сохранение учетных данных
    sock.ev.on('creds.update', saveCreds)

    // Обработка входящих сообщений
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message) return
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

        } catch (error: any) {
            cli.printError(`Error handling incoming message: ${error.message}`)
        }
    })

    // Обработка собственных сообщений (команды управления)
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message) return
        if (message.key.fromMe !== true) return
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || ''

        if (!messageText) return

        cli.print(`[OWN MESSAGE] Received: ${messageText}`)

        try {
            // === КОМАНДЫ УПРАВЛЕНИЯ КОНТАКТАМИ ===
            
            if (messageText.startsWith('!add ')) {
                await handleAddContact(sock, message, messageText)
                return
            }

            if (messageText.startsWith('!import')) {
                await handleImport(sock, message, messageText)
                return
            }

            if (messageText.startsWith('!scan')) {
                await handleScanUploads(sock, message)
                return
            }

            if (messageText.startsWith('!list')) {
                await handleListContacts(sock, message)
                return
            }

            if (messageText.startsWith('!stats')) {
                await handleStats(sock, message)
                return
            }

            if (messageText.startsWith('!clean')) {
                await handleClean(sock, message)
                return
            }

            if (messageText.startsWith('!check')) {
                await handleCheckContacts(sock, message)
                return
            }

            // === КОМАНДЫ РАССЫЛКИ ===

            if (messageText.startsWith('!send ')) {
                await handleSmartSending(sock, message, messageText)
                return
            }

            if (messageText.startsWith('!batch ')) {
                await handleBatchSending(sock, message, messageText)
                return
            }

            // === AI КОМАНДЫ ===

            if (messageText.startsWith('!ai') || messageText.startsWith('!gpt')) {
                const prompt = messageText.replace(/^!(ai|gpt)\s*/, '')
                if (prompt.trim()) {
                    await handleAI(sock, message, prompt)
                }
                return
            }

            if (messageText.startsWith('!help')) {
                await handleAdvancedHelp(sock, message)
                return
            }

        } catch (error: any) {
            cli.printError(`Error handling own message: ${error.message}`)
        }
    })
}

// === ОБРАБОТЧИКИ КОМАНД ===

const handleAddContact = async (sock: any, message: any, text: string) => {
    const args = text.replace('!add', '').trim().split(',')
    const phone = args[0]?.trim()
    const name = args[1]?.trim()

    if (!phone) {
        await sendReply(sock, message, 'Использование: !add +номер[,имя]\nПример: !add +77012345678,Иван Петров')
        return
    }

    const result = contactManager.addContact(phone, name)
    await sendReply(sock, message, result.message)
}

const handleImport = async (sock: any, message: any, text: string) => {
    const filePath = text.replace('!import', '').trim()
    
    if (!filePath) {
        await sendReply(sock, message, 'Использование: !import путь/к/файлу.txt\nПример: !import uploads/numbers.txt')
        return
    }

    const result = contactManager.importFromFile(filePath)
    
    let response = `📁 Импорт завершен:\n✅ Добавлено: ${result.added}`
    
    if (result.errors.length > 0) {
        response += `\n❌ Ошибок: ${result.errors.length}`
        if (result.errors.length <= 5) {
            response += '\n\nОшибки:\n' + result.errors.slice(0, 5).join('\n')
        }
    }

    await sendReply(sock, message, response)
}

const handleScanUploads = async (sock: any, message: any) => {
    const files = contactManager.scanUploadsFolder()
    
    if (files.length === 0) {
        await sendReply(sock, message, '📁 Папка uploads пуста.\n\nПоложите файлы с номерами в папку uploads/ и используйте команду !scan')
        return
    }

    let response = `📁 Найдено файлов: ${files.length}\n\n`
    let totalAdded = 0

    for (const file of files) {
        const result = contactManager.importFromFile(file)
        response += `📄 ${file}:\n  ✅ Добавлено: ${result.added}\n  ❌ Ошибок: ${result.errors.length}\n\n`
        totalAdded += result.added
    }

    response += `🎉 Итого добавлено: ${totalAdded} контактов`
    await sendReply(sock, message, response)
}

const handleListContacts = async (sock: any, message: any) => {
    const contacts = contactManager.getAllContacts()
    
    if (contacts.length === 0) {
        await sendReply(sock, message, '📱 Список контактов пуст')
        return
    }

    const stats = contactManager.getStats()
    let response = `📱 Контакты (${contacts.length}):\n\n`
    
    // Показываем первые 20 контактов
    const displayContacts = contacts.slice(0, 20)
    displayContacts.forEach((contact, index) => {
        const status = contact.status === 'active' ? '✅' : 
                      contact.status === 'blocked' ? '❌' : 
                      contact.status === 'pending' ? '⏳' : '❓'
        
        response += `${index + 1}. ${status} ${contact.phone}`
        if (contact.name) response += ` (${contact.name})`
        if (contact.source) response += ` [${contact.source}]`
        response += '\n'
    })

    if (contacts.length > 20) {
        response += `\n... и еще ${contacts.length - 20} контактов`
    }

    response += `\n📊 Статистика:\n✅ Активных: ${stats.contacts.active}\n⏳ Ожидают: ${stats.contacts.pending}\n❌ Заблокированных: ${stats.contacts.blocked}`

    await sendReply(sock, message, response)
}

const handleStats = async (sock: any, message: any) => {
    const stats = contactManager.getStats()
    
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
    `
    
    await sendReply(sock, message, response)
}

const handleClean = async (sock: any, message: any) => {
    const removed = contactManager.cleanBlockedContacts()
    await sendReply(sock, message, `🧹 Удалено ${removed} заблокированных контактов`)
}

const handleCheckContacts = async (sock: any, message: any) => {
    const contacts = contactManager.getContactsForSending(10) // Проверяем первые 10
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для проверки')
        return
    }

    await sendReply(sock, message, `🔍 Проверяю ${contacts.length} контактов...`)
    
    let valid = 0
    let invalid = 0
    const results: string[] = []

    for (const contact of contacts) {
        try {
            const [result] = await sock.onWhatsApp(contact.phone.replace('+', ''))
            
            if (result && result.exists) {
                results.push(`✅ ${contact.phone}${contact.name ? ` (${contact.name})` : ''}`)
                valid++
                contactManager.markMessageSent(contact.phone, true) // Помечаем как активный
            } else {
                results.push(`❌ ${contact.phone} - не найден`)
                invalid++
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000))
            
        } catch (error: any) {
            results.push(`⚠️ ${contact.phone} - ошибка`)
            invalid++
        }
    }

    const report = `📋 Результат проверки:\n${results.join('\n')}\n\n📊 Итого:\n✅ Активных: ${valid}\n❌ Неактивных: ${invalid}`
    await sendReply(sock, message, report)
}

const handleSmartSending = async (sock: any, message: any, text: string) => {
    const messageToSend = text.replace('!send', '').trim()
    
    if (!messageToSend) {
        await sendReply(sock, message, 'Укажите текст сообщения\nПример: !send Привет! Предлагаю свои услуги')
        return
    }

    // Автоматический умный батч
    const contacts = contactManager.getContactsForSending()
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для рассылки')
        return
    }

    const limitCheck = contactManager.canSendMessages(contacts.length)
    if (!limitCheck.canSend) {
        await sendReply(sock, message, `❌ ${limitCheck.reason}`)
        return
    }

    await sendSmartBatch(sock, message, contacts, messageToSend)
}

const handleBatchSending = async (sock: any, message: any, text: string) => {
    const args = text.replace('!batch', '').trim().split(' ')
    const batchSize = parseInt(args[0]) || 10
    const messageToSend = args.slice(1).join(' ')

    if (!messageToSend) {
        await sendReply(sock, message, 'Использование: !batch количество текст сообщения\nПример: !batch 15 Привет! Предлагаю услуги')
        return
    }

    const contacts = contactManager.getContactsForSending(batchSize)
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для рассылки')
        return
    }

    const limitCheck = contactManager.canSendMessages(contacts.length)
    if (!limitCheck.canSend) {
        await sendReply(sock, message, `❌ ${limitCheck.reason}`)
        return
    }

    await sendSmartBatch(sock, message, contacts, messageToSend)
}

// Умная отправка батча
const sendSmartBatch = async (sock: any, message: any, contacts: any[], messageText: string) => {
    await sendReply(sock, message, `🚀 Начинаю умную рассылку по ${contacts.length} контактам...`)

    let success = 0
    let errors = 0

    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i]
        
        try {
            // Проверяем существование номера
            const [result] = await sock.onWhatsApp(contact.phone.replace('+', ''))
            if (!result || !result.exists) {
                cli.printError(`❌ ${contact.phone} не зарегистрирован в WhatsApp`)
                contactManager.markMessageSent(contact.phone, false)
                errors++
                continue
            }

            // Персонализируем сообщение
            let personalizedMessage = messageText
            if (contact.name) {
                personalizedMessage = `${contact.name}, ${messageText}`
            }

            // Отправляем сообщение
            const jid = contact.phone.replace('+', '') + '@s.whatsapp.net'
            await sock.sendMessage(jid, { text: personalizedMessage })
            
            // Отмечаем успешную отправку
            contactManager.markMessageSent(contact.phone, true)
            success++
            
            cli.print(`✅ Отправлено: ${contact.phone}${contact.name ? ` (${contact.name})` : ''}`)

            // Прогресс для длинных рассылок
            if (contacts.length > 5 && (i + 1) % 5 === 0) {
                await sendReply(sock, message, `📊 Прогресс: ${i + 1}/${contacts.length} (✅${success} ❌${errors})`)
            }

            // Случайная задержка между сообщениями
            const delay = contactManager.getRandomDelay()
            cli.print(`⏱️ Пауза ${delay/1000} секунд...`)
            await new Promise(resolve => setTimeout(resolve, delay))

        } catch (error: any) {
            cli.printError(`❌ Ошибка отправки ${contact.phone}: ${error.message}`)
            contactManager.markMessageSent(contact.phone, false)
            errors++
        }
    }

    // Финальный отчет
    const stats = contactManager.getStats()
    const report = `
🎉 Рассылка завершена!

📊 РЕЗУЛЬТАТ:
✅ Успешно: ${success}
❌ Ошибок: ${errors}
📱 Всего контактов: ${contacts.length}

📈 СТАТИСТИКА ДНЯ:
📤 Отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
🔄 Всего отправлено: ${stats.sending.totalSent}

⏰ Следующий батч доступен через: ${Math.ceil(stats.limits.BATCH_COOLDOWN/1000/60)} минут
    `
    
    await sendReply(sock, message, report)
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

const handleAdvancedHelp = async (sock: any, message: any) => {
    const helpText = `
🤖 WhatsApp Продвинутый AI Бот

📱 УПРАВЛЕНИЕ КОНТАКТАМИ:
!add +номер[,имя] - Добавить контакт
!import путь/файл.txt - Импорт из файла
!scan - Сканировать папку uploads/
!list - Показать контакты
!check - Проверить номера в WhatsApp
!clean - Удалить заблокированные
!stats - Детальная статистика

📤 УМНАЯ РАССЫЛКА:
!send текст - Автоматический батч
!batch 15 текст - Конкретный размер батча

🤖 AI АССИСТЕНТ:
!ai вопрос - Общение с Gemini
!gpt вопрос - То же самое

📋 ПРИМЕРЫ:
!add +77012345678,Иван Петров
!import uploads/clients.txt
!scan
!batch 10 🔥 Скидка 50%! Только сегодня!

📁 ФОРМАТЫ ФАЙЛОВ:
+77012345678
+77012345678,Имя Клиента
77012345678;Имя Фамилия

⚡ ЛИМИТЫ БЕЗОПАСНОСТИ:
• Максимум 20 номеров за раз
• 100 сообщений в день  
• Пауза 15 минут между батчами
• Случайные задержки 5-10 сек
    `
    await sendReply(sock, message, helpText)
}

const handleHelp = async (sock: any, message: any) => {
    const helpText = `
🤖 WhatsApp AI Bot

🤖 AI КОМАНДЫ:
!ai вопрос - Общение с ИИ
!help - Эта справка

Для доступа к функциям рассылки отправьте команды себе в избранное.
    `
    await sendReply(sock, message, helpText)
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