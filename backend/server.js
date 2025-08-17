const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: "http://127.0.0.1:5173", // or "http://localhost:5173"
    methods: ["GET", "POST"],
    credentials: true
}));
app.use(express.json());

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.randomBytes(length))
        .map(x => possible[x % possible.length])
        .join('');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest();
}

function base64encode(buffer) {
    return buffer
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

app.get("/auth", (req, res) => {
    const clientId = process.env.CLIENT_ID;
    const redirectUri = "http://127.0.0.1:5173/callback";

    const codeVerifier = generateRandomString(64);
    const codeChallenge = base64encode(sha256(codeVerifier));

    // save verifier in localStorage on client (frontend)
    res.json({
        authUrl: `https://accounts.spotify.com/authorize?` + new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            scope: "user-read-private user-read-email user-library-read",
            code_challenge_method: "S256",
            code_challenge: codeChallenge,
            redirect_uri: redirectUri,
        }).toString(),
        codeVerifier
    });
});

app.post("/get-token", async (req, res) => {
    try {
        const { code, code_verifier } = req.body;

        const params = new URLSearchParams();
        params.append("client_id", process.env.CLIENT_ID);
        params.append("grant_type", "authorization_code");
        params.append("code", code);
        params.append("redirect_uri", "http://127.0.0.1:5173/callback"); // must match the one you used before
        params.append("code_verifier", code_verifier);

        const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const data = await tokenRes.json();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Token exchange failed" });
    }
});

app.post("/get-liked", async (req, res) => {
    try {
        const { accessToken } = req.body;

        async function fetchAllLikedSongs(url = "https://api.spotify.com/v1/me/tracks?limit=50") {
            const result = await fetch(url, {
                method: "GET",
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            const data = await result.json();

            // Start with current batch of songs
            let allSongs = [...data.items];

            // If there's a next page, recursively fetch it
            if (data.next) {
                console.log(`Fetching next page: ${data.next}`);
                const nextPageSongs = await fetchAllLikedSongs(data.next);
                allSongs = [...allSongs, ...nextPageSongs];
            }

            return allSongs;
        }

        console.log("Starting to fetch all liked songs...");
        const allLikedSongs = await fetchAllLikedSongs();

        console.log(`Fetched ${allLikedSongs.length} total liked songs`);

        // Return all songs with metadata
        res.json({
            total: allLikedSongs.length,
            songs: allLikedSongs
        });

    } catch (error) {
        console.error("Error fetching liked songs:", error);
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
