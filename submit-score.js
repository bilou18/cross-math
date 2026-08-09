// netlify/functions/submit-score.js
//
// Stores one player's leaderboard entry (keyed by their local player id —
// see loadIdentity()/saveIdentity() in script.js) and keeps a pre-computed
// "top 50" blob up to date, so get-leaderboard.js can serve reads cheaply
// without scanning every player on every page view.
//
// This mirrors the shared, "visible to everyone" leaderboard the game
// previously simulated with window.storage(..., shared:true) — now backed
// by a real store so it actually works once deployed standalone.
const { getStore } = require('@netlify/blobs');

const LEADERBOARD_TOP_KEY = '__leaderboard_top50__';
const TOP_N = 50;
const MAX_NAME_LENGTH = 40;

// See save-progress.js for why this manual-override helper exists.
function getBlobStore(name) {
    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (siteID && token) {
        return getStore({ name, siteID, token });
    }
    return getStore(name);
}

function rankEntries(entries) {
    return entries
        .filter((e) => e && typeof e.bestScore === 'number')
        .sort((a, b) => {
            if ((b.bestScore || 0) !== (a.bestScore || 0)) return (b.bestScore || 0) - (a.bestScore || 0);
            return (b.bestStreak || 0) - (a.bestStreak || 0);
        })
        .slice(0, TOP_N);
}

exports.handler = async (event) => {
    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
        }

        const body = JSON.parse(event.body);
        const { id, name, bestScore, puzzlesSolved, puzzlesLost, bestStreak } = body;

        if (!id || typeof bestScore !== 'number') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing id or bestScore' }) };
        }

        const entry = {
            id: String(id).slice(0, 64),
            name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, MAX_NAME_LENGTH) : 'Guest',
            bestScore: Number(bestScore) || 0,
            puzzlesSolved: Number(puzzlesSolved) || 0,
            puzzlesLost: Number(puzzlesLost) || 0,
            bestStreak: Number(bestStreak) || 0,
            updatedAt: Date.now()
        };

        const store = getBlobStore('leaderboard');
        await store.setJSON(entry.id, entry);

        // Refresh the pre-computed top-50 so get-leaderboard.js stays cheap.
        let top = await store.get(LEADERBOARD_TOP_KEY, { type: 'json' });
        if (!Array.isArray(top)) top = [];
        const withoutThisPlayer = top.filter((e) => e.id !== entry.id);
        const merged = rankEntries([...withoutThisPlayer, entry]);
        await store.setJSON(LEADERBOARD_TOP_KEY, merged);

        return { statusCode: 200, body: JSON.stringify({ message: 'Score submitted' }) };
    } catch (error) {
        console.error('submit-score error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to submit score' }) };
    }
};
