import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import * as cli from "./cli/ui";
import { initGemini, generateGeminiResponse } from "./providers/gemini";
import config from "./config";
import ContactManager from './utils/contact-manager';

// Интерфейс для контакта
interface Contact {
    phone: string;
    name?: string;
    source?: string;
    addedAt: Date;
    lastSent?: Date;
    status: 'active' | 'blocked' | 'invalid' | 'pending';
    sentCount: number;
}

let botReadyTimestamp: Date | null = null;
let contactManager: ContactManager;

// Переменные для автоматической рассылки
let autoSendingActive = false;
let autoSendingInterval: NodeJS.Timeout | null = null;

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

    // Обработка входящих сообщений от других пользователей
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message) return
        if (message.key.fromMe === true) return
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || ''

        if (!messageText) return

        cli.print(`[INCOMING MESSAGE] From ${message.key.remoteJid}: ${messageText}`)

        try {
            // ТОЛЬКО команды помощи - НЕТ автоответов ИИ!
            if (messageText.startsWith('!help')) {
                await handlePublicHelp(sock, message)
            }

            // ВСЕ ОСТАЛЬНЫЕ СООБЩЕНИЯ ИГНОРИРУЕМ
            
        } catch (error: any) {
            cli.printError(`Error handling incoming message: ${error.message}`)
        }
    })

    // Обработка собственных сообщений (команды управления) - ТОЛЬКО ДЛЯ СОБСТВЕННЫХ СООБЩЕНИЙ
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message) return
        if (message.key.fromMe !== true) return // ТОЛЬКО свои сообщения
        
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

            if (messageText === '!scan') {
                await handleScanUploads(sock, message)
                return
            }

            if (messageText === '!list') {
                await handleListContacts(sock, message)
                return
            }

            if (messageText === '!stats') {
                await handleStats(sock, message)
                return
            }

            if (messageText === '!clean') {
                await handleClean(sock, message)
                return
            }

            if (messageText === '!clear') {
                await handleClearAllContacts(sock, message)
                return
            }

            if (messageText === '!clear confirm') {
                await handleClearConfirm(sock, message)
                return
            }

            if (messageText === '!validate') {
                await handleValidateContacts(sock, message)
                return
            }

            if (messageText === '!quickvalidate') {
                await handleQuickValidate(sock, message)
                return
            }

            if (messageText === '!cleaninvalid') {
                await handleCleanInvalidContacts(sock, message)
                return
            }

            // === КОМАНДЫ РАССЫЛКИ ===

            if (messageText === '!send') {
                await handleSmartSending(sock, message, config.massMessageText)
                return
            }

            if (messageText === '!send1') {
                await handleSmartSending(sock, message, config.massMessageText1)
                return
            }

            if (messageText === '!send2') {
                await handleSmartSending(sock, message, config.massMessageText2)
                return
            }

            if (messageText === '!send3') {
                await handleSmartSending(sock, message, config.massMessageText3)
                return
            }

            if (messageText.startsWith('!send ')) {
                await handleSmartSending(sock, message, messageText.replace('!send ', ''))
                return
            }

            if (messageText.startsWith('!batch ')) {
                await handleBatchSending(sock, message, messageText)
                return
            }

            if (messageText === '!test') {
                await handleTestPersonalization(sock, message)
                return
            }

            if (messageText === '!texts') {
                await handleShowTexts(sock, message)
                return
            }

            // === АВТОМАТИЧЕСКАЯ РАССЫЛКА ===

            if (messageText === '!autostart') {
                await handleSimpleAutoSending(sock, message)
                return
            }

            if (messageText === '!autostop') {
                await handleStopAutoSending(sock, message)
                return
            }

            if (messageText === '!autostatus') {
                await handleAutoStatus(sock, message)
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

            if (messageText === '!help') {
                await handleAdvancedHelp(sock, message)
                return
            }

        } catch (error: any) {
            cli.printError(`Error handling own message: ${error.message}`)
        }
    })
}

// === ОБРАБОТЧИКИ КОМАНД ===

// Функция для публичной справки (для других пользователей)
const handlePublicHelp = async (sock: any, message: any) => {
    const helpText = `
🤖 WhatsApp Bot

ℹ️ Этот бот предназначен только для рассылки.
Автоматические ответы отключены.

Если у вас есть вопросы, свяжитесь с администратором напрямую.
    `
    await sendReply(sock, message, helpText)
}

