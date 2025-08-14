import { Client, Message } from "whatsapp-web.js";
import config from "../config";
import * as cli from "../cli/ui";

// Функция для массовой рассылки
export const startMassMessaging = async (client: Client, message: Message, customMessage?: string) => {
	try {
		const phoneNumbers = config.targetPhoneNumbers;
		const messageText = customMessage || config.messageTemplate;
		
		if (phoneNumbers.length === 0) {
			message.reply("Список номеров для рассылки пуст. Добавьте номера в TARGET_PHONE_NUMBERS.");
			return;
		}

		cli.print(`[MASS MESSAGING] Starting mass messaging to ${phoneNumbers.length} numbers`);
		message.reply(`Начинаю рассылку по ${phoneNumbers.length} номерам...`);

		let successCount = 0;
		let errorCount = 0;

		for (let i = 0; i < phoneNumbers.length; i++) {
			const phoneNumber = phoneNumbers[i].trim();
			
			try {
				// Форматируем номер для WhatsApp (добавляем @c.us если нужно)
				const formattedNumber = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
				
				cli.print(`[MASS MESSAGING] Sending message ${i + 1}/${phoneNumbers.length} to ${phoneNumber}`);
				
				// Отправляем сообщение
				await client.sendMessage(formattedNumber, messageText);
				successCount++;
				
				cli.print(`[MASS MESSAGING] ✓ Message sent to ${phoneNumber}`);
				
				// Задержка между сообщениями
				if (i < phoneNumbers.length - 1) {
					await sleep(config.messagingDelay);
				}
				
			} catch (error: any) {
				errorCount++;
				cli.printError(`[MASS MESSAGING] ✗ Failed to send to ${phoneNumber}: ${error.message}`);
			}
		}

		const report = `Рассылка завершена!\n✓ Успешно: ${successCount}\n✗ Ошибок: ${errorCount}`;
		cli.print(`[MASS MESSAGING] ${report}`);
		message.reply(report);

	} catch (error: any) {
		cli.printError(`[MASS MESSAGING] Fatal error: ${error.message}`);
		message.reply(`Критическая ошибка рассылки: ${error.message}`);
	}
};

// Добавление номера в список для рассылки
export const addPhoneNumber = async (message: Message, phoneNumber: string) => {
	try {
		if (!phoneNumber || phoneNumber.trim() === "") {
			message.reply("Укажите номер телефона для добавления.");
			return;
		}

		// Простая валидация номера
		const cleanNumber = phoneNumber.replace(/[^\d+]/g, "");
		if (cleanNumber.length < 10) {
			message.reply("Некорректный номер телефона.");
			return;
		}

		// Добавляем номер в список (в реальном проекте лучше сохранять в БД)
		if (!config.targetPhoneNumbers.includes(cleanNumber)) {
			config.targetPhoneNumbers.push(cleanNumber);
			message.reply(`Номер ${cleanNumber} добавлен в список рассылки.`);
		} else {
			message.reply(`Номер ${cleanNumber} уже есть в списке.`);
		}

	} catch (error: any) {
		message.reply(`Ошибка добавления номера: ${error.message}`);
	}
};

// Просмотр списка номеров
export const showPhoneNumbers = async (message: Message) => {
	try {
		const numbers = config.targetPhoneNumbers;
		if (numbers.length === 0) {
			message.reply("Список номеров для рассылки пуст.");
			return;
		}

		const numbersText = numbers.map((num, index) => `${index + 1}. ${num}`).join('\n');
		message.reply(`Номера для рассылки (${numbers.length}):\n${numbersText}`);

	} catch (error: any) {
		message.reply(`Ошибка получения списка: ${error.message}`);
	}
};

// Удаление номера из списка
export const removePhoneNumber = async (message: Message, phoneNumber: string) => {
	try {
		const cleanNumber = phoneNumber.replace(/[^\d+]/g, "");
		const index = config.targetPhoneNumbers.indexOf(cleanNumber);
		
		if (index > -1) {
			config.targetPhoneNumbers.splice(index, 1);
			message.reply(`Номер ${cleanNumber} удален из списка рассылки.`);
		} else {
			message.reply(`Номер ${cleanNumber} не найден в списке.`);
		}

	} catch (error: any) {
		message.reply(`Ошибка удаления номера: ${error.message}`);
	}
};

// Функция задержки
const sleep = (ms: number): Promise<void> => {
	return new Promise(resolve => setTimeout(resolve, ms));
};