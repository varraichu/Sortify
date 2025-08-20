const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();
const GPTGenreService = require('./gptGenreService');

const app = express();
const PORT = process.env.PORT || 3000;
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const gptService = new GPTGenreService();

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
                                external_ids: item.track.external_ids, // Preserving ISRC and other external IDs
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
                            listener_count: lastfmData?.listeners || null,
                            isrc: item.track.external_ids?.isrc || null, // Easy access to ISRC
                            spotify_id: item.track.id
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

// Add this new endpoint to your existing backend code

app.post("/get-liked-musicbrainz", async (req, res) => {
    try {
        const { accessToken } = req.body;
        
        async function fetchMusicBrainzData(isrc) {
            try {
                if (!isrc) return null;
                
                const url = `https://musicbrainz.org/ws/2/recording/?query=isrc:${isrc}&fmt=json`;
                
                // Add delay to respect MusicBrainz rate limiting (1 request per second)
                await new Promise(resolve => setTimeout(resolve, 1100));
                
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'YourAppName/1.0 (your-email@example.com)' // MusicBrainz requires User-Agent
                    }
                });
                
                if (!response.ok) {
                    console.error(`MusicBrainz API error: ${response.status} for ISRC: ${isrc}`);
                    return null;
                }
                
                const data = await response.json();
                
                if (data.recordings && data.recordings.length > 0) {
                    const recording = data.recordings[0]; // Take the first match
                    
                    return {
                        musicbrainz_id: recording.id,
                        title: recording.title,
                        length: recording.length || null,
                        disambiguation: recording.disambiguation || null,
                        first_release_date: recording['first-release-date'] || null,
                        tags: recording.tags ? recording.tags.map(tag => ({
                            name: tag.name,
                            count: tag.count
                        })) : [],
                        artist_credit: recording['artist-credit'] || [],
                        score: recording.score || null
                    };
                }
                return null;
            } catch (error) {
                console.error(`MusicBrainz API error for ISRC ${isrc}:`, error.message);
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
        
        async function enhanceSongsWithMusicBrainz(songs) {
            console.log(`Enhancing ${songs.length} songs with MusicBrainz data...`);
            const enhancedSongs = [];
            
            // Process songs sequentially to respect MusicBrainz rate limiting (1 req/sec)
            for (let i = 0; i < songs.length; i++) {
                const item = songs[i];
                const artistName = item.track.artists[0]?.name || '';
                const trackName = item.track.name || '';
                const isrc = item.track.external_ids?.isrc;
                
                console.log(`Processing ${i + 1}/${songs.length}: ${artistName} - ${trackName} (ISRC: ${isrc || 'N/A'})`);
                
                // Fetch MusicBrainz data using ISRC
                const musicbrainzData = await fetchMusicBrainzData(isrc);
                
                // Merge Spotify and MusicBrainz data
                const enhancedSong = {
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
                            external_ids: item.track.external_ids,
                            popularity: item.track.popularity,
                            preview_url: item.track.preview_url
                        }
                    },
                    // Enhanced MusicBrainz data
                    musicbrainz: musicbrainzData || {
                        musicbrainz_id: null,
                        title: null,
                        length: null,
                        disambiguation: null,
                        first_release_date: null,
                        tags: [],
                        artist_credit: [],
                        score: null
                    },
                    // Combined metadata for easy access
                    metadata: {
                        artist: artistName,
                        track: trackName,
                        added_to_spotify: item.added_at,
                        spotify_duration_ms: item.track.duration_ms,
                        musicbrainz_duration_ms: musicbrainzData?.length || null,
                        genres: musicbrainzData?.tags?.map(tag => tag.name) || [],
                        popularity_score: item.track.popularity,
                        isrc: isrc,
                        spotify_id: item.track.id,
                        musicbrainz_id: musicbrainzData?.musicbrainz_id || null,
                        first_release_date: musicbrainzData?.first_release_date || null,
                        disambiguation: musicbrainzData?.disambiguation || null
                    }
                };
                
                enhancedSongs.push(enhancedSong);
            }
            
            return enhancedSongs;
        }
        
        console.log("Starting to fetch all liked songs...");
        const spotifySongs = await fetchAllLikedSongs();
        console.log(`Fetched ${spotifySongs.length} songs from Spotify`);
        
        // Filter songs that have ISRC codes
        const songsWithIsrc = spotifySongs.filter(song => song.track.external_ids?.isrc);
        const songsWithoutIsrc = spotifySongs.filter(song => !song.track.external_ids?.isrc);
        
        console.log(`${songsWithIsrc.length} songs have ISRC codes, ${songsWithoutIsrc.length} don't`);
        console.log("Enhancing songs with MusicBrainz data...");
        
        // Only enhance songs that have ISRC codes
        const enhancedSongsWithIsrc = await enhanceSongsWithMusicBrainz(songsWithIsrc);
        
        // Add songs without ISRC as basic entries
        const enhancedSongsWithoutIsrc = songsWithoutIsrc.map(item => ({
            spotify: {
                added_at: item.added_at,
                track: {
                    id: item.track.id,
                    name: item.track.name,
                    artists: item.track.artists,
                    album: item.track.album,
                    duration_ms: item.track.duration_ms,
                    external_urls: item.track.external_urls,
                    external_ids: item.track.external_ids || {},
                    popularity: item.track.popularity,
                    preview_url: item.track.preview_url
                }
            },
            musicbrainz: {
                musicbrainz_id: null,
                title: null,
                length: null,
                disambiguation: null,
                first_release_date: null,
                tags: [],
                artist_credit: [],
                score: null
            },
            metadata: {
                artist: item.track.artists[0]?.name || '',
                track: item.track.name || '',
                added_to_spotify: item.added_at,
                spotify_duration_ms: item.track.duration_ms,
                musicbrainz_duration_ms: null,
                genres: [],
                popularity_score: item.track.popularity,
                isrc: null,
                spotify_id: item.track.id,
                musicbrainz_id: null,
                first_release_date: null,
                disambiguation: null
            }
        }));
        
        // Combine all songs
        const allEnhancedSongs = [...enhancedSongsWithIsrc, ...enhancedSongsWithoutIsrc];
        
        console.log(`Successfully enhanced ${allEnhancedSongs.length} songs`);
        
        // Return enhanced data with statistics
        const stats = {
            total_songs: allEnhancedSongs.length,
            songs_with_isrc: songsWithIsrc.length,
            songs_with_musicbrainz_data: enhancedSongsWithIsrc.filter(s => s.musicbrainz.musicbrainz_id !== null).length,
            unique_genres: [...new Set(allEnhancedSongs.flatMap(s => s.metadata.genres))],
            avg_popularity: Math.round(
                allEnhancedSongs.reduce((sum, s) => sum + (s.spotify.track.popularity || 0), 0) / allEnhancedSongs.length
            ),
            songs_without_isrc: songsWithoutIsrc.length
        };
        
        res.json({
            stats,
            songs: allEnhancedSongs
        });
        
    } catch (error) {
        console.error("Error fetching and enhancing liked songs with MusicBrainz:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/get-liked-hybrid", async (req, res) => {
    try {
        const { accessToken } = req.body;
        
        async function fetchMusicBrainzData(isrc) {
            try {
                if (!isrc) return null;
                
                const url = `https://musicbrainz.org/ws/2/recording/?query=isrc:${isrc}&fmt=json`;
                
                // Add delay to respect MusicBrainz rate limiting (1 request per second)
                await new Promise(resolve => setTimeout(resolve, 1100));
                
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'SpotifyAnalyzer/1.0 (your-email@example.com)' // Update with your info
                    }
                });
                
                if (!response.ok) {
                    console.error(`MusicBrainz API error: ${response.status} for ISRC: ${isrc}`);
                    return null;
                }
                
                const data = await response.json();
                
                if (data.recordings && data.recordings.length > 0) {
                    const recording = data.recordings[0];
                    
                    return {
                        musicbrainz_id: recording.id,
                        title: recording.title,
                        length: recording.length || null,
                        disambiguation: recording.disambiguation || null,
                        first_release_date: recording['first-release-date'] || null,
                        tags: recording.tags ? recording.tags.map(tag => tag.name) : [],
                        artist_credit: recording['artist-credit'] || [],
                        score: recording.score || null
                    };
                }
                return null;
            } catch (error) {
                console.error(`MusicBrainz API error for ISRC ${isrc}:`, error.message);
                return null;
            }
        }
        
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
            
            let allSongs = [...data.items];
            
            if (data.next) {
                console.log(`Fetching next page: ${data.next}`);
                const nextPageSongs = await fetchAllLikedSongs(data.next);
                allSongs = [...allSongs, ...nextPageSongs];
            }
            
            return allSongs;
        }
        
        async function enhanceSongsHybrid(songs) {
            console.log(`Enhancing ${songs.length} songs with HYBRID MusicBrainz + Last.fm data...`);
            const enhancedSongs = [];
            
            // Process in batches for Last.fm, but sequentially for MusicBrainz due to rate limits
            for (let i = 0; i < songs.length; i++) {
                const item = songs[i];
                const artistName = item.track.artists[0]?.name || '';
                const trackName = item.track.name || '';
                const isrc = item.track.external_ids?.isrc;
                
                console.log(`Processing ${i + 1}/${songs.length}: ${artistName} - ${trackName}`);
                
                // Fetch from BOTH sources simultaneously (except MusicBrainz needs rate limiting)
                const promises = [
                    fetchLastFmData(artistName, trackName),
                    fetchMusicBrainzData(isrc) // This has built-in rate limiting
                ];
                
                const [lastfmData, musicbrainzData] = await Promise.all(promises);
                
                // Combine tags from both sources, removing duplicates
                const musicbrainzTags = musicbrainzData?.tags || [];
                const lastfmTags = lastfmData?.tags || [];
                const combinedTags = [...new Set([...musicbrainzTags, ...lastfmTags])];
                
                // Determine primary data source for each field
                const hybridData = {
                    // Genre tags: Combine both sources (MusicBrainz often more accurate, Last.fm more comprehensive)
                    genres: combinedTags,
                    musicbrainz_genres: musicbrainzTags,
                    lastfm_genres: lastfmTags,
                    
                    // Duration: Prefer MusicBrainz, fallback to Last.fm, then Spotify
                    duration_ms: musicbrainzData?.length || 
                                (lastfmData?.duration ? parseInt(lastfmData.duration) : null) || 
                                item.track.duration_ms,
                    
                    // Popularity data: Only from Last.fm
                    listeners: lastfmData?.listeners || null,
                    playcount: lastfmData?.playcount || null,
                    
                    // Release info: Prefer MusicBrainz
                    first_release_date: musicbrainzData?.first_release_date || null,
                    
                    // Metadata
                    disambiguation: musicbrainzData?.disambiguation || null,
                    wiki_summary: lastfmData?.wiki_summary || null,
                    
                    // Data source indicators
                    has_musicbrainz_data: musicbrainzData !== null,
                    has_lastfm_data: lastfmData !== null,
                    data_sources: [
                        musicbrainzData !== null ? 'musicbrainz' : null,
                        lastfmData !== null ? 'lastfm' : null
                    ].filter(Boolean)
                };
                
                // Create enhanced song object
                const enhancedSong = {
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
                            external_ids: item.track.external_ids || {},
                            popularity: item.track.popularity,
                            preview_url: item.track.preview_url
                        }
                    },
                    
                    // Raw MusicBrainz data
                    musicbrainz: musicbrainzData || {
                        musicbrainz_id: null,
                        title: null,
                        length: null,
                        disambiguation: null,
                        first_release_date: null,
                        tags: [],
                        artist_credit: [],
                        score: null
                    },
                    
                    // Raw Last.fm data
                    lastfm: lastfmData || {
                        duration: null,
                        listeners: null,
                        playcount: null,
                        tags: [],
                        lastfm_url: null,
                        wiki_summary: null
                    },
                    
                    // Hybrid combined data (BEST OF BOTH!)
                    hybrid: hybridData,
                    
                    // Easy access metadata
                    metadata: {
                        artist: artistName,
                        track: trackName,
                        added_to_spotify: item.added_at,
                        spotify_duration_ms: item.track.duration_ms,
                        best_duration_ms: hybridData.duration_ms,
                        genres: combinedTags, // This is the GOLD - combined genres!
                        popularity_score: item.track.popularity,
                        listen_count: lastfmData?.playcount || null,
                        listener_count: lastfmData?.listeners || null,
                        isrc: isrc,
                        spotify_id: item.track.id,
                        musicbrainz_id: musicbrainzData?.musicbrainz_id || null,
                        first_release_date: musicbrainzData?.first_release_date || null,
                        disambiguation: musicbrainzData?.disambiguation || null,
                        data_completeness: {
                            has_isrc: !!isrc,
                            has_musicbrainz: hybridData.has_musicbrainz_data,
                            has_lastfm: hybridData.has_lastfm_data,
                            has_genres: combinedTags.length > 0,
                            genre_sources: combinedTags.length > 0 ? hybridData.data_sources : []
                        }
                    }
                };
                
                enhancedSongs.push(enhancedSong);
                
                // Small delay to be nice to APIs
                if (i < songs.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            return enhancedSongs;
        }
        
        console.log("Starting to fetch all liked songs...");
        const spotifySongs = await fetchAllLikedSongs();
        console.log(`Fetched ${spotifySongs.length} songs from Spotify`);
        
        console.log("Enhancing songs with HYBRID data (MusicBrainz + Last.fm)...");
        const enhancedSongs = await enhanceSongsHybrid(spotifySongs);
        
        console.log(`Successfully enhanced ${enhancedSongs.length} songs with hybrid data`);
        
        // Calculate comprehensive statistics
        const stats = {
            total_songs: enhancedSongs.length,
            data_source_coverage: {
                songs_with_isrc: enhancedSongs.filter(s => s.metadata.data_completeness.has_isrc).length,
                songs_with_musicbrainz_data: enhancedSongs.filter(s => s.metadata.data_completeness.has_musicbrainz).length,
                songs_with_lastfm_data: enhancedSongs.filter(s => s.metadata.data_completeness.has_lastfm).length,
                songs_with_genres: enhancedSongs.filter(s => s.metadata.data_completeness.has_genres).length,
                songs_with_both_sources: enhancedSongs.filter(s => 
                    s.metadata.data_completeness.has_musicbrainz && s.metadata.data_completeness.has_lastfm
                ).length
            },
            genre_analysis: {
                total_unique_genres: [...new Set(enhancedSongs.flatMap(s => s.metadata.genres))].length,
                musicbrainz_only_genres: [...new Set(enhancedSongs.flatMap(s => s.musicbrainz.tags || []))].length,
                lastfm_only_genres: [...new Set(enhancedSongs.flatMap(s => s.lastfm.tags || []))].length,
                combined_genres: [...new Set(enhancedSongs.flatMap(s => s.metadata.genres))],
            },
            avg_popularity: Math.round(
                enhancedSongs.reduce((sum, s) => sum + (s.spotify.track.popularity || 0), 0) / enhancedSongs.length
            )
        };
        
        res.json({
            stats,
            songs: enhancedSongs
        });
        
    } catch (error) {
        console.error("Error fetching and enhancing liked songs with hybrid data:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/get-liked-ai-enhanced", async (req, res) => {
    try {
        const { accessToken } = req.body;
        
        async function fetchMusicBrainzData(isrc) {
            try {
                if (!isrc) return null;
                
                const url = `https://musicbrainz.org/ws/2/recording/?query=isrc:${isrc}&fmt=json`;
                
                await new Promise(resolve => setTimeout(resolve, 1100));
                
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'SpotifyAnalyzer/1.0 (your-email@example.com)'
                    }
                });
                
                if (!response.ok) {
                    console.error(`MusicBrainz API error: ${response.status} for ISRC: ${isrc}`);
                    return null;
                }
                
                const data = await response.json();
                
                if (data.recordings && data.recordings.length > 0) {
                    const recording = data.recordings[0];
                    
                    return {
                        musicbrainz_id: recording.id,
                        title: recording.title,
                        length: recording.length || null,
                        disambiguation: recording.disambiguation || null,
                        first_release_date: recording['first-release-date'] || null,
                        tags: recording.tags ? recording.tags.map(tag => tag.name) : [],
                        artist_credit: recording['artist-credit'] || [],
                        score: recording.score || null
                    };
                }
                return null;
            } catch (error) {
                console.error(`MusicBrainz API error for ISRC ${isrc}:`, error.message);
                return null;
            }
        }
        
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
            
            let allSongs = [...data.items];
            
            if (data.next) {
                console.log(`Fetching next page: ${data.next}`);
                const nextPageSongs = await fetchAllLikedSongs(data.next);
                allSongs = [...allSongs, ...nextPageSongs];
            }
            
            return allSongs;
        }
        
        async function enhanceSongsWithAI(songs) {
            console.log(`Enhancing ${songs.length} songs with AI-ENHANCED data (MusicBrainz + Last.fm + GPT fallback)...`);
            const enhancedSongs = [];
            
            // First pass: Get MusicBrainz and Last.fm data
            for (let i = 0; i < songs.length; i++) {
                const item = songs[i];
                const artistName = item.track.artists[0]?.name || '';
                const trackName = item.track.name || '';
                const isrc = item.track.external_ids?.isrc;
                
                console.log(`Pass 1 - Processing ${i + 1}/${songs.length}: ${artistName} - ${trackName}`);
                
                // Fetch from both traditional sources
                const promises = [
                    fetchLastFmData(artistName, trackName),
                    fetchMusicBrainzData(isrc)
                ];
                
                const [lastfmData, musicbrainzData] = await Promise.all(promises);
                
                // Combine traditional tags
                const musicbrainzTags = musicbrainzData?.tags || [];
                const lastfmTags = lastfmData?.tags || [];
                const traditionalTags = [...new Set([...musicbrainzTags, ...lastfmTags])];
                
                enhancedSongs.push({
                    item,
                    artistName,
                    trackName,
                    isrc,
                    lastfmData,
                    musicbrainzData,
                    traditionalTags,
                    needsGPT: traditionalTags.length === 0 // Flag songs that need GPT fallback
                });
                
                // Small delay for rate limiting
                if (i < songs.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            // Identify songs that need GPT enhancement
            const songsNeedingGPT = enhancedSongs
                .filter(song => song.needsGPT)
                .map(song => ({ artist: song.artistName, track: song.trackName }));
                
            console.log(`${songsNeedingGPT.length} songs need GPT genre analysis`);
            
            // Second pass: Get GPT data for songs without genres
            let gptResults = [];
            if (songsNeedingGPT.length > 0) {
                console.log(`Pass 2 - Getting GPT analysis for ${songsNeedingGPT.length} songs...`);
                gptResults = await gptService.getGenresFromGPTBatch(songsNeedingGPT, 3);
            }
            
            // Third pass: Combine all data
            const finalEnhancedSongs = enhancedSongs.map((song, index) => {
                const gptIndex = songsNeedingGPT.findIndex(s => 
                    s.artist === song.artistName && s.track === song.trackName
                );
                const gptData = gptIndex >= 0 ? gptResults[gptIndex] : null;
                
                // Determine final genre list
                let finalGenres = [...song.traditionalTags];
                let genreSources = [];
                
                if (song.musicbrainzData?.tags?.length > 0) genreSources.push('musicbrainz');
                if (song.lastfmData?.tags?.length > 0) genreSources.push('lastfm');
                
                // Add GPT genres if no traditional genres found
                if (finalGenres.length === 0 && gptData) {
                    if (gptData.primary_genre) finalGenres.push(gptData.primary_genre);
                    if (gptData.subgenres) finalGenres.push(...gptData.subgenres);
                    finalGenres = [...new Set(finalGenres)]; // Remove duplicates
                    if (gptData.primary_genre) genreSources.push('gpt');
                }
                
                // Create comprehensive data structure
                return {
                    // Original Spotify data
                    spotify: {
                        added_at: song.item.added_at,
                        track: {
                            id: song.item.track.id,
                            name: song.item.track.name,
                            artists: song.item.track.artists,
                            album: song.item.track.album,
                            duration_ms: song.item.track.duration_ms,
                            external_urls: song.item.track.external_urls,
                            external_ids: song.item.track.external_ids || {},
                            popularity: song.item.track.popularity,
                            preview_url: song.item.track.preview_url
                        }
                    },
                    
                    // Raw data from each source
                    musicbrainz: song.musicbrainzData || {
                        musicbrainz_id: null,
                        title: null,
                        length: null,
                        disambiguation: null,
                        first_release_date: null,
                        tags: [],
                        artist_credit: [],
                        score: null
                    },
                    
                    lastfm: song.lastfmData || {
                        duration: null,
                        listeners: null,
                        playcount: null,
                        tags: [],
                        lastfm_url: null,
                        wiki_summary: null
                    },
                    
                    gpt: gptData || {
                        primary_genre: null,
                        subgenres: [],
                        confidence: 0,
                        era: null,
                        characteristics: null,
                        related_artists: [],
                        source: 'gpt',
                        tokens_used: 0
                    },
                    
                    // AI-enhanced combined data
                    ai_enhanced: {
                        genres: finalGenres,
                        genre_sources: genreSources,
                        primary_genre: gptData?.primary_genre || (finalGenres.length > 0 ? finalGenres[0] : null),
                        
                        // Duration from best available source
                        duration_ms: song.musicbrainzData?.length || 
                                    (song.lastfmData?.duration ? parseInt(song.lastfmData.duration) : null) || 
                                    song.item.track.duration_ms,
                        
                        // Popularity data
                        listeners: song.lastfmData?.listeners || null,
                        playcount: song.lastfmData?.playcount || null,
                        
                        // AI insights
                        era: gptData?.era || null,
                        characteristics: gptData?.characteristics || null,
                        related_artists: gptData?.related_artists || [],
                        ai_confidence: gptData?.confidence || null,
                        
                        // Data completeness
                        data_sources: genreSources,
                        used_ai_fallback: song.needsGPT && gptData?.primary_genre !== null,
                        genre_completeness: finalGenres.length > 0,
                        tokens_used: gptData?.tokens_used || 0
                    },
                    
                    // Easy access metadata
                    metadata: {
                        artist: song.artistName,
                        track: song.trackName,
                        added_to_spotify: song.item.added_at,
                        spotify_duration_ms: song.item.track.duration_ms,
                        best_duration_ms: song.musicbrainzData?.length || 
                                          (song.lastfmData?.duration ? parseInt(song.lastfmData.duration) : null) || 
                                          song.item.track.duration_ms,
                        genres: finalGenres,
                        primary_genre: gptData?.primary_genre || (finalGenres.length > 0 ? finalGenres[0] : null),
                        popularity_score: song.item.track.popularity,
                        listen_count: song.lastfmData?.playcount || null,
                        listener_count: song.lastfmData?.listeners || null,
                        isrc: song.isrc,
                        spotify_id: song.item.track.id,
                        musicbrainz_id: song.musicbrainzData?.musicbrainz_id || null,
                        first_release_date: song.musicbrainzData?.first_release_date || null,
                        era: gptData?.era || null,
                        ai_enhanced: song.needsGPT && gptData?.primary_genre !== null
                    }
                };
            });
            
            return finalEnhancedSongs;
        }
        
        console.log("Starting to fetch all liked songs...");
        const spotifySongs = await fetchAllLikedSongs();
        console.log(`Fetched ${spotifySongs.length} songs from Spotify`);
        
        console.log("Enhancing songs with AI-ENHANCED data...");
        const enhancedSongs = await enhanceSongsWithAI(spotifySongs);
        
        console.log(`Successfully enhanced ${enhancedSongs.length} songs with AI-enhanced data`);
        
        // Calculate comprehensive statistics
        const stats = {
            total_songs: enhancedSongs.length,
            data_source_coverage: {
                songs_with_musicbrainz: enhancedSongs.filter(s => s.musicbrainz.musicbrainz_id !== null).length,
                songs_with_lastfm: enhancedSongs.filter(s => s.lastfm.listeners !== null).length,
                songs_enhanced_with_ai: enhancedSongs.filter(s => s.ai_enhanced.used_ai_fallback).length,
                songs_with_complete_genres: enhancedSongs.filter(s => s.ai_enhanced.genre_completeness).length
            },
            genre_analysis: {
                total_unique_genres: [...new Set(enhancedSongs.flatMap(s => s.ai_enhanced.genres))].length,
                songs_with_traditional_genres: enhancedSongs.filter(s => 
                    s.ai_enhanced.genre_sources.includes('musicbrainz') || s.ai_enhanced.genre_sources.includes('lastfm')
                ).length,
                songs_with_ai_genres: enhancedSongs.filter(s => s.ai_enhanced.genre_sources.includes('gpt')).length,
                all_genres: [...new Set(enhancedSongs.flatMap(s => s.ai_enhanced.genres))].sort()
            },
            ai_usage: {
                total_tokens_used: enhancedSongs.reduce((sum, s) => sum + (s.gpt.tokens_used || 0), 0),
                songs_processed_by_ai: enhancedSongs.filter(s => s.ai_enhanced.used_ai_fallback).length,
                average_ai_confidence: Math.round(
                    (enhancedSongs
                        .filter(s => s.gpt.confidence > 0)
                        .reduce((sum, s) => sum + s.gpt.confidence, 0) / 
                     enhancedSongs.filter(s => s.gpt.confidence > 0).length) * 100
                ) / 100 || 0
            },
            cache_stats: gptService.getCacheStats(),
            avg_popularity: Math.round(
                enhancedSongs.reduce((sum, s) => sum + (s.spotify.track.popularity || 0), 0) / enhancedSongs.length
            )
        };
        
        res.json({
            stats,
            songs: enhancedSongs
        });
        
    } catch (error) {
        console.error("Error fetching and enhancing liked songs with AI:", error);
        res.status(500).json({ error: error.message });
    }
});

// Optional: Add an endpoint to clear GPT cache if needed
app.post("/clear-gpt-cache", (req, res) => {
    try {
        gptService.clearCache();
        res.json({ message: "GPT cache cleared successfully", stats: gptService.getCacheStats() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Optional: Add an endpoint to get cache stats
app.get("/gpt-cache-stats", (req, res) => {
    try {
        const stats = gptService.getCacheStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