// Показать готовые тексты с примером персонализации
const handleShowTexts = async (sock: any, message: any) => {
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
    `
    await sendReply(sock, message, textsInfo)
}

const handleTestPersonalization = async (sock: any, message: any) => {
    const contacts: Contact[] = contactManager.getAllContacts().slice(0, 3) // Берем первые 3 контакта
    
    if (contacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для тестирования персонализации')
        return
    }

    let testResults = '🧪 ТЕСТ ПЕРСОНАЛИЗАЦИИ:\n\n'
    
    for (const contact of contacts) {
        let personalizedMessage = config.massMessageText
        
        if (contact.name) {
            personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, contact.name)
            personalizedMessage = personalizedMessage.replace(/{название}/g, contact.name)
            personalizedMessage = personalizedMessage.replace(/{организация}/g, contact.name)
        } else {
            personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, 'уважаемая компания')
            personalizedMessage = personalizedMessage.replace(/{название}/g, 'уважаемая компания')
            personalizedMessage = personalizedMessage.replace(/{организация}/g, 'уважаемая компания')
        }
        
        testResults += `📱 ${contact.phone} → ${contact.name || 'без названия'}\n`
        testResults += `📝 Текст:\n${personalizedMessage}\n\n---\n\n`
    }
    
    await sendReply(sock, message, testResults)
}

// Простая автоматическая рассылка с настройками из .env
const handleSimpleAutoSending = async (sock: any, message: any) => {
    if (autoSendingActive) {
        await sendReply(sock, message, '⚠️ Автоматическая рассылка уже запущена! Используйте !autostop для остановки.')
        return
    }

    // Все настройки берем из .env
    const batchSize = parseInt(process.env.MAX_NUMBERS_PER_BATCH || '10')
    const intervalMs = parseInt(process.env.BATCH_COOLDOWN || '900000') // 15 минут по умолчанию
    const intervalMinutes = intervalMs / 1000 / 60
    const messageText = config.massMessageText

    const allContacts: Contact[] = contactManager.getContactsForSending(1000) // Получаем все контакты
    
    if (allContacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для рассылки')
        return
    }

    // Разбиваем на батчи
    const batches: Contact[][] = []
    for (let i = 0; i < allContacts.length; i += batchSize) {
        batches.push(allContacts.slice(i, i + batchSize))
    }

    await sendReply(sock, message, `
🚀 ЗАПУСК АВТОМАТИЧЕСКОЙ РАССЫЛКИ

📊 Параметры из .env:
• Всего контактов: ${allContacts.length}
• Размер батча: ${batchSize}
• Интервал: ${intervalMinutes} минут
• Всего батчей: ${batches.length}
• Общее время: ~${Math.ceil(batches.length * intervalMinutes / 60)} часов

📤 Текст сообщения:
${messageText}

⏰ Первый батч отправляется через 10 секунд...
Для остановки: !autostop
Статус: !autostatus
    `)

    autoSendingActive = true
    let currentBatch = 0

    // Функция отправки одного батча
    const sendNextBatch = async () => {
        if (!autoSendingActive || currentBatch >= batches.length) {
            autoSendingActive = false
            if (autoSendingInterval) {
                clearInterval(autoSendingInterval)
                autoSendingInterval = null
            }
            
            await sendReply(sock, message, `
🎉 АВТОМАТИЧЕСКАЯ РАССЫЛКА ЗАВЕРШЕНА!

📊 Итоговая статистика:
• Обработано батчей: ${currentBatch}/${batches.length}
• Всего контактов: ${allContacts.length}

Подробную статистику: !stats
            `)
            return
        }

        const batch = batches[currentBatch]
        cli.print(`[AUTO SENDING] Отправка батча ${currentBatch + 1}/${batches.length} (${batch.length} контактов)`)
        
        await sendReply(sock, message, `📤 Отправка батча ${currentBatch + 1}/${batches.length} (${batch.length} контактов)...`)
        
        try {
            await sendSmartBatch(sock, message, batch, messageText)
            currentBatch++
            
            if (currentBatch < batches.length) {
                await sendReply(sock, message, `✅ Батч ${currentBatch}/${batches.length} завершен. Следующий через ${intervalMinutes} минут.`)
            }
        } catch (error: any) {
            cli.printError(`[AUTO SENDING] Ошибка в батче ${currentBatch + 1}: ${error.message}`)
            await sendReply(sock, message, `❌ Ошибка в батче ${currentBatch + 1}: ${error.message}`)
        }
    }

    // Запускаем первый батч через 10 секунд
    setTimeout(async () => {
        await sendNextBatch()
        
        // Запускаем интервал для остальных батчей
        if (batches.length > 1) {
            autoSendingInterval = setInterval(sendNextBatch, intervalMs)
        }
    }, 10000)
}

// Остановка автоматической рассылки
const handleStopAutoSending = async (sock: any, message: any) => {
    if (!autoSendingActive) {
        await sendReply(sock, message, 'ℹ️ Автоматическая рассылка не активна')
        return
    }

    autoSendingActive = false
    if (autoSendingInterval) {
        clearInterval(autoSendingInterval)
        autoSendingInterval = null
    }

    await sendReply(sock, message, '🛑 Автоматическая рассылка ОСТАНОВЛЕНА')
}

// Статус автоматической рассылки
const handleAutoStatus = async (sock: any, message: any) => {
    const stats = contactManager.getStats()
    const batchSize = parseInt(process.env.MAX_NUMBERS_PER_BATCH || '10')
    const intervalMinutes = parseInt(process.env.BATCH_COOLDOWN || '900000') / 1000 / 60
    
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
    `
    
    await sendReply(sock, message, statusText)
}

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
    const contacts: Contact[] = contactManager.getAllContacts()
    
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

