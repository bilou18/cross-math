// netlify/functions/get-leaderboard.js
//
// Returns the top 50 players by best score (win streak as tiebreaker).
// This is a public read — no Pi auth needed, since anyone should be able
// to view the leaderboard even before setting a name.
//
// Reads the single pre-computed "top 50" blob kept up to date by
// submit-score.js on every score submission, instead of scanning every
// stored player on every page view. Falls back to one full scan if that
// blob doesn't exist yet (e.g. right after first deploy).
const { getStore } = require('@netlify/blobs');

const LEADERBOARD_TOP_KEY = '__leaderboard_top50__';
const MAX_ENTRIES_SCANNED = 1000; // safety cap while listing blob keys (fallback path only)
const TOP_N = 50;

// See save-progress.js for why this manual-override helper exists.
function getBlobStore(name) {
    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (siteID && token) {
        return getStore({ name, siteID, token });
    }
    return getStore(name);
}

async function buildTopFromFullScan(store) {
    let allKeys = [];
    let cursor;
    do {
        const page = await store.list({ cursor });
        allKeys = allKeys.concat(page.blobs.map((b) => b.key));
        cursor = page.cursor;
    } while (cursor && allKeys.length < MAX_ENTRIES_SCANNED);

    const entries = await Promise.all(
        allKeys
            .filter((key) => key !== LEADERBOARD_TOP_KEY)
            .map(async (key) => {
                try {
                    return await store.get(key, { type: 'json' });
                } catch (e) {
                    return null;
                }
            })
    );

    return entries
        .filter((e) => e && typeof e.bestScore === 'number')
        .sort((a, b) => {
            if ((b.bestScore || 0) !== (a.bestScore || 0)) return (b.bestScore || 0) - (a.bestScore || 0);
            return (b.bestStreak || 0) - (a.bestStreak || 0);
        })
        .slice(0, TOP_N);
}

exports.handler = async () => {
    try {
        const store = getBlobStore('leaderboard');

        let top = await store.get(LEADERBOARD_TOP_KEY, { type: 'json' });

        if (!Array.isArray(top)) {
            top = await buildTopFromFullScan(store);
            try {
                await store.setJSON(LEADERBOARD_TOP_KEY, top);
            } catch (e) {
                console.error('get-leaderboard: failed to save fallback-built top50:', e.message);
            }
        }

        const leaderboard = top.map((e) => ({
            id: e.id,
            name: e.name || 'Guest',
            bestScore: e.bestScore || 0,
            puzzlesSolved: e.puzzlesSolved || 0,
            puzzlesLost: e.puzzlesLost || 0,
            bestStreak: e.bestStreak || 0
        }));

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leaderboard })
        };
    } catch (error) {
        console.error('get-leaderboard error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load leaderboard' }) };
    }
};
