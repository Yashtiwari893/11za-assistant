export async function downloadWhatsAppAudio(mediaUrl: string): Promise<Buffer> {
    const res = await fetch(mediaUrl);
    if (!res.ok) {
        throw new Error("Failed to download WhatsApp audio");
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
