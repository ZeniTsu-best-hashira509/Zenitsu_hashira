const QRCode = require('qrcode');

module.exports = {
    name: "qrcode",
    description: "Transforme un texte en QR Code",
    priority: 0, // normale
    async execute(client, msg, args) {
        const from = msg.key.remoteJid;

        // VÃ©rifier que du texte est fourni
        if (!args.length) {
            return client.sendMessage(from, { text: 'Veuillez fournir un texte pour générer le QR code.' }, { quoted: msg });
        }

        const text = args.join(' ');

        try {
            // GÃ©nÃ©rer le QR code en image buffer
            const qrBuffer = await QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'H', width: 300 });

            // Envoyer l'image en rÃ©ponse
            await client.sendMessage(from, {
                image: qrBuffer,
                caption: `Voici votre QR code pour :\n${text}`
            }, { quoted: msg });
        } catch (err) {
            console.log('Erreur génération QR code:', err);
            await client.sendMessage(from, { text: 'Impossible' }, { quoted: msg });
        }
    }
};
