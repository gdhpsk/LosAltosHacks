const crypto = require('crypto');
const fs = require('fs');

// Generate RSA Key Pair
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096, // Size of the key in bits (2048 bits is recommended)
    publicKeyEncoding: {
        type: 'pkcs1',     // The public key format
        format: 'pem',     // Encoding format for the key
    },
    privateKeyEncoding: {
        type: 'pkcs1',     // The private key format
        format: 'pem',     // Encoding format for the key
        cipher: 'aes-256-cbc',  // Optional: encrypt the private key with a password (if desired)
        passphrase: process.env.passphrase // Optional: Password for encrypting private key
    }
});

// Save the keys to files
fs.writeFileSync('./keys/public.pem', publicKey);
fs.writeFileSync('./keys/private.pem', privateKey);

console.log('RSA Key Pair Generated!');