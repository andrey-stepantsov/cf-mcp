export async function generateKeyFromString(plainTextKey: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(plainTextKey);
    // Hash to ensure it's exactly 256 bits (32 bytes)
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
    
    return await crypto.subtle.importKey(
        'raw', 
        hashBuffer, 
        { name: 'AES-GCM' }, 
        false, 
        ['encrypt', 'decrypt']
    );
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export async function encryptText(text: string, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoder.encode(text)
    );
    
    const encryptedBase64 = arrayBufferToBase64(encryptedBuffer);
    const ivBase64 = arrayBufferToBase64(iv.buffer);
    
    return `${ivBase64}:${encryptedBase64}`;
}

export async function decryptText(encryptedPayload: string, key: CryptoKey): Promise<string> {
    const [ivBase64, encryptedBase64] = encryptedPayload.split(':');
    if (!ivBase64 || !encryptedBase64) {
        throw new Error("Invalid encrypted payload format. Expected IV:Ciphertext.");
    }
    
    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
    const encryptedBuffer = base64ToArrayBuffer(encryptedBase64);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encryptedBuffer
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
}
