/**
 * Cloudflare Worker - Secure TTS Proxy
 * 
 * This worker acts as a secure proxy for Google Cloud Text-to-Speech API.
 * The API key is stored as an environment variable and never exposed to the frontend.
 */

export default {
    async fetch(request, env) {
        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        // Only allow POST requests to /api/tts
        const url = new URL(request.url);
        if (url.pathname !== '/api/tts' || request.method !== 'POST') {
            return new Response('Not Found', { status: 404 });
        }

        try {
            // Parse the request body
            const body = await request.json();

            // Validate required fields
            if (!body.text || !body.voice || !body.languageCode) {
                return new Response(
                    JSON.stringify({ error: 'Missing required fields: text, voice, languageCode' }),
                    {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }

            // Get API key from environment
            const apiKey = env.GOOGLE_CLOUD_TTS_API_KEY;
            if (!apiKey) {
                console.error('GOOGLE_CLOUD_TTS_API_KEY not configured');
                return new Response(
                    JSON.stringify({ error: 'TTS service not configured' }),
                    {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }

            // Prepare request to Google Cloud TTS
            const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
            const ttsPayload = {
                input: { text: body.text },
                voice: {
                    languageCode: body.languageCode,
                    name: body.voice
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: body.speakingRate || 1.0,
                    pitch: body.pitch || 0.0
                }
            };

            // Forward request to Google Cloud TTS
            const ttsResponse = await fetch(ttsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(ttsPayload),
            });

            if (!ttsResponse.ok) {
                const errorText = await ttsResponse.text();
                console.error('Google Cloud TTS error:', errorText);
                return new Response(
                    JSON.stringify({ error: 'TTS service error', details: errorText }),
                    {
                        status: ttsResponse.status,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    }
                );
            }

            // Get the response and forward it
            const ttsData = await ttsResponse.json();

            return new Response(JSON.stringify(ttsData), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(
                JSON.stringify({ error: 'Internal server error', message: error.message }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }
    },
};
