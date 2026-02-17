# Setup Instructions

## API Key Security Setup

This project uses a Cloudflare Worker to securely proxy Google Cloud Text-to-Speech API requests, keeping your API key safe and never exposed in the frontend code.

## Prerequisites

- A Google Cloud account with Text-to-Speech API enabled
- Cloudflare account (free tier works)
- `wrangler` CLI installed (`npm install -g wrangler`)

## Step 1: Get Your Google Cloud TTS API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Cloud Text-to-Speech API**
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > API Key**
6. Copy your API key
7. **Important**: Click on your API key to configure restrictions:
   - Under "Application restrictions", select "HTTP referrers"
   - Add your domain (e.g., `*.yourdomain.com/*`)
   - Under "API restrictions", select "Restrict key" and choose "Cloud Text-to-Speech API"

## Step 2: Configure the Cloudflare Worker Secret

1. Login to Cloudflare via wrangler:
   ```bash
   npx wrangler login
   ```

2. Set your API key as a secret (this keeps it secure and never exposes it in code):
   ```bash
   npx wrangler secret put GOOGLE_CLOUD_TTS_API_KEY
   ```
   
3. When prompted, paste your Google Cloud API key

## Step 3: Deploy the Worker

Deploy the Cloudflare Worker:

```bash
npx wrangler deploy
```

The worker will be deployed and available at your Cloudflare Workers domain.

## Step 4: Enable Cloud TTS in the Game

1. Open `games/canto-feud/js/tts-config.js`
2. Set `useCloudTts: true`

```javascript
export const TTS_CONFIG = {
    useCloudTts: true, // Enable Cloud TTS
    // ... rest of config
};
```

## Step 5: Test

1. Open your game in a browser
2. Try the TTS functionality
3. Check the browser console for any errors
4. Verify that the API key is NOT visible in the Network tab

## Local Development

For local testing, you can run the worker locally:

```bash
npx wrangler dev
```

This will start a local development server. Update the `proxyEndpoint` in `tts-config.js` to point to your local server (e.g., `http://localhost:8787/api/tts`).

## Security Notes

- ✅ The API key is stored as a Cloudflare Worker secret
- ✅ The API key is never exposed in frontend code
- ✅ The API key is never committed to version control
- ✅ The worker validates requests before forwarding to Google Cloud
- ⚠️ Remember to rotate the old API key that was previously exposed
- ⚠️ Set up HTTP referrer restrictions on your Google Cloud API key

## Troubleshooting

### TTS not working
- Check browser console for errors
- Verify the worker is deployed: `npx wrangler deployments list`
- Check worker logs: `npx wrangler tail`

### CORS errors
- The worker includes CORS headers, but verify your domain is allowed
- Check that the worker is deployed to the same domain as your site

### API quota exceeded
- Check your Google Cloud Console for quota limits
- Consider implementing rate limiting in the worker if needed
