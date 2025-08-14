import * as cli from "../cli/ui";
import config from "../config";
import { generateGeminiResponse, clearGeminiConversation } from "../providers/gemini";

// Обработка сообщений через Gemini для Baileys
const handleMessageGemini = async (sock: any, message: any, prompt: string) => {
	try {
		cli.print(`[GEMINI] Received prompt from ${message.key.remoteJid}: ${prompt}`);

		const start = Date.now();

		// Добавляем pre-prompt если есть
		let fullPrompt = prompt;
		if (config.prePrompt && config.prePrompt.trim() !== "") {
			fullPrompt = `${config.prePrompt}\n\n${prompt}`;
		}

		// Генерируем ответ через Gemini
		const response = await generateGeminiResponse(fullPrompt, message.key.remoteJid || 'unknown');

		const end = Date.now() - start;

		cli.print(`[GEMINI] Answer to ${message.key.remoteJid}: ${response} | Request took ${end}ms`);

		// Отправляем ответ через Baileys
		await sock.sendMessage(message.key.remoteJid, { text: response });
	} catch (error: any) {
		console.error("An error occurred", error);
		await sock.sendMessage(message.key.remoteJid, { text: "Произошла ошибка, обратитесь к администратору. (" + error.message + ")" });
	}
};

// Удаление контекста разговора для Baileys
const handleDeleteConversation = async (sock: any, message: any) => {
	try {
		clearGeminiConversation(message.key.remoteJid || 'unknown');
		await sock.sendMessage(message.key.remoteJid, { text: "Контекст разговора сброшен!" });
	} catch (error: any) {
		console.error("Error deleting conversation", error);
		await sock.sendMessage(message.key.remoteJid, { text: "Ошибка при сбросе контекста: " + error.message });
	}
};

export { handleMessageGemini, handleDeleteConversation };