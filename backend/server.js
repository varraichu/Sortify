const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;

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
        
        async function fetchLastFmData(artist, track) {
            try {
                const encodedArtist = encodeURIComponent(artist);
                const encodedTrack = encodeURIComponent(track);
                const url = `http://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${LASTFM_API_KEY}&artist=${encodedArtist}&track=${encodedTrack}&format=json`;
                
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.track) {
                    return {
                        duration: data.track.duration || null,
                        listeners: data.track.listeners || null,
                        playcount: data.track.playcount || null,
                        tags: data.track.toptags?.tag?.map(tag => tag.name) || [],
                        lastfm_url: data.track.url || null,
                        wiki_summary: data.track.wiki?.summary || null
                    };
                }
                return null;
            } catch (error) {
                console.error(`Last.fm API error for ${artist} - ${track}:`, error.message);
                return null;
            }
        }
        
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
        
        async function enhanceSongsWithLastFm(songs) {
            console.log(`Enhancing ${songs.length} songs with Last.fm data...`);
            const enhancedSongs = [];
            
            // Process songs in batches to avoid overwhelming the API
            const batchSize = 5;
            for (let i = 0; i < songs.length; i += batchSize) {
                const batch = songs.slice(i, i + batchSize);
                
                const batchPromises = batch.map(async (item) => {
                    const artistName = item.track.artists[0]?.name || '';
                    const trackName = item.track.name || '';
                    
                    console.log(`Fetching Last.fm data for: ${artistName} - ${trackName}`);
                    
                    // Fetch Last.fm data
                    const lastfmData = await fetchLastFmData(artistName, trackName);
                    
                    // Merge Spotify and Last.fm data
                    return {
                        // Original Spotify data
                        spotify: {
                            added_at: item.added_at,
                            track: {
                                id: item.track.id,
                                name: item.track.name,
                                artists: item.track.artists,
                                album: item.track.album,
                                duration_ms: item.track.duration_ms,
                                external_urls: item.track.external_urls,
                                popularity: item.track.popularity,
                                preview_url: item.track.preview_url
                            }
                        },
                        // Enhanced Last.fm data
                        lastfm: lastfmData || {
                            duration: null,
                            listeners: null,
                            playcount: null,
                            tags: [],
                            lastfm_url: null,
                            wiki_summary: null
                        },
                        // Combined metadata for easy access
                        metadata: {
                            artist: artistName,
                            track: trackName,
                            added_to_spotify: item.added_at,
                            spotify_duration_ms: item.track.duration_ms,
                            lastfm_duration_ms: lastfmData?.duration ? parseInt(lastfmData.duration) : null,
                            genres: lastfmData?.tags || [],
                            popularity_score: item.track.popularity,
                            listen_count: lastfmData?.playcount || null,
                            listener_count: lastfmData?.listeners || null
                        }
                    };
                });
                
                const batchResults = await Promise.all(batchPromises);
                enhancedSongs.push(...batchResults);
                
                // Add a small delay between batches to be nice to Last.fm API
                if (i + batchSize < songs.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                console.log(`Processed ${Math.min(i + batchSize, songs.length)}/${songs.length} songs`);
            }
            
            return enhancedSongs;
        }
        
        console.log("Starting to fetch all liked songs...");
        const spotifySongs = await fetchAllLikedSongs();
        console.log(`Fetched ${spotifySongs.length} songs from Spotify`);
        
        console.log("Enhancing songs with Last.fm data...");
        const enhancedSongs = await enhanceSongsWithLastFm(spotifySongs);
        
        console.log(`Successfully enhanced ${enhancedSongs.length} songs`);
        
        // Return enhanced data with statistics
        const stats = {
            total_songs: enhancedSongs.length,
            songs_with_lastfm_data: enhancedSongs.filter(s => s.lastfm.duration !== null).length,
            unique_genres: [...new Set(enhancedSongs.flatMap(s => s.lastfm.tags))],
            avg_popularity: Math.round(
                enhancedSongs.reduce((sum, s) => sum + (s.spotify.track.popularity || 0), 0) / enhancedSongs.length
            )
        };
        
        res.json({
            stats,
            songs: enhancedSongs
        });
        
    } catch (error) {
        console.error("Error fetching and enhancing liked songs:", error);
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