const handleClearAllContacts = async (sock: any, message: any) => {
    const totalContacts = contactManager.getAllContacts().length
    
    if (totalContacts === 0) {
        await sendReply(sock, message, 'ℹ️ Список контактов уже пуст')
        return
    }

    await sendReply(sock, message, `⚠️ Вы уверены, что хотите удалить ВСЕ ${totalContacts} контактов?\n\nОтправьте "!clear confirm" для подтверждения`)
}

const handleClearConfirm = async (sock: any, message: any) => {
    const cleared = contactManager.clearAllContacts()
    await sendReply(sock, message, `🗑️ Удалено ${cleared} контактов. Список полностью очищен!`)
}

const handleValidateContacts = async (sock: any, message: any) => {
    const allContacts: Contact[] = contactManager.getAllContacts()
    
    if (allContacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для валидации')
        return
    }

    await sendReply(sock, message, `🔍 Валидирую ${allContacts.length} контактов...`)
    
    let validNumbers = 0
    let invalidNumbers = 0
    let whatsappChecked = 0
    let whatsappValid = 0
    let whatsappInvalid = 0
    
    // Убираем ограничение - проверяем ВСЕ номера
    for (let i = 0; i < allContacts.length; i++) {
        const contact = allContacts[i]
        
        // Проверяем формат номера
        if (!isValidMobileNumber(contact.phone)) {
            invalidNumbers++
            markContactAsInvalid(contact.phone)
            continue
        }
        
        validNumbers++
        
        // Проверяем в WhatsApp КАЖДЫЙ номер
        try {
            const isInWhatsApp = await validateWhatsAppNumber(contact.phone, sock)
            if (isInWhatsApp) {
                whatsappValid++
                contactManager.markMessageSent(contact.phone, true)
            } else {
                whatsappInvalid++
                contactManager.markMessageSent(contact.phone, false)
            }
            whatsappChecked++
            
            // Показываем прогресс каждые 10 номеров
            if (whatsappChecked % 10 === 0) {
                await sendReply(sock, message, `⏳ Проверено в WhatsApp: ${whatsappChecked}/${allContacts.length} (✅${whatsappValid} ❌${whatsappInvalid})`)
            }
            
            // Пауза между проверками чтобы не заблокировали
            await new Promise(resolve => setTimeout(resolve, 2000)) // 2 секунды
            
        } catch (error: any) {
            // При ошибке помечаем как недоступный
            whatsappInvalid++
            whatsappChecked++
            contactManager.markMessageSent(contact.phone, false)
            
            // Если слишком много ошибок подряд - увеличиваем паузу
            if (error.message.includes('rate') || error.message.includes('limit')) {
                await sendReply(sock, message, '⚠️ Обнаружено ограничение скорости, увеличиваю паузу...')
                await new Promise(resolve => setTimeout(resolve, 10000)) // 10 секунд пауза
            }
        }
    }

    const report = `
📊 ПОЛНАЯ ВАЛИДАЦИЯ ЗАВЕРШЕНА:

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
• Используйте !clean для удаления заблокированных
• Готово к рассылке: ${whatsappValid} номеров
    `
    
    await sendReply(sock, message, report)
}

