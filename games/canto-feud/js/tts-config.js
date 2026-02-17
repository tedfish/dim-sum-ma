/**
 * TTS Configuration
 * 
 * To use High-Quality Neural TTS via secure proxy:
 * 1. Set `useCloudTts` to true.
 * 2. Deploy the Cloudflare Worker with the API key as a secret.
 * 3. The proxy endpoint will handle authentication securely.
 */

export const TTS_CONFIG = {
    useCloudTts: false, // Set to true to enable Cloud Neural TTS
    provider: 'google', // 'google' | 'elevenlabs'
    proxyEndpoint: '/api/tts', // Cloudflare Worker proxy endpoint

    // Google Cloud TTS Settings
    google: {
        voice: 'yue-HK-Standard-A', // Cantonese (Hong Kong) female voice
        languageCode: 'yue-HK' // Cantonese language code
    },

    // ElevenLabs Settings (not yet implemented in proxy)
    elevenlabs: {
        voiceId: '', // You'll need a Cantonese-capable voice ID
        modelId: 'eleven_multilingual_v2'
    }
};
