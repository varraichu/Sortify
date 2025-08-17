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
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Ref to prevent double execution
  const hasProcessedAuth = useRef(false);

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
      const result = await fetch("http://localhost:3000/get-liked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token })
      });

      const data = await result.json();
      console.log('Enhanced songs data:', data);
      setEnhancedSongs(data.songs);
      setStats(data.stats);
    } catch (error) {
      console.error("Error fetching enhanced songs:", error);
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

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Display your Spotify profile data</h1>

      <section id="profile">
        <h2>Logged in as <span>{displayName}</span></h2>
        {avatarUrl && <img src={avatarUrl} alt="avatar" width={100} />}
        <ul>
          <li>User ID: <span>{userId}</span></li>
          <li>Email: <span>{email}</span></li>
          <li>Spotify URI: <a href={spotifyUri}>{spotifyUri}</a></li>
          <li>Link: <a href={profileUrl}>{profileUrl}</a></li>
        </ul>
      </section>
      
      <div style={{ marginTop: '30px' }}>
        <button 
          onClick={getEnhancedLikedSongs} 
          disabled={isLoading}
          style={{ 
            padding: '10px 20px', 
            fontSize: '16px', 
            backgroundColor: isLoading ? '#ccc' : '#1db954',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? 'Fetching & Enhancing Songs...' : 'Get Enhanced Liked Songs'}
        </button>
        
        {stats && (
          <div style={{ 
            marginTop: '20px', 
            padding: '15px', 
            backgroundColor: '#f0f0f0', 
            borderRadius: '5px' 
          }}>
            <h3>📊 Your Music Stats</h3>
            <ul>
              <li><strong>Total Songs:</strong> {stats.total_songs}</li>
              <li><strong>Songs with Last.fm data:</strong> {stats.songs_with_lastfm_data}</li>
              <li><strong>Average Popularity:</strong> {stats.avg_popularity}/100</li>
              <li><strong>Unique Genres:</strong> {stats.unique_genres.length}</li>
              <li><strong>Top Genres:</strong> {stats.unique_genres.slice(0, 10).join(', ')}</li>
            </ul>
          </div>
        )}
        
        {enhancedSongs.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h3>🎵 Your Enhanced Liked Songs ({enhancedSongs.length} total):</h3>
            <div style={{ maxHeight: '600px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '5px' }}>
              {enhancedSongs.map((song, index) => (
                <div key={index} style={{ 
                  padding: '15px', 
                  borderBottom: '1px solid #eee',
                  backgroundColor: index % 2 === 0 ? '#fafafa' : 'white'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: '0 0 5px 0', color: '#1db954' }}>
                        {song.spotify.track.name}
                      </h4>
                      <p style={{ margin: '0 0 10px 0', color: '#666' }}>
                        by {song.spotify.track.artists.map(a => a.name).join(', ')}
                      </p>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '10px' }}>
                        <div>
                          <strong>🎧 Last.fm Stats:</strong><br/>
                          {song.lastfm.listeners && <span>👥 {parseInt(song.lastfm.listeners).toLocaleString()} listeners<br/></span>}
                          {song.lastfm.playcount && <span>▶️ {parseInt(song.lastfm.playcount).toLocaleString()} plays<br/></span>}
                          {song.lastfm.duration && <span>⏱️ {Math.round(song.lastfm.duration/1000/60*100)/100} min</span>}
                        </div>
                        
                        <div>
                          <strong>🏷️ Genres:</strong><br/>
                          {song.lastfm.tags.length > 0 ? (
                            <span style={{ fontSize: '12px' }}>
                              {song.lastfm.tags.slice(0, 4).map(tag => (
                                <span key={tag} style={{ 
                                  backgroundColor: '#e1f5fe', 
                                  padding: '2px 6px', 
                                  margin: '2px', 
                                  borderRadius: '10px',
                                  display: 'inline-block'
                                }}>
                                  {tag}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span style={{ color: '#999' }}>No genre data</span>
                          )}
                        </div>
                        
                        <div>
                          <strong>📈 Spotify:</strong><br/>
                          <span>Popularity: {song.spotify.track.popularity}/100<br/></span>
                          <span>Added: {new Date(song.spotify.added_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      
                      {song.lastfm.wiki_summary && (
                        <details style={{ marginTop: '10px' }}>
                          <summary style={{ cursor: 'pointer', color: '#1db954' }}>📖 About this song</summary>
                          <p style={{ fontSize: '12px', marginTop: '5px', color: '#666' }}>
                            {song.lastfm.wiki_summary.replace(/<[^>]*>/g, '').slice(0, 200)}...
                          </p>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;