// Быстрая валидация только формата
const handleQuickValidate = async (sock: any, message: any) => {
    const allContacts: Contact[] = contactManager.getAllContacts()
    
    if (allContacts.length === 0) {
        await sendReply(sock, message, 'Нет контактов для валидации')
        return
    }

    await sendReply(sock, message, `🔍 Быстрая валидация формата ${allContacts.length} номеров...`)
    
    let validNumbers = 0
    let invalidNumbers = 0
    
    for (const contact of allContacts) {
        if (!isValidMobileNumber(contact.phone)) {
            invalidNumbers++
            markContactAsInvalid(contact.phone)
        } else {
            validNumbers++
        }
    }

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
    `
    
    await sendReply(sock, message, report)
}

const handleCleanInvalidContacts = async (sock: any, message: any) => {
    const beforeCount = contactManager.getAllContacts().length
    const removed = cleanInvalidContacts()
    const afterCount = contactManager.getAllContacts().length
    
    await sendReply(sock, message, `
🧹 ОЧИСТКА НЕВАЛИДНЫХ НОМЕРОВ:

❌ Удалено невалидных: ${removed}
📱 Было контактов: ${beforeCount}
📱 Стало контактов: ${afterCount}

Невалидные номера включают:
• Городские номера
• Короткие номера
• Номера неправильного формата
    `)
}

// Вспомогательные функции
const isValidMobileNumber = (phone: string): boolean => {
    // Простая проверка мобильного номера
    return /^\+\d{10,15}$/.test(phone) && phone.length >= 12
}

const markContactAsInvalid = (phone: string) => {
    contactManager.markMessageSent(phone, false)
}

const validateWhatsAppNumber = async (phone: string, sock: any): Promise<boolean> => {
    try {
        const cleanPhone = phone.replace('+', '')
        const [result] = await sock.onWhatsApp(cleanPhone)
        return result && result.exists
    } catch (error) {
        return false
    }
}

const cleanInvalidContacts = (): number => {
    // Получаем текущие контакты
    const allContacts = contactManager.getAllContacts()
    const beforeCount = allContacts.length
    
    // Фильтруем только валидные номера
    const validContacts = allContacts.filter(contact => isValidMobileNumber(contact.phone))
    
    // Подсчитываем удаленные
    const removed = beforeCount - validContacts.length
    
    return removed
}

const handleSmartSending = async (sock: any, message: any, messageToSend: string) => {
    // Автоматический умный батч
    const contacts: Contact[] = contactManager.getContactsForSending()
    
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

    const contacts: Contact[] = contactManager.getContactsForSending(batchSize)
    
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

// Умная отправка батча с персонализацией
const sendSmartBatch = async (sock: any, message: any, contacts: Contact[], messageTemplate: string) => {
    await sendReply(sock, message, `🚀 Начинаю персонализированную рассылку по ${contacts.length} контактам...`)

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

            // Персонализируем сообщение с названием организации
            let personalizedMessage = messageTemplate
            
            if (contact.name) {
                // Заменяем плейсхолдер {НазваниеОрганизации} на реальное название
                personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, contact.name)
                personalizedMessage = personalizedMessage.replace(/{название}/g, contact.name)
                personalizedMessage = personalizedMessage.replace(/{организация}/g, contact.name)
            } else {
                // Если нет названия, используем общее обращение
                personalizedMessage = personalizedMessage.replace(/{НазваниеОрганизации}/g, 'уважаемая компания')
                personalizedMessage = personalizedMessage.replace(/{название}/g, 'уважаемая компания')
                personalizedMessage = personalizedMessage.replace(/{организация}/g, 'уважаемая компания')
            }

            // Отправляем сообщение
            const jid = contact.phone.replace('+', '') + '@s.whatsapp.net'
            await sock.sendMessage(jid, { text: personalizedMessage })
            
            // Отмечаем успешную отправку
            contactManager.markMessageSent(contact.phone, true)
            success++
            
            cli.print(`✅ Отправлено: ${contact.phone} → ${contact.name || 'без названия'}`)

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
🎉 Персонализированная рассылка завершена!

📊 РЕЗУЛЬТАТ:
✅ Успешно: ${success}
❌ Ошибок: ${errors}
📱 Всего контактов: ${contacts.length}

📈 СТАТИСТИКА ДНЯ:
📤 Отправлено сегодня: ${stats.sending.sentToday}/${stats.sending.dailyLimit}
🔄 Всего отправлено: ${stats.sending.totalSent}
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
🤖 WhatsApp Продвинутый Бот для Рассылки

📱 УПРАВЛЕНИЕ КОНТАКТАМИ:
!add +номер[,имя] - Добавить контакт
!import путь/файл.txt - Импорт из файла
!scan - Сканировать папку uploads/
!list - Показать контакты
!quickvalidate - Быстрая проверка формата
!validate - Полная валидация (формат + WhatsApp)
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

🤖 АВТОМАТИЧЕСКАЯ РАССЫЛКА:
!autostart - Запустить автоматическую рассылку
!autostop - Остановить автоматическую рассылку
!autostatus - Статус и настройки рассылки

🤖 AI ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА:
!ai вопрос - Общение с Gemini (только вы)

⚠️ ВАЖНО:
• Автоответы ИИ ОТКЛЮЧЕНЫ
• Бот НЕ отвечает на обычные сообщения
• Только рассылка и управление контактами

📋 РЕКОМЕНДУЕМАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ:
1. !scan - импорт номеров
2. !quickvalidate - проверка формата
3. !cleaninvalid - удаление невалидных
4. !validate - полная проверка WhatsApp
5. !clean - удаление заблокированных
6. !autostart - запуск рассылки

⚡ ЛИМИТЫ БЕЗОПАСНОСТИ:
• Максимум 10 номеров за раз
• 100 сообщений в день  
• Пауза 15 минут между батчами
• Случайные задержки 5-10 сек
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