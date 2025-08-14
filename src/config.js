const process = require("process");
require("dotenv").config();

// Функция для обработки переносов строк в тексте
function processMessageText(text) {
	if (!text) return "";
	// Заменяем \\n на реальные переносы строк
	return text.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
}

function getEnvMaxModelTokens() {
	const envValue = process.env.MAX_MODEL_TOKENS;
	if (envValue == undefined || envValue == "") {
		return 4096;
	}
	return parseInt(envValue);
}

function getEnvBooleanWithDefault(key, defaultValue) {
	const envValue = process.env[key]?.toLowerCase();
	if (envValue == undefined || envValue == "") {
		return defaultValue;
	}
	return envValue == "true";
}

// Config
const config = {
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

	// Mass messaging texts - обрабатываем из .env с заменой \n
	massMessageText: processMessageText(process.env.MASS_MESSAGE_TEXT) || 
		"Здравствуйте, {НазваниеОрганизации}! 🙌\n\nМы — студия разработки znstudio.kz.\nСоздаём современные и удобные сайты, которые помогают бизнесу привлекать клиентов.\n\nНаши работы можно увидеть на сайте kartofan.online\n\nЕсли вам будет интересно — с радостью поделимся подробностями.\nInstagram: @znstudio.kz",
	
	massMessageText1: processMessageText(process.env.MASS_MESSAGE_TEXT_1) || 
		"Добрый день, {НазваниеОрганизации}! 👋\n\nСтудия znstudio.kz предлагает создание современных сайтов для развития вашего бизнеса.\n\nПримеры наших работ: kartofan.online\n\nОбсудим ваш проект? Instagram: @znstudio.kz",
	
	massMessageText2: processMessageText(process.env.MASS_MESSAGE_TEXT_2) || 
		"🔥 Специальное предложение для {НазваниеОрганизации}!\n\nСоздание профессионального сайта от znstudio.kz.\n\nПортфолио: kartofan.online\n\nСвяжемся для обсуждения? Instagram: @znstudio.kz",
	
	massMessageText3: processMessageText(process.env.MASS_MESSAGE_TEXT_3) || 
		"⚡ {НазваниеОрганизации}, автоматизируем ваш бизнес!\n\nСовременные сайты и веб-решения от znstudio.kz.\n\nНаши кейсы: kartofan.online\n\nБесплатная консультация! Instagram: @znstudio.kz",
};

module.exports = { default: config };