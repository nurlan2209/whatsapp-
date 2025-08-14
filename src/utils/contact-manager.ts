import * as fs from 'fs';
import * as path from 'path';
import * as cli from '../cli/ui';

// Интерфейсы
interface Contact {
    phone: string;
    name?: string;
    source?: string; // из какого файла добавлен
    addedAt: Date;
    lastSent?: Date;
    status: 'active' | 'blocked' | 'invalid' | 'pending';
    sentCount: number;
}

interface SendingStats {
    date: string;
    sentToday: number;
    lastBatchTime?: Date;
    totalSent: number;
}

// Файлы для хранения данных
const CONTACTS_FILE = path.join(process.cwd(), 'data', 'contacts.json');
const STATS_FILE = path.join(process.cwd(), 'data', 'stats.json');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Создаем директории если их нет
const ensureDirectories = () => {
    const dirs = [
        path.dirname(CONTACTS_FILE),
        path.dirname(STATS_FILE),
        UPLOADS_DIR
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

// Лимиты (можно вынести в конфиг)
const LIMITS = {
    MAX_NUMBERS_PER_BATCH: parseInt(process.env.MAX_NUMBERS_PER_BATCH || '20'),
    DAILY_MESSAGE_LIMIT: parseInt(process.env.DAILY_MESSAGE_LIMIT || '100'),
    MIN_DELAY_BETWEEN_MESSAGES: parseInt(process.env.MIN_DELAY_BETWEEN_MESSAGES || '5000'), // 5 секунд
    MAX_DELAY_BETWEEN_MESSAGES: parseInt(process.env.MAX_DELAY_BETWEEN_MESSAGES || '10000'), // 10 секунд
    BATCH_COOLDOWN: parseInt(process.env.BATCH_COOLDOWN || '900000'), // 15 минут между батчами
    MAX_CONTACTS_TOTAL: parseInt(process.env.MAX_CONTACTS_TOTAL || '1000') // максимум контактов всего
};

class ContactManager {
    private contacts: Contact[] = [];
    private stats: SendingStats = {
        date: new Date().toISOString().split('T')[0],
        sentToday: 0,
        totalSent: 0
    };

    constructor() {
        ensureDirectories();
        this.loadContacts();
        this.loadStats();
        this.resetDailyStatsIfNeeded();
    }

    // Загрузка контактов из файла
    private loadContacts() {
        try {
            if (fs.existsSync(CONTACTS_FILE)) {
                const data = fs.readFileSync(CONTACTS_FILE, 'utf8');
                this.contacts = JSON.parse(data);
                cli.print(`📱 Загружено ${this.contacts.length} контактов`);
            }
        } catch (error: any) {
            cli.printError(`Ошибка загрузки контактов: ${error.message}`);
            this.contacts = [];
        }
    }

    // Сохранение контактов в файл
    private saveContacts() {
        try {
            fs.writeFileSync(CONTACTS_FILE, JSON.stringify(this.contacts, null, 2));
        } catch (error: any) {
            cli.printError(`Ошибка сохранения контактов: ${error.message}`);
        }
    }

    // Загрузка статистики
    private loadStats() {
        try {
            if (fs.existsSync(STATS_FILE)) {
                const data = fs.readFileSync(STATS_FILE, 'utf8');
                this.stats = { ...this.stats, ...JSON.parse(data) };
            }
        } catch (error: any) {
            cli.printError(`Ошибка загрузки статистики: ${error.message}`);
        }
    }

    // Сохранение статистики
    private saveStats() {
        try {
            fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
        } catch (error: any) {
            cli.printError(`Ошибка сохранения статистики: ${error.message}`);
        }
    }

    // Сброс дневной статистики
    private resetDailyStatsIfNeeded() {
        const today = new Date().toISOString().split('T')[0];
        if (this.stats.date !== today) {
            this.stats.date = today;
            this.stats.sentToday = 0;
            this.saveStats();
            cli.print(`📅 Статистика сброшена для нового дня: ${today}`);
        }
    }

    // Добавление одного контакта
    addContact(phone: string, name?: string, source?: string): { success: boolean; message: string } {
        if (this.contacts.length >= LIMITS.MAX_CONTACTS_TOTAL) {
            return { 
                success: false, 
                message: `Достигнут лимит контактов: ${LIMITS.MAX_CONTACTS_TOTAL}` 
            };
        }

        const cleanPhone = this.formatPhone(phone);
        
        if (!this.isValidPhone(cleanPhone)) {
            return { success: false, message: `Некорректный номер: ${phone}` };
        }

        // Проверяем дубликаты
        const existing = this.contacts.find(c => c.phone === cleanPhone);
        if (existing) {
            return { success: false, message: `Номер ${cleanPhone} уже существует` };
        }

        const contact: Contact = {
            phone: cleanPhone,
            name,
            source,
            addedAt: new Date(),
            status: 'pending',
            sentCount: 0
        };

        this.contacts.push(contact);
        this.saveContacts();

        return { 
            success: true, 
            message: `Контакт ${cleanPhone} добавлен${name ? ` (${name})` : ''}` 
        };
    }

    // Импорт из файла
    importFromFile(filePath: string): { success: boolean; added: number; errors: string[] } {
        const result = { success: false, added: 0, errors: [] as string[] };
        
        try {
            if (!fs.existsSync(filePath)) {
                result.errors.push(`Файл не найден: ${filePath}`);
                return result;
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                try {
                    // Поддерживаем форматы:
                    // +71234567890
                    // +71234567890,Имя
                    // 71234567890;Имя Фамилия
                    const [phone, ...nameParts] = line.split(/[,;]/).map(s => s.trim());
                    const name = nameParts.join(' ') || undefined;
                    
                    const addResult = this.addContact(phone, name, path.basename(filePath));
                    if (addResult.success) {
                        result.added++;
                    } else {
                        result.errors.push(`Строка ${i + 1}: ${addResult.message}`);
                    }
                } catch (error: any) {
                    result.errors.push(`Строка ${i + 1}: ${error.message}`);
                }
            }

            result.success = result.added > 0;
            cli.print(`📁 Импорт из ${filePath}: добавлено ${result.added}, ошибок ${result.errors.length}`);

        } catch (error: any) {
            result.errors.push(`Ошибка чтения файла: ${error.message}`);
        }

        return result;
    }

    // Получение контактов для отправки
    getContactsForSending(limit?: number): Contact[] {
        const activeContacts = this.contacts.filter(c => c.status === 'active' || c.status === 'pending');
        const batchSize = Math.min(limit || LIMITS.MAX_NUMBERS_PER_BATCH, LIMITS.MAX_NUMBERS_PER_BATCH);
        
        return activeContacts.slice(0, batchSize);
    }

    // Проверка лимитов перед отправкой
    canSendMessages(count: number): { canSend: boolean; reason?: string } {
        // Проверяем дневной лимит
        if (this.stats.sentToday + count > LIMITS.DAILY_MESSAGE_LIMIT) {
            return {
                canSend: false,
                reason: `Превышен дневной лимит. Отправлено: ${this.stats.sentToday}/${LIMITS.DAILY_MESSAGE_LIMIT}`
            };
        }

        // Проверяем кулдаун между батчами
        if (this.stats.lastBatchTime) {
            const timeSinceLastBatch = Date.now() - new Date(this.stats.lastBatchTime).getTime();
            if (timeSinceLastBatch < LIMITS.BATCH_COOLDOWN) {
                const remainingTime = Math.ceil((LIMITS.BATCH_COOLDOWN - timeSinceLastBatch) / 1000 / 60);
                return {
                    canSend: false,
                    reason: `Нужно подождать ${remainingTime} минут до следующего батча`
                };
            }
        }

        return { canSend: true };
    }

    // Отметка об отправке сообщения
    markMessageSent(phone: string, success: boolean) {
        const contact = this.contacts.find(c => c.phone === phone);
        if (contact) {
            contact.lastSent = new Date();
            contact.sentCount++;
            
            if (success) {
                contact.status = 'active';
                this.stats.sentToday++;
                this.stats.totalSent++;
            } else {
                // После нескольких неудач помечаем как заблокированный
                if (contact.sentCount >= 3) {
                    contact.status = 'blocked';
                }
            }
        }

        this.stats.lastBatchTime = new Date();
        this.saveContacts();
        this.saveStats();
    }

    // Получение статистики
    getStats() {
        const total = this.contacts.length;
        const active = this.contacts.filter(c => c.status === 'active').length;
        const blocked = this.contacts.filter(c => c.status === 'blocked').length;
        const pending = this.contacts.filter(c => c.status === 'pending').length;

        return {
            contacts: { total, active, blocked, pending },
            sending: {
                sentToday: this.stats.sentToday,
                dailyLimit: LIMITS.DAILY_MESSAGE_LIMIT,
                totalSent: this.stats.totalSent,
                lastBatch: this.stats.lastBatchTime
            },
            limits: LIMITS
        };
    }

    // Получение всех контактов
    getAllContacts(): Contact[] {
        return [...this.contacts];
    }

    // Очистка заблокированных контактов
    cleanBlockedContacts(): number {
        const beforeCount = this.contacts.length;
        this.contacts = this.contacts.filter(c => c.status !== 'blocked');
        const removed = beforeCount - this.contacts.length;
        
        if (removed > 0) {
            this.saveContacts();
            cli.print(`🧹 Удалено ${removed} заблокированных контактов`);
        }
        
        return removed;
    }

    // Очистка всех контактов
    clearAllContacts(): number {
        const beforeCount = this.contacts.length;
        this.contacts = [];
        this.saveContacts();
        
        cli.print(`🗑️ Удалено ${beforeCount} контактов`);
        return beforeCount;
    }

    // Очистка невалидных контактов
    cleanInvalidContacts(): number {
        const beforeCount = this.contacts.length;
        this.contacts = this.contacts.filter(c => this.isValidMobileNumber(c.phone));
        const removed = beforeCount - this.contacts.length;
        
        if (removed > 0) {
            this.saveContacts();
            cli.print(`🧹 Удалено ${removed} невалидных контактов`);
        }
        
        return removed;
    }

    // Проверка валидности мобильного номера
    isValidMobileNumber(phone: string): boolean {
        // Проверяем что это мобильный номер (не городской)
        const cleanPhone = phone.replace(/[^\d]/g, '');
        
        // Казахстанские мобильные номера: 77XXXXXXXX (10 цифр после +7)
        // Российские мобильные: 79XXXXXXXX (10 цифр после +7)
        // Другие страны: минимум 10 цифр
        if (cleanPhone.startsWith('77')) {
            return cleanPhone.length === 11; // +77XXXXXXXXX
        } else if (cleanPhone.startsWith('79')) {
            return cleanPhone.length === 11; // +79XXXXXXXXX
        } else {
            return cleanPhone.length >= 10 && cleanPhone.length <= 15;
        }
    }

    // Отметка контакта как невалидного
    markContactAsInvalid(phone: string) {
        const contact = this.contacts.find(c => c.phone === phone);
        if (contact) {
            contact.status = 'invalid';
            this.saveContacts();
        }
    }

    // Проверка номера в WhatsApp
    async validateWhatsAppNumber(phone: string, sock: any): Promise<boolean> {
        try {
            const cleanPhone = phone.replace('+', '');
            const [result] = await sock.onWhatsApp(cleanPhone);
            return result && result.exists;
        } catch (error) {
            return false;
        }
    }

    // Сканирование папки uploads на новые файлы
    scanUploadsFolder(): string[] {
        try {
            if (!fs.existsSync(UPLOADS_DIR)) {
                return [];
            }

            const files = fs.readdirSync(UPLOADS_DIR)
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return ['.txt', '.csv'].includes(ext);
                })
                .map(file => path.join(UPLOADS_DIR, file));

            return files;
        } catch (error: any) {
            cli.printError(`Ошибка сканирования папки uploads: ${error.message}`);
            return [];
        }
    }

    // Получение случайной задержки
    getRandomDelay(): number {
        return Math.floor(
            Math.random() * (LIMITS.MAX_DELAY_BETWEEN_MESSAGES - LIMITS.MIN_DELAY_BETWEEN_MESSAGES) +
            LIMITS.MIN_DELAY_BETWEEN_MESSAGES
        );
    }

    // Форматирование телефона
    private formatPhone(phone: string): string {
        let cleaned = phone.replace(/[^\d+]/g, '');
        
        if (cleaned.startsWith('8')) {
            cleaned = '+7' + cleaned.substring(1);
        } else if (cleaned.startsWith('7') && !cleaned.startsWith('+7')) {
            cleaned = '+' + cleaned;
        } else if (!cleaned.startsWith('+')) {
            cleaned = '+' + cleaned;
        }
        
        return cleaned;
    }

    // Проверка валидности номера
    private isValidPhone(phone: string): boolean {
        return /^\+\d{10,15}$/.test(phone);
    }
}

export default ContactManager;