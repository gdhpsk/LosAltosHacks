const fs = require("fs/promises")
const crypto = require("node:crypto")

module.exports = {
    async encryptData(data) {
        const publicKey = await fs.readFile("./keys/public.pem", "utf8")
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256',
            },
            Buffer.from(data)
        );
        return encrypted.toString('base64'); // returning base64 encoded string for easier handling
    },

    // Function to decrypt data using the private key
    async decryptData(encryptedData) {
        const privateKey = await fs.readFile("./keys/private.pem", "utf8")
        const decrypted = crypto.privateDecrypt(
            {
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                passphrase: process.env.passphrase,
                oaepHash: 'sha256',
            },
            Buffer.from(encryptedData, 'base64') // Convert back from base64
        );
        return decrypted.toString('utf8'); // returning decrypted data as string
    }
}