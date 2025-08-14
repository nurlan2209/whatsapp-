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

	// Mass messaging (новая функция)
	massMessagingEnabled: boolean;
	targetPhoneNumbers: string[];
	messageTemplate: string;
	messagingDelay: number; // задержка между сообщениями в мс

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
	gptPrefix: process.env.GPT_PREFIX || "!ai", // Изменили на !ai
	resetPrefix: process.env.RESET_PREFIX || "!reset",
	aiConfigPrefix: process.env.AI_CONFIG_PREFIX || "!config",

	// Groupchats
	groupchatsEnabled: getEnvBooleanWithDefault("GROUPCHATS_ENABLED", false),

	// Mass messaging
	massMessagingEnabled: getEnvBooleanWithDefault("MASS_MESSAGING_ENABLED", false),
	targetPhoneNumbers: process.env.TARGET_PHONE_NUMBERS?.split(",") || [],
	messageTemplate: process.env.MESSAGE_TEMPLATE || "Привет! Предлагаю свои услуги...",
	messagingDelay: parseInt(process.env.MESSAGING_DELAY || "5000"), // 5 секунд по умолчанию

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