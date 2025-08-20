import { useState, useEffect, useRef } from 'react';

function App() {
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [spotifyUri, setSpotifyUri] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [imgUrl, setImgUrl] = useState("");

  const [codeVerifier, setCodeVerifier] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [enhancedSongs, setEnhancedSongs] = useState([]);
  const [groupedSongs, setGroupedSongs] = useState({});
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState('all');

  // Ref to prevent double execution
  const hasProcessedAuth = useRef(false);

  // Major genre mapping - maps Last.fm tags to broader categories
  const genreMapping = {
    // Pop & Mainstream
    'pop': 'Pop',
    'dance pop': 'Pop', 
    'electropop': 'Pop',
    'synthpop': 'Pop',
    'indie pop': 'Indie',
    
    'hyperpop': 'HyperPop',
    'experimental': 'HyperPop',
    'glitch pop': 'HyperPop',

    // Hip-Hop & Rap
    'hip hop': 'Hip-Hop',
    'Hip-Hop': 'Hip-Hop',
    'rap': 'Hip-Hop',
    'trap': 'Hip-Hop',
    'gangsta rap': 'Hip-Hop',
    
    // R&B & Soul
    'rnb': 'R&B',
    'r&b': 'R&B',
    'soul': 'R&B',
    'neo soul': 'R&B',
    'contemporary r&b': 'R&B',
    
    // Rock & Alternative
    'rock': 'Rock',
    'alternative rock': 'Rock',
    'indie rock': 'Rock',
    'punk rock': 'Rock',
    'hard rock': 'Rock',
    'classic rock': 'Rock',
    
    // Electronic & Dance
    'electronic': 'Electronic',
    'edm': 'Electronic',
    'house': 'Electronic',
    'techno': 'Electronic',
    'dubstep': 'Electronic',
    'ambient': 'Electronic',
    
    // Folk & Country
    'folk': 'Folk',
    'country': 'Country',
    'americana': 'Folk',
    'singer-songwriter': 'Folk',
    
    // Jazz & Blues
    'jazz': 'Jazz',
    'blues': 'Blues',
    'swing': 'Jazz',
    
    // Latin
    'latin': 'Latin',
    'reggaeton': 'Latin',
    'salsa': 'Latin',
    
    // Alternative & Indie
    'alternative': 'Alternative',
    'indie': 'Indie',
    'experimental': 'Alternative'
  };

  const genreColors = {
    'Pop': '#ff6b9d',
    'Hip-Hop': '#ffd93d',
    'R&B': '#6bcf7f',
    'Rock': '#ff8066',
    'Electronic': '#4ecdc4',
    'Folk': '#95e1d3',
    'Country': '#f38ba8',
    'Jazz': '#a8dadc',
    'Blues': '#457b9d',
    'Latin': '#e63946',
    'Alternative': '#9d4edd',
    'Indie': '#f72585',
    'Other': '#adb5bd'
  };

  function categorizeGenres(songs) {
    const grouped = {};
    const genreStats = {};
    
    songs.forEach(song => {
      let primaryGenre = 'Other';
      
      // Use AI-enhanced genres from the new data structure
      const genres = song.ai_enhanced?.genres || song.metadata?.genres || [];
      
      // Find the first matching major genre from the song's tags
      for (const tag of genres) {
        const normalizedTag = tag.toLowerCase();
        if (genreMapping[normalizedTag]) {
          primaryGenre = genreMapping[normalizedTag];
          break;
        }
      }
      
      // Initialize genre group if it doesn't exist
      if (!grouped[primaryGenre]) {
        grouped[primaryGenre] = [];
        genreStats[primaryGenre] = {
          count: 0,
          totalListeners: 0,
          totalPlays: 0,
          avgPopularity: 0
        };
      }
      
      grouped[primaryGenre].push(song);
      genreStats[primaryGenre].count += 1;
      genreStats[primaryGenre].totalListeners += song.lastfm?.listeners ? parseInt(song.lastfm.listeners) : 0;
      genreStats[primaryGenre].totalPlays += song.lastfm?.playcount ? parseInt(song.lastfm.playcount) : 0;
      genreStats[primaryGenre].avgPopularity += song.spotify.track.popularity || 0;
    });
    
    // Calculate averages
    Object.keys(genreStats).forEach(genre => {
      const stats = genreStats[genre];
      stats.avgPopularity = Math.round(stats.avgPopularity / stats.count);
      stats.avgListeners = Math.round(stats.totalListeners / stats.count);
      stats.avgPlays = Math.round(stats.totalPlays / stats.count);
    });
    
    // Sort songs within each genre by popularity
    Object.keys(grouped).forEach(genre => {
      grouped[genre].sort((a, b) => (b.spotify.track.popularity || 0) - (a.spotify.track.popularity || 0));
    });
    
    return { grouped, genreStats };
  }

  async function redirectToAuthCodeFlow() {
    const res = await fetch("http://localhost:3000/auth");
    const data = await res.json();

    console.log("code data: ", data)
    setCodeVerifier(data.codeVerifier)
    localStorage.setItem("code_verifier", data.codeVerifier);

    window.location.href = data.authUrl;
  }

  async function getAccessToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier')
    const res = await fetch("http://localhost:3000/get-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier
      })
    });
    const data = await res.json();

    if (data.access_token) {
      localStorage.setItem("access_token", data.access_token);
      setAccessToken(data.access_token);
      return data.access_token;
    } else {
      throw new Error(data.error || 'Failed to get access token');
    }
  }

  async function fetchProfile(token) {
    const result = await fetch("https://api.spotify.com/v1/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await result.json();

    setDisplayName(data.display_name);
    setAvatarUrl(data.images?.[0]?.url || "");
    setUserId(data.id);
    setEmail(data.email);
    setSpotifyUri(data.uri);
    setProfileUrl(data.external_urls?.spotify);
    setImgUrl(data.images?.[0]?.url || "");

    return data;
  }

  async function getEnhancedLikedSongs() {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const result = await fetch("http://localhost:3000/get-liked-ai-enhanced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token })
      });

      const data = await result.json();
      console.log('AI Enhanced songs data:', data);
      setEnhancedSongs(data.songs);
      setStats(data.stats);
      
      // Group songs by genre using AI-enhanced data
      const { grouped, genreStats } = categorizeGenres(data.songs);
      setGroupedSongs(grouped);
      
      console.log('Grouped by AI-enhanced genres:', grouped);
      console.log('AI stats:', data.stats);
      
    } catch (error) {
      console.error("Error fetching AI enhanced songs:", error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (hasProcessedAuth.current) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    async function handleAuth() {
      try {
        if (!code) {
          hasProcessedAuth.current = true;
          await redirectToAuthCodeFlow();
        } else {
          hasProcessedAuth.current = true;

          if (!accessToken) {
            const token = await getAccessToken(code);
            await fetchProfile(token);
            window.history.replaceState({}, document.title, "/");
          } else {
            await fetchProfile(accessToken);
          }
        }
      } catch (error) {
        console.error("Auth error:", error);
        hasProcessedAuth.current = false;
      }
    }

    handleAuth();
  }, []);

  const genreList = Object.keys(groupedSongs).sort((a, b) => groupedSongs[b].length - groupedSongs[a].length);
  const displaySongs = selectedGenre === 'all' ? enhancedSongs : groupedSongs[selectedGenre] || [];

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', backgroundColor: '#0a0a0a', color: '#fff', minHeight: '100vh' }}>
      <h1 style={{ color: '#1db954', textAlign: 'center', marginBottom: '30px' }}>🎵 Your AI-Enhanced Spotify Vibe Check 🎵</h1>

      <section id="profile" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2>Logged in as <span style={{ color: '#1db954' }}>{displayName}</span></h2>
        {avatarUrl && <img src={avatarUrl} alt="avatar" width={100} style={{ borderRadius: '50%', margin: '10px' }} />}
      </section>
      
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <button 
          onClick={getEnhancedLikedSongs} 
          disabled={isLoading}
          style={{ 
            padding: '15px 30px', 
            fontSize: '18px', 
            backgroundColor: isLoading ? '#444' : '#1db954',
            color: 'white',
            border: 'none',
            borderRadius: '25px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 15px rgba(29, 185, 84, 0.3)',
            transition: 'all 0.3s ease'
          }}
        >
          {isLoading ? '🤖 Loading AI-Enhanced Data (MusicBrainz + Last.fm + GPT)...' : '🚀 Get AI-Enhanced Music!'}
        </button>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '15px', 
          marginBottom: '30px',
          padding: '20px',
          backgroundColor: '#1a1a1a',
          borderRadius: '15px',
          border: '2px solid #333'
        }}>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ color: '#1db954', margin: '0 0 10px 0' }}>🎵 Total Songs</h3>
            <p style={{ fontSize: '2em', fontWeight: 'bold', margin: '0' }}>{stats.total_songs}</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ color: '#4ecdc4', margin: '0 0 10px 0' }}>🤖 AI Enhanced</h3>
            <p style={{ fontSize: '2em', fontWeight: 'bold', margin: '0', color: '#4ecdc4' }}>
              {stats.ai_usage?.songs_processed_by_ai || 0}
            </p>
            <p style={{ fontSize: '0.8em', opacity: 0.7 }}>
              ({Math.round(((stats.ai_usage?.songs_processed_by_ai || 0) / stats.total_songs) * 100)}%)
            </p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ color: '#ff6b9d', margin: '0 0 10px 0' }}>🎯 AI Confidence</h3>
            <p style={{ fontSize: '2em', fontWeight: 'bold', margin: '0', color: '#ff6b9d' }}>
              {Math.round((stats.ai_usage?.average_ai_confidence || 0) * 100)}%
            </p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ color: '#ffd93d', margin: '0 0 10px 0' }}>💰 Tokens Used</h3>
            <p style={{ fontSize: '1.5em', fontWeight: 'bold', margin: '0', color: '#ffd93d' }}>
              {stats.ai_usage?.total_tokens_used?.toLocaleString() || 0}
            </p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ color: '#95e1d3', margin: '0 0 10px 0' }}>🎨 Unique Genres</h3>
            <p style={{ fontSize: '2em', fontWeight: 'bold', margin: '0', color: '#95e1d3' }}>
              {stats.genre_analysis?.total_unique_genres || 0}
            </p>
          </div>
        </div>
      )}

      {Object.keys(groupedSongs).length > 0 && (
        <>
          {/* Genre Filter Pills */}
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '10px', 
            justifyContent: 'center', 
            marginBottom: '30px' 
          }}>
            <button
              onClick={() => setSelectedGenre('all')}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                border: 'none',
                backgroundColor: selectedGenre === 'all' ? '#1db954' : '#333',
                color: 'white',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              All ({enhancedSongs.length})
            </button>
            {genreList.map(genre => (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  backgroundColor: selectedGenre === genre ? genreColors[genre] : '#333',
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: selectedGenre === genre ? `0 0 15px ${genreColors[genre]}40` : 'none'
                }}
              >
                {genre} ({groupedSongs[genre].length})
              </button>
            ))}
          </div>

          {/* Genre Overview Cards */}
          {selectedGenre === 'all' && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
              gap: '20px', 
              marginBottom: '40px' 
            }}>
              {genreList.map(genre => (
                <div 
                  key={genre}
                  style={{
                    padding: '20px',
                    borderRadius: '15px',
                    background: `linear-gradient(135deg, ${genreColors[genre]}20, ${genreColors[genre]}10)`,
                    border: `2px solid ${genreColors[genre]}40`,
                    cursor: 'pointer',
                    transition: 'transform 0.3s ease',
                    ':hover': { transform: 'scale(1.05)' }
                  }}
                  onClick={() => setSelectedGenre(genre)}
                >
                  <h3 style={{ 
                    color: genreColors[genre], 
                    margin: '0 0 15px 0',
                    textAlign: 'center',
                    fontSize: '1.4em'
                  }}>
                    {genre}
                  </h3>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ margin: '5px 0', fontSize: '1.2em', fontWeight: 'bold' }}>
                      🎵 {groupedSongs[genre].length} songs
                    </p>
                    <p style={{ margin: '5px 0', fontSize: '0.9em', opacity: 0.8 }}>
                      📈 Avg Popularity: {Math.round(groupedSongs[genre].reduce((sum, song) => sum + (song.spotify.track.popularity || 0), 0) / groupedSongs[genre].length)}/100
                    </p>
                    <p style={{ margin: '5px 0', fontSize: '0.8em', color: '#4ecdc4' }}>
                      🤖 {groupedSongs[genre].filter(s => s.ai_enhanced?.used_ai_fallback).length} AI-enhanced
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Songs Display */}
          <div>
            <h2 style={{ 
              color: selectedGenre !== 'all' ? genreColors[selectedGenre] : '#1db954',
              textAlign: 'center',
              marginBottom: '20px'
            }}>
              {selectedGenre === 'all' ? '🎶 All Your Songs' : `🎵 ${selectedGenre} Vibes`} ({displaySongs.length})
            </h2>
            
            <div style={{ 
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
              gap: '20px'
            }}>
              {displaySongs.map((song, index) => {
                const genres = song.ai_enhanced?.genres || song.metadata?.genres || [];
                const primaryGenre = genres.length > 0 ? 
                  (genreMapping[genres[0].toLowerCase()] || 'Other') : 'Other';
                
                const isAIEnhanced = song.ai_enhanced?.used_ai_fallback || false;
                const hasMusicBrainz = song.musicbrainz?.musicbrainz_id !== null;
                const hasLastFm = song.lastfm?.listeners !== null;
                
                return (
                  <div key={index} style={{ 
                    padding: '20px', 
                    borderRadius: '15px',
                    backgroundColor: '#1a1a1a',
                    border: `2px solid ${isAIEnhanced ? '#4ecdc4' : genreColors[primaryGenre]}40`,
                    boxShadow: isAIEnhanced ? '0 4px 20px rgba(78, 205, 196, 0.3)' : '0 4px 20px rgba(0,0,0,0.3)',
                    transition: 'transform 0.3s ease',
                    position: 'relative'
                  }}>
                    
                    {/* AI Enhanced Badge */}
                    {isAIEnhanced && (
                      <div style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        backgroundColor: '#4ecdc4',
                        color: '#000',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '0.7em',
                        fontWeight: 'bold'
                      }}>
                        🤖 AI Enhanced
                      </div>
                    )}
                    
                    <div style={{ marginBottom: '15px' }}>
                      <h4 style={{ 
                        margin: '0 0 5px 0', 
                        color: genreColors[primaryGenre],
                        fontSize: '1.2em'
                      }}>
                        {song.spotify.track.name}
                        {song.musicbrainz?.disambiguation && (
                          <span style={{ fontSize: '0.8em', color: '#999', marginLeft: '8px' }}>
                            ({song.musicbrainz.disambiguation})
                          </span>
                        )}
                      </h4>
                      <p style={{ margin: '0 0 10px 0', color: '#ccc', fontSize: '1em' }}>
                        by {song.spotify.track.artists.map(a => a.name).join(', ')}
                      </p>
                      
                      {/* AI Insights */}
                      {isAIEnhanced && song.gpt?.characteristics && (
                        <div style={{ 
                          backgroundColor: '#4ecdc420', 
                          padding: '10px', 
                          borderRadius: '8px', 
                          marginBottom: '15px',
                          border: '1px solid #4ecdc440'
                        }}>
                          <h5 style={{ color: '#4ecdc4', margin: '0 0 5px 0', fontSize: '0.9em' }}>🤖 AI Analysis:</h5>
                          <p style={{ margin: '0', fontSize: '0.8em', color: '#ccc' }}>
                            {song.gpt.characteristics}
                          </p>
                          {song.gpt?.era && (
                            <p style={{ margin: '5px 0 0 0', fontSize: '0.8em', color: '#4ecdc4' }}>
                              Era: {song.gpt.era} | Confidence: {Math.round((song.gpt.confidence || 0) * 100)}%
                            </p>
                          )}
                        </div>
                      )}
                      
                      {/* Genre Tags */}
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '15px' }}>
                        {genres.slice(0, 6).map((tag, tagIndex) => {
                          // Determine the source of this tag for color coding
                          const isFromMusicBrainz = song.musicbrainz?.tags?.includes(tag);
                          const isFromLastFm = song.lastfm?.tags?.includes(tag);
                          const isFromGPT = song.ai_enhanced?.genre_sources?.includes('gpt') && 
                                          (song.gpt?.primary_genre === tag || song.gpt?.subgenres?.includes(tag));
                          
                          let tagColor = '#999';
                          let tagIcon = '';
                          
                          if (isFromGPT) {
                            tagColor = '#4ecdc4';
                            tagIcon = ' 🤖';
                          } else if (isFromMusicBrainz && isFromLastFm) {
                            tagColor = '#ffd700';
                            tagIcon = ' ✨';
                          } else if (isFromMusicBrainz) {
                            tagColor = '#a8dadc';
                            tagIcon = ' 🎵';
                          } else if (isFromLastFm) {
                            tagColor = '#ff6b9d';
                            tagIcon = ' 🎧';
                          }
                          
                          return (
                            <span key={tagIndex} style={{ 
                              backgroundColor: tagColor + '40',
                              color: tagColor,
                              padding: '3px 8px', 
                              borderRadius: '12px',
                              fontSize: '0.8em',
                              fontWeight: 'bold',
                              border: `1px solid ${tagColor}80`
                            }}>
                              {tag}{tagIcon}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(2, 1fr)', 
                      gap: '10px',
                      fontSize: '0.9em',
                      color: '#aaa'
                    }}>
                      <div>
                        <strong style={{ color: '#fff' }}>🔍 Data Sources:</strong><br/>
                        <div style={{ fontSize: '0.8em', marginTop: '5px' }}>
                          {hasMusicBrainz && (
                            <span style={{ color: '#a8dadc', marginRight: '8px' }}>🎵 MusicBrainz</span>
                          )}
                          {hasLastFm && (
                            <span style={{ color: '#ff6b9d', marginRight: '8px' }}>🎧 Last.fm</span>
                          )}
                          {isAIEnhanced && (
                            <span style={{ color: '#4ecdc4', marginRight: '8px' }}>🤖 GPT</span>
                          )}
                          {!genres.length && (
                            <span style={{ color: '#999' }}>❌ No genres</span>
                          )}
                        </div>
                        {song.musicbrainz?.first_release_date && (
                          <span style={{ fontSize: '0.8em', color: '#a8dadc' }}>
                            📅 {song.musicbrainz.first_release_date}
                          </span>
                        )}
                      </div>
                      
                      <div>
                        <strong style={{ color: '#fff' }}>📊 Stats:</strong><br/>
                        {song.lastfm?.listeners && (
                          <span style={{ fontSize: '0.8em', color: '#ff6b9d' }}>
                            👥 {parseInt(song.lastfm.listeners).toLocaleString()}<br/>
                          </span>
                        )}
                        {song.lastfm?.playcount && (
                          <span style={{ fontSize: '0.8em', color: '#ff6b9d' }}>
                            ▶️ {parseInt(song.lastfm.playcount).toLocaleString()}<br/>
                          </span>
                        )}
                        <span style={{ fontSize: '0.8em' }}>
                          🔥 {song.spotify.track.popularity}/100 Spotify<br/>
                        </span>
                        <span style={{ fontSize: '0.8em', color: '#999' }}>
                          📅 Added: {new Date(song.spotify.added_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    
                    {/* Related Artists from GPT */}
                    {song.gpt?.related_artists?.length > 0 && (
                      <div style={{ marginTop: '10px' }}>
                        <strong style={{ color: '#4ecdc4', fontSize: '0.8em' }}>🎭 Similar Artists:</strong>
                        <div style={{ fontSize: '0.7em', color: '#ccc', marginTop: '5px' }}>
                          {song.gpt.related_artists.slice(0, 3).join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;