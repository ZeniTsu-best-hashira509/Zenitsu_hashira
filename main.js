global.startTime = Date.now();
global.sessions = new Map();

// ==================== GESTION AVANCÃ‰E DES ERREURS ====================
process.on('uncaughtException', (err) => {
    console.error('ðŸ’¥ ERREUR NON CAPTURÃ‰E:', err.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('âš ï¸ PROMISE NON GÃ‰RÃ‰E:', reason);
});

process.on('warning', (warning) => {
    console.warn('âš ï¸ WARNING:', warning.message);
});

process.on('SIGINT', () => {
    console.log('ðŸ›‘ ArrÃªt propre du bot...');
    process.exit(0);
});

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// ==================== CONFIGURATION ====================
const CONFIG = {
    SESSION_DIR: 'session1',
    COMMANDS_DIR: './commands',
    RECONNECT_DELAY: 3000,
    MAX_RECONNECT_ATTEMPTS: 10,
    OWNER_JID: '50935948231@s.whatsapp.net',
    PREFIX: '+'
};

let reconnectAttempts = 0;

// ==================== FONCTIONS UTILITAIRES ====================
const safeRequire = (modulePath) => {
    try {
        // âœ… RÃ©soudre le chemin absolu
        const absolutePath = path.resolve(process.cwd(), modulePath);
        
        // âœ… Supprimer du cache si existe
        if (require.cache[require.resolve(absolutePath)]) {
            delete require.cache[require.resolve(absolutePath)];
        }
        
        return require(absolutePath);
    } catch (err) {
        console.error(`âŒ Erreur chargement module ${modulePath}:`, err.message);
        return null;
    }
};

const safeSendMessage = async (sock, jid, content, options = {}) => {
    try {
        return await sock.sendMessage(jid, content, options);
    } catch (err) {
        console.error(`âŒ Erreur envoi message vers ${jid}:`, err.message);
        return null;
    }
};

// ==================== GESTIONNAIRE DE COMMANDES ====================
class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.replyHandlers = new Map();
    }

    loadCommands(commandsDir) {
        // âœ… RÃ©soudre le chemin absolu du dossier commands
        const absoluteCommandsDir = path.resolve(process.cwd(), commandsDir);
        
        if (!fs.existsSync(absoluteCommandsDir)) {
            console.warn(`âš ï¸ Dossier ${absoluteCommandsDir} inexistant, crÃ©ation...`);
            fs.mkdirSync(absoluteCommandsDir, { recursive: true });
            return;
        }

        const files = fs.readdirSync(absoluteCommandsDir).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            // âœ… Utiliser le chemin absolu complet
            const fullPath = path.join(absoluteCommandsDir, file);
            const command = safeRequire(fullPath);
            
            if (!command) continue;

            if (command.name && typeof command.execute === 'function') {
                this.commands.set(command.name.toLowerCase(), command);
                console.log(`âœ… Commande chargÃ©e: ${command.name}`);
            }

            if (typeof command.onReply === 'function') {
                this.replyHandlers.set(file, command.onReply);
            }
        }
    }

    async executeCommand(sock, msg, commandName, args) {
        const command = this.commands.get(commandName.toLowerCase());
        if (!command) return false;

        try {
            await command.execute(sock, msg, args);
            return true;
        } catch (err) {
            console.error(`âŒ Erreur exÃ©cution ${commandName}:`, err);
            await safeSendMessage(sock, msg.key.remoteJid, {
                text: `âŒ Erreur: ${err.message}`
            }, { quoted: msg });
            return false;
        }
    }

    async processReplies(sock, msg) {
        for (const handler of this.replyHandlers.values()) {
            try {
                const handled = await handler(sock, msg);
                if (handled) return true;
            } catch (err) {
                console.error('âŒ Erreur onReply:', err);
            }
        }
        return false;
    }
}

// ==================== BOT PRINCIPAL ====================
class ZenitsuBot {
    constructor() {
        this.sock = null;
        this.commandHandler = new CommandHandler();
        this.isConnected = false;
        this.reconnectTimer = null;
    }

    async start() {
        try {
            // Auth
            const { state, saveCreds } = await useMultiFileAuthState(CONFIG.SESSION_DIR);
            const { version } = await fetchLatestBaileysVersion();

            // Socket avec options robustes
            this.sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
                },
                logger: P({ level: 'silent' }),
                browser: ['Mac OS', 'Firefox', '1.0.0'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                markOnlineOnConnect: true,
                syncFullHistory: false
            });

            // Ã‰vÃ©nements
            this.setupConnectionHandler(saveCreds);
            this.setupMessageHandler();
            this.loadEvents();

