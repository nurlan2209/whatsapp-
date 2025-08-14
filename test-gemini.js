// Временный файл для проверки доступных моделей
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
    try {
        console.log("🔍 Checking available Gemini models...");
        
        // Тестируем разные модели
        const modelsToTest = [
            "gemini-1.5-flash",
            "gemini-1.5-pro", 
            "gemini-pro",
            "models/gemini-1.5-flash",
            "models/gemini-1.5-pro",
            "models/gemini-pro"
        ];

        for (const modelName of modelsToTest) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hello");
                console.log(`✅ ${modelName} - РАБОТАЕТ`);
                break;
            } catch (error) {
                console.log(`❌ ${modelName} - ${error.message}`);
            }
        }
    } catch (error) {
        console.error("Error:", error.message);
    }
}

listModels();