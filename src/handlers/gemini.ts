import { Message } from "whatsapp-web.js";
import { generateGeminiResponse, clearGeminiConversation } from "../providers/gemini";
import * as cli from "../cli/ui";
import config from "../config";

// Обработка сообщений через Gemini
const handleMessageGemini = async (message: Message, prompt: string) => {
	try {
		cli.print(`[GEMINI] Received prompt from ${message.from}: ${prompt}`);

		const start = Date.now();

		// Добавляем pre-prompt если есть
		let fullPrompt = prompt;
		if (config.prePrompt && config.prePrompt.trim() !== "") {
			fullPrompt = `${config.prePrompt}\n\n${prompt}`;
		}

		// Генерируем ответ через Gemini
		const response = await generateGeminiResponse(fullPrompt, message.from);

		const end = Date.now() - start;

		cli.print(`[GEMINI] Answer to ${message.from}: ${response} | Request took ${end}ms`);

		// Отправляем ответ
		message.reply(response);
	} catch (error: any) {
		console.error("An error occurred", error);
		message.reply("Произошла ошибка, обратитесь к администратору. (" + error.message + ")");
	}
};

// Удаление контекста разговора
const handleDeleteConversation = async (message: Message) => {
	try {
		clearGeminiConversation(message.from);
		message.reply("Контекст разговора сброшен!");
	} catch (error: any) {
		console.error("Error deleting conversation", error);
		message.reply("Ошибка при сбросе контекста: " + error.message);
	}
};

export { handleMessageGemini, handleDeleteConversation };