import process from "process";
import { TranscriptionMode } from "./types/transcription-mode";
import { TTSMode } from "./types/tts-mode";

// Environment variables
import dotenv from "dotenv";
dotenv.config();

// Config Interface
interface IConfig {
	// Access control
	whitelistedPhoneNumbers: string[];
	whitelistedEnabled: boolean;
	
	// Gemini AI
	geminiAPIKey: string;
	maxModelTokens: number;
	prePrompt: string | undefined;

	// Prefix
	prefixEnabled: boolean;
	prefixSkippedForMe: boolean;
	gptPrefix: string;
	resetPrefix: string;
	aiConfigPrefix: string;

	// Groupchats
	groupchatsEnabled: boolean;

	// AI Auto responses
	aiAutoResponsesEnabled: boolean;

	// Mass messaging texts
	massMessageText: string;
	massMessageText1: string;
	massMessageText2: string;
	massMessageText3: string;

	// Voice transcription & Text-to-Speech
	speechServerUrl: string;
	ttsEnabled: boolean;
	ttsMode: TTSMode;
	transcriptionEnabled: boolean;
	transcriptionMode: TranscriptionMode;
	transcriptionLanguage: string;
}

// Config
export const config: IConfig = {
	whitelistedPhoneNumbers: process.env.WHITELISTED_PHONE_NUMBERS?.split(",") || [],
	whitelistedEnabled: getEnvBooleanWithDefault("WHITELISTED_ENABLED", false),

	// Gemini
	geminiAPIKey: process.env.GEMINI_API_KEY || "",
	maxModelTokens: getEnvMaxModelTokens(), // Default: 4096
	prePrompt: process.env.PRE_PROMPT, // Default: undefined

	// Prefix
	prefixEnabled: getEnvBooleanWithDefault("PREFIX_ENABLED", true),
	prefixSkippedForMe: getEnvBooleanWithDefault("PREFIX_SKIPPED_FOR_ME", true),
	gptPrefix: process.env.GPT_PREFIX || "!ai",
	resetPrefix: process.env.RESET_PREFIX || "!reset",
	aiConfigPrefix: process.env.AI_CONFIG_PREFIX || "!config",

	// Groupchats
	groupchatsEnabled: getEnvBooleanWithDefault("GROUPCHATS_ENABLED", false),

	// AI Auto responses
	aiAutoResponsesEnabled: getEnvBooleanWithDefault("AI_AUTO_RESPONSES_ENABLED", false),

	// Mass messaging texts
	massMessageText: process.env.MASS_MESSAGE_TEXT || "🤖 Создаю ботов для автоматизации бизнеса! WhatsApp, Telegram, интеграции с CRM. Цены от 50000₸. Бесплатная консультация!",
	massMessageText1: process.env.MASS_MESSAGE_TEXT_1 || "💼 Привет! Помогаю предпринимателям автоматизировать рутину через ботов. Увеличиваем продажи на 40%. Интересно обсудить?",
	massMessageText2: process.env.MASS_MESSAGE_TEXT_2 || "🔥 АКЦИЯ! Скидка 30% на создание ботов! Только до конца месяца. Подробности в ЛС.",
	massMessageText3: process.env.MASS_MESSAGE_TEXT_3 || "⚡ Автоматизация бизнеса под ключ! Боты, чат-боты, интеграции. Экономим время и увеличиваем прибыль!",

	// Speech API
	speechServerUrl: process.env.SPEECH_API_URL || "https://speech-service.verlekar.com",

	// Text-to-Speech
	ttsEnabled: getEnvBooleanWithDefault("TTS_ENABLED", false),
	ttsMode: getEnvTTSMode(),

	// Transcription
	transcriptionEnabled: getEnvBooleanWithDefault("TRANSCRIPTION_ENABLED", false),
	transcriptionMode: getEnvTranscriptionMode(),
	transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE || ""
};

function getEnvMaxModelTokens() {
	const envValue = process.env.MAX_MODEL_TOKENS;
	if (envValue == undefined || envValue == "") {
		return 4096;
	}
	return parseInt(envValue);
}

function getEnvBooleanWithDefault(key: string, defaultValue: boolean): boolean {
	const envValue = process.env[key]?.toLowerCase();
	if (envValue == undefined || envValue == "") {
		return defaultValue;
	}
	return envValue == "true";
}

function getEnvTranscriptionMode(): TranscriptionMode {
	const envValue = process.env.TRANSCRIPTION_MODE?.toLowerCase();
	if (envValue == undefined || envValue == "") {
		return TranscriptionMode.Local;
	}
	return envValue as TranscriptionMode;
}

function getEnvTTSMode(): TTSMode {
	const envValue = process.env.TTS_MODE?.toLowerCase();
	if (envValue == undefined || envValue == "") {
		return TTSMode.SpeechAPI;
	}
	return envValue as TTSMode;
}

export default config;