            // âœ… Charger commandes AVANT la connexion
            console.log('ðŸ“‚ Chargement des commandes...');
            this.commandHandler.loadCommands(CONFIG.COMMANDS_DIR);
            console.log(`ðŸ“Š Total commandes chargÃ©es: ${this.commandHandler.commands.size}`);

        } catch (err) {
            console.error('ðŸ’¥ Erreur dÃ©marrage:', err);
            this.scheduleReconnect();
        }
    }

    setupConnectionHandler(saveCreds) {
        this.sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;

            if (qr) {
                console.log('ðŸ“· Scan QR:');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'open') {
                this.isConnected = true;
                reconnectAttempts = 0;
                console.log('âœ… Bot connectÃ© !');
                await this.sendOwnerNotification();
            }

            if (connection === 'close') {
                this.isConnected = false;
                console.log('âŒ DÃ©connectÃ©');
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== 401;
                
                if (shouldReconnect) {
                    this.scheduleReconnect();
                } else {
                    console.error('ðŸ”’ Session invalide, suppression nÃ©cessaire');
                    process.exit(1);
                }
            }
        });

        this.sock.ev.on('creds.update', saveCreds);
    }

    setupMessageHandler() {
        this.sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message) return;

                const from = msg.key.remoteJid;
                const body = this.extractMessageBody(msg);
                const sender = msg.key.participant || from;

                console.log(`ðŸ“¨ [${sender.split('@')[0]}] ${body.substring(0)}`);

                // Traiter les rÃ©ponses en attente
                const replyHandled = await this.commandHandler.processReplies(this.sock, msg);
                if (replyHandled) return;

                // Traiter les commandes
                if (body.startsWith(CONFIG.PREFIX)) {
                    const args = body.slice(1).trim().split(/ +/);
                    const commandName = args.shift().toLowerCase();
                    
                    const executed = await this.commandHandler.executeCommand(this.sock, msg, commandName, args);
                    if (!executed) {
                        // Optionnel: rÃ©pondre commande inconnue
                           await safeSendMessage(this.sock, from, {
                               text: ` *${CONFIG.PREFIX}${commandName}* inconnue`
                           });
                    }
                }

            } catch (err) {
                console.error('âŒ Erreur message:', err);
            }
        });
    }

    loadEvents() {
        const eventsDir = path.resolve(process.cwd(), './events');
        if (!fs.existsSync(eventsDir)) {
            console.warn(`âš ï¸ Dossier ${eventsDir} inexistant`);
            return;
        }

        const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const fullPath = path.join(eventsDir, file);
            const event = safeRequire(fullPath);
            
            if (typeof event === 'function') {
                try {
                    event(this.sock);
                    console.log(`âœ… Ã‰vÃ©nement chargÃ©: ${file}`);
                } catch (err) {
                    console.error(`âŒ Erreur Ã©vÃ©nement ${file}:`, err);
                }
            }
        }
    }

    extractMessageBody(msg) {
        return msg.message.conversation ||
               msg.message.extendedTextMessage?.text ||
               msg.message.imageMessage?.caption ||
               msg.message.videoMessage?.caption ||
               '';
    }

    async sendOwnerNotification() {
        setTimeout(async () => {
            await safeSendMessage(this.sock, CONFIG.OWNER_JID, {
                image: { url: 'https://files.catbox.moe/uklx8n.jpg' },
                caption: ` *ZENITSU BOT CONNECTÉ*\n ONLINE\n  ${new Date().toLocaleTimeString()}\n ${this.commandHandler.commands.size} commandes \nPrefix = ${CONFIG.PREFIX} `,
                contextInfo: { 
                    mentionedJid: [CONFIG.OWNER_JID], 
                    forwardingScore: 350, 
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                      newsletterJid: '120363425394543602@newsletter',
                      newsletterName: 'ëª¨ðŸ…’ðŸ…¨ðŸ…‘ðŸ…”ðŸ…¡ðŸ…ðŸ…žðŸ…¥ðŸ… ðŸŒŸ',
                      serverMessageId :195
                    }
                }
            });
        }, 2000);
    }

    scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        
        if (reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = CONFIG.RECONNECT_DELAY * Math.min(reconnectAttempts, 5);
            console.log(`Reconnexion ${reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS} dans ${delay}ms...`);
            
            this.reconnectTimer = setTimeout(() => {
                this.start().catch(err => {
                    console.error('Echec reconnexion:', err);
                    this.scheduleReconnect();
                });
            }, delay);
        } else {
            console.error('Trop de tentatives ARRET');
            process.exit(1);
        }
    }
}

// ==================== DÃ‰MARRAGE ====================
const bot = new ZenitsuBot();

bot.start().catch(err => {
    console.error(' Error : ', err);
    process.exit(1);
});

// ==================== ANTI-CRASH ULTIME ====================
process.on('uncaughtException', (err) => {
    console.error(' UNCAUGHT EXCEPTION:', err.stack || err);
});

process.on('unhandledRejection', (reason) => {
    console.error(' UNHANDLED REJECTION:', reason);
});

// Garder le processus en vie
setInterval(() => {
    if (bot.isConnected) {
        console.log(' Bot actif -', new Date().toLocaleTimeString());
    }
}, 300000);
