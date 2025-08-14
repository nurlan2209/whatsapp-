import { Message, Client } from "whatsapp-web.js";
import { startsWithIgnoreCase } from "../utils";

// Config & Constants
import config from "../config";

// CLI
import * as cli from "../cli/ui";

// Gemini handlers
import { handleMessageGemini, handleDeleteConversation } from "../handlers/gemini";

// Mass messaging
import { 
	startMassMessaging, 
	addPhoneNumber, 
	showPhoneNumbers, 
	removePhoneNumber 
} from "../handlers/mass-messaging";

// For deciding to ignore old messages
import { botReadyTimestamp } from "../index";

// Глобальная ссылка на клиент (для массовой рассылки)
let whatsappClient: Client;

export const setWhatsAppClient = (client: Client) => {
	whatsappClient = client;
};

// Handles message
async function handleIncomingMessage(message: Message) {
	let messageString = message.body;

	// Prevent handling old messages
	if (message.timestamp != null) {
		const messageTimestamp = new Date(message.timestamp * 1000);

		if (botReadyTimestamp == null) {
			cli.print("Ignoring message because bot is not ready yet: " + messageString);
			return;
		}

		if (messageTimestamp < botReadyTimestamp) {
			cli.print("Ignoring old message: " + messageString);
			return;
		}
	}

	// Ignore groupchats if disabled
	if ((await message.getChat()).isGroup && !config.groupchatsEnabled) return;

	const selfNotedMessage = message.fromMe && message.hasQuotedMsg === false && message.from === message.to;

	// Whitelist check
	if (config.whitelistedEnabled) {
		const whitelistedPhoneNumbers = config.whitelistedPhoneNumbers;

		if (!selfNotedMessage && whitelistedPhoneNumbers.length > 0 && !whitelistedPhoneNumbers.includes(message.from)) {
			cli.print(`Ignoring message from ${message.from} because it is not whitelisted.`);
			return;
		}
	}

	// === КОМАНДЫ МАССОВОЙ РАССЫЛКИ ===
	
	// Старт массовой рассылки (!send)
	if (startsWithIgnoreCase(messageString, "!send")) {
		if (!selfNotedMessage) {
			message.reply("Эта команда доступна только отправителю.");
			return;
		}
		
		const customMessage = messageString.substring(5).trim();
		await startMassMessaging(whatsappClient, message, customMessage || undefined);
		return;
	}

	// Добавить номер (!add +1234567890)
	if (startsWithIgnoreCase(messageString, "!add")) {
		if (!selfNotedMessage) {
			message.reply("Эта команда доступна только отправителю.");
			return;
		}
		
		const phoneNumber = messageString.substring(4).trim();
		await addPhoneNumber(message, phoneNumber);
		return;
	}

	// Показать список номеров (!list)
	if (startsWithIgnoreCase(messageString, "!list")) {
		if (!selfNotedMessage) {
			message.reply("Эта команда доступна только отправителю.");
			return;
		}
		
		await showPhoneNumbers(message);
		return;
	}

	// Удалить номер (!remove +1234567890)
	if (startsWithIgnoreCase(messageString, "!remove")) {
		if (!selfNotedMessage) {
			message.reply("Эта команда доступна только отправителю.");
			return;
		}
		
		const phoneNumber = messageString.substring(7).trim();
		await removePhoneNumber(message, phoneNumber);
		return;
	}

	// Помощь по командам (!help)
	if (startsWithIgnoreCase(messageString, "!help")) {
		const helpText = `
Доступные команды:

📤 РАССЫЛКА:
!send [сообщение] - Начать массовую рассылку
!add +номер - Добавить номер в список
!remove +номер - Удалить номер из списка  
!list - Показать все номера

🤖 AI:
${config.gptPrefix} текст - Общение с ИИ
${config.resetPrefix} - Сбросить контекст

⚙️ НАСТРОЙКИ:
${config.aiConfigPrefix} - Конфигурация бота

Пример рассылки:
!send Привет! Предлагаю качественные услуги по разработке ботов. Подробности в ЛС.
		`;
		message.reply(helpText);
		return;
	}

	// === ОСНОВНЫЕ КОМАНДЫ ===

	// Clear conversation context (!reset)
	if (startsWithIgnoreCase(messageString, config.resetPrefix)) {
		await handleDeleteConversation(message);
		return;
	}

	// AI Chat (!ai <prompt>)
	if (startsWithIgnoreCase(messageString, config.gptPrefix)) {
		const prompt = messageString.substring(config.gptPrefix.length + 1);
		if (prompt.trim() === "") {
			message.reply("Напишите ваш вопрос после команды " + config.gptPrefix);
			return;
		}
		await handleMessageGemini(message, prompt);
		return;
	}

	// AI без префикса (только для сообщений себе)
	if (!config.prefixEnabled || (config.prefixSkippedForMe && selfNotedMessage)) {
		await handleMessageGemini(message, messageString);
		return;
	}
}

export { handleIncomingMessage };