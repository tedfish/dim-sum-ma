/**
 * TTS Configuration
 * 
 * To use High-Quality Neural TTS (e.g. Google Cloud):
 * 1. Set `USE_CLOUD_TTS` to true.
 * 2. Provide a valid `API_KEY`.
 * 3. Ensure your backend or proxy handles the request if CORS is an issue.
 */

export const TTS_CONFIG = {
    useCloudTts: false, // Set to true to enable Cloud Neural TTS
    provider: 'google', // 'google' | 'elevenlabs'
    apiKey: 'AIzaSyCVpYmviIWjD71DDXHb74vDS3HpHO7zYss', // Your API Key

    // Google Cloud TTS Settings
    google: {
        voice: 'yue-HK-Standard-A', // Cantonese (Hong Kong) female voice
        languageCode: 'yue-HK' // Cantonese language code
    },

    // ElevenLabs Settings
    elevenlabs: {
        voiceId: '', // You'll need a Cantonese-capable voice ID
        modelId: 'eleven_multilingual_v2'
    }
};
