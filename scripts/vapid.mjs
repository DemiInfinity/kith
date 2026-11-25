// Prints a fresh VAPID key pair for check-in notifications. Paste them into .env.
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
console.log(`KITH_VAPID_PUBLIC_KEY=${k.publicKey}\nKITH_VAPID_PRIVATE_KEY=${k.privateKey}`);
