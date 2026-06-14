// ============================================
// Fichier : ~/zenitsu_wa_001/commands/ping.js
// Commande : Ping avec Ã©volution en 3 phases
// ============================================

module.exports = {
    name: 'ping2',
    description: 'VÃ©rifie la vitesse de rÃ©ponse du bot',
    aliases: ['pong', 'speed', 'vitesse', 'latence'],
    
    async execute(sock, msg, args) {
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const senderName = sender.split('@')[0];
        
        try {
            // ============================================
            // PHASE 1 : RÃ‰ACTION + DÃ‰BUT DU TEST
            // ============================================
            
            // RÃ©action emoji
            await sock.sendMessage(from, { react: { text: 'ðŸ“', key: msg.key } });
            
            // Message initial
            const initialMsg = await sock.sendMessage(from, {
                text: `ðŸ“ *PING TEST INITIÃ‰...*\n\n` +
                      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                      `ðŸ“¡ *Connexion :* Test en cours...\n` +
                      `â±ï¸ *Latence :* Calcul...\n` +
                      `ðŸ” *Statut :* VÃ©rification...\n` +
                      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n` +
                      `âš¡ _Analyse du rÃ©seau en cours..._`
            }, { quoted: msg });
            
            // Petite pause pour l'effet visuel
            await delay(800);
            
            
            // ============================================
            // PHASE 2 : AFFICHAGE DE LA VITESSE
            // ============================================
            
            const startTime = Date.now();
            
            // Mesurer le temps de rÃ©ponse rÃ©el
            const testMsg = await sock.sendMessage(from, {
                text: 'ðŸ” .'
            });
            
            const pingTime = Date.now() - startTime;
            
            // DÃ©terminer le statut et l'emoji
            let statusEmoji, statusText, statusColor;
            
            if (pingTime < 100) {
                statusEmoji = 'ðŸŸ¢';
                statusText = 'EXCELLENT';
                statusColor = '#2ecc71'; // Vert
            } else if (pingTime < 300) {
                statusEmoji = 'ðŸŸ¡';
                statusText = 'BON';
                statusColor = '#f1c40f'; // Jaune
            } else if (pingTime < 500) {
                statusEmoji = 'ðŸŸ ';
                statusText = 'MOYEN';
                statusColor = '#e67e22'; // Orange
            } else {
                statusEmoji = 'ðŸ”´';
                statusText = 'LENT';
                statusColor = '#e74c3c'; // Rouge
            }
            
            // Barre de progression visuelle
            const barLength = 20;
            const filledBars = Math.min(Math.floor(pingTime / 25), barLength);
            const emptyBars = barLength - filledBars;
            const progressBar = 'â–^'.repeat(filledBars) + 'â–‘'.repeat(emptyBars);
            
            // Message de phase 2
            await sock.sendMessage(from, {
                text: `ðŸ“ *RÃ‰SULTAT DU PING*\n\n` +
                      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                      `${statusEmoji} *Latence :* ${pingTime}ms\n` +
                      `ðŸ“Š *Statut :* ${statusText}\n` +
                      `ðŸ“¡ *Barre :* [${progressBar}]\n` +
                      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n` +
                      `_VÃ©rification du systÃ¨me en cours..._`
            }, { edit: testMsg.key }); // âœ… Modification du message prÃ©cÃ©dent
            
            // Supprimer le message initial
            try { await sock.sendMessage(from, { delete: initialMsg.key }); } catch (e) {}
            
            // Petite pause
            await delay(1000);
            
            
            // ============================================
            // PHASE 3 : STATUS COMPLET DU BOT
            // ============================================
            
            // Collecter les informations systÃ¨me
            const uptime = Math.floor((Date.now() - global.startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = uptime % 60;
            
            const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const memoryTotal = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2);
            const memoryPercent = ((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100).toFixed(1);
            
            // VÃ©rifier les dossiers importants
            const fs = require('fs');
            const sessionsExist = fs.existsSync('./session') || fs.existsSync('./session-web');
            const commandsExist = fs.existsSync('./commands') && fs.readdirSync('./commands').length > 0;
            const tempExist = fs.existsSync('./temp');
            
            // Tests systÃ¨me
            const tests = [
                { name: 'Session WhatsApp', status: sessionsExist, icon: sessionsExist ? 'âœ…' : 'âŒ' },
                { name: 'Commandes chargÃ©es', status: commandsExist, icon: commandsExist ? 'âœ…' : 'âŒ' },
                { name: 'Dossier temporaire', status: tempExist, icon: tempExist ? 'âœ…' : 'âš ï¸' },
                { name: 'Connexion rÃ©seau', status: pingTime < 1000, icon: pingTime < 1000 ? 'âœ…' : 'âŒ' },
                { name: 'MÃ©moire disponible', status: memoryPercent < 80, icon: memoryPercent < 80 ? 'âœ…' : 'âš ï¸' }
            ];
            
            const allTestsPassed = tests.every(t => t.status);
            
            // Message final
            const finalText = `ðŸ“ *PING COMPLET*\n\n` +
                            `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                            `ðŸ“¡ *RÃ©seau*\n` +
                            `${statusEmoji} Latence : ${pingTime}ms\n` +
                            `ðŸ“Š Statut : ${statusText}\n` +
                            `ðŸ“¶ Barre : [${progressBar}]\n\n` +
                            `â±ï¸ *Uptime*\n` +
                            `${hours}h ${minutes}m ${seconds}s\n\n` +
                            `ðŸ’¾ *MÃ©moire*\n` +
                            `UtilisÃ© : ${memoryUsed} MB / ${memoryTotal} MB\n` +
                            `Pourcentage : ${memoryPercent}%\n\n` +
                            `ðŸ” *Tests SystÃ¨me*\n` +
                            tests.map(t => `${t.icon} ${t.name}`).join('\n') +
                            `\n\n` +
                            `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                            `${allTestsPassed ? 'âœ… Tous les systÃ¨mes sont OK' : 'âš ï¸ Certains tests ont Ã©chouÃ©'}\n` +
                            `ðŸ‘¤ DemandÃ© par : @${senderName}\n` +
                            `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`;
            
            // Modifier le message final
            await sock.sendMessage(from, {
                text: finalText,
                contextInfo: { mentionedJid: [sender] }
            }, { edit: testMsg.key });
            
            // RÃ©action finale
            const finalReaction = pingTime < 100 ? '⚡' : 
                                  pingTime < 500 ? '⚡' : '⚡';
            await sock.sendMessage(from, { react: { text: finalReaction, key: msg.key } });
            
            // Log
            console.log(`PING : ${pingTime}ms | ${statusText} | DemandÃ© par ${senderName}`);
            
        } catch (error) {
            console.error(' Erreur ping:', error);
            
            try {
                await sock.sendMessage(from, { react: { text: '⚡', key: msg.key } });
            } catch (e) {}
            
            await sock.sendMessage(from, {
                text: `*Erreur lors du test*\n\n${error.message}`
            }, { quoted: msg });
        }
    }
};

// Fonction delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
