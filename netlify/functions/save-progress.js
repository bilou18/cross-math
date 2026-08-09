// netlify/functions/save-progress.js
//
// Saves a player's Pi-purchased entitlements (unlocked levels/themes/
// toggles, Genius Pass), keyed by their Pi Network user ID. The UID is
// never trusted from the client directly — it's derived by verifying the
// player's accessToken against Pi's own /v2/me endpoint first, so a
// player can't spoof someone else's UID and overwrite their purchases.
//
// Progress is MERGED with whatever is already saved (union of both lists)
// rather than overwritten, so a stale/offline client can never accidentally
// erase an unlock the player already paid for.
const axios = require('axios');
const { getStore } = require('@netlify/blobs');

// Netlify is supposed to auto-inject site ID + token for Blobs at runtime,
// but on some deploys that auto-configuration doesn't arrive (a known
// Netlify Blobs issue). BLOBS_SITE_ID and BLOBS_TOKEN are optional manual
// overrides — set them in Site settings → Environment variables only if
// you see "MissingBlobsEnvironmentError" after a clear-cache redeploy.
function getBlobStore(name) {
    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (siteID && token) {
        return getStore({ name, siteID, token });
    }
    return getStore(name);
}

const DEFAULT_PROGRESS = {
    unlockedLevels: [],
    unlockedThemes: [],
    unlockedToggles: [],
    passExpiresAt: null
};

exports.handler = async (event) => {
    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
        }

        const body = JSON.parse(event.body);
        const accessToken = body.accessToken;
        const incomingProgress = body.progress;

        if (!accessToken || !incomingProgress) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing accessToken or progress' }) };
        }

        let uid;
        try {
            const meResponse = await axios.get('https://api.minepi.com/v2/me', {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 10000
            });
            uid = meResponse.data && meResponse.data.uid;
        } catch (verifyError) {
            console.error('Pi token verification failed:', verifyError.response ? verifyError.response.data : verifyError.message);
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired Pi access token' }) };
        }

        if (!uid) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Could not verify Pi user' }) };
        }

        const store = getBlobStore('player-progress');
        const existingProgress = (await store.get(uid, { type: 'json' })) || DEFAULT_PROGRESS;

        // Union merge: a level/theme/toggle unlocked either before or now
        // stays unlocked. For the Genius Pass, keep whichever expiry is
        // further in the future — a renewal extends it, and a stale/older
        // client can never accidentally shorten or erase it.
        const mergedProgress = {
            unlockedLevels: Array.from(new Set([
                ...(existingProgress.unlockedLevels || []),
                ...(incomingProgress.unlockedLevels || [])
            ])),
            unlockedThemes: Array.from(new Set([
                ...(existingProgress.unlockedThemes || []),
                ...(incomingProgress.unlockedThemes || [])
            ])),
            unlockedToggles: Array.from(new Set([
                ...(existingProgress.unlockedToggles || []),
                ...(incomingProgress.unlockedToggles || [])
            ])),
            passExpiresAt: Math.max(
                Number(existingProgress.passExpiresAt) || 0,
                Number(incomingProgress.passExpiresAt) || 0
            ) || null
        };

        await store.setJSON(uid, mergedProgress);

        return { statusCode: 200, body: JSON.stringify(mergedProgress) };
    } catch (error) {
        console.error('save-progress error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save progress' }) };
    }
};
