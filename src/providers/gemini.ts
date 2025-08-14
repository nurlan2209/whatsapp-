import { GoogleGenerativeAI } from "@google/generative-ai";
import config from "../config";

export let geminiAI: GoogleGenerativeAI;
export let geminiModel: any;

// Инициализация Gemini
export function initGemini() {
    geminiAI = new GoogleGenerativeAI(config.geminiAPIKey);
    // Используем новое название модели
    geminiModel = geminiAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

// Хранение контекстов разговоров
const conversations: { [key: string]: any[] } = {};

export async function generateGeminiResponse(prompt: string, phoneNumber: string): Promise<string> {
    try {
        // Получаем историю разговора
        const history = conversations[phoneNumber] || [];
        
        // Создаем чат с историей
        const chat = geminiModel.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: config.maxModelTokens,
                temperature: 0.7,
            },
        });

        // Отправляем сообщение
        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        const text = response.text();

        // Обновляем историю
        conversations[phoneNumber] = [
            ...history,
            {
                role: "user",
                parts: [{ text: prompt }],
            },
            {
                role: "model", 
                parts: [{ text: text }],
            }
        ];

        return text;
    } catch (error: any) {
        console.error("Gemini API error:", error);
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

// Очистка контекста разговора
export function clearGeminiConversation(phoneNumber: string) {
    delete conversations[phoneNumber];
}