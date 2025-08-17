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
  const [likedSongs, setLikedSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const lastFmApiKey = '71cc238599a7ced74ba12364bcc0cf50'
  // Ref to prevent double execution
  const hasProcessedAuth = useRef(false);

  async function redirectToAuthCodeFlow() {
    const res = await fetch("http://localhost:3000/auth");
    const data = await res.json();

    // save verifier for later token exchange
    console.log("code data: ", data)
    setCodeVerifier(data.codeVerifier)
    localStorage.setItem("code_verifier", data.codeVerifier);

    // now navigate to Spotify login
    window.location.href = data.authUrl;
  }

  async function getAccessToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier')
    console.log("verifier", codeVerifier)
    const res = await fetch("http://localhost:3000/get-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier
      })
    });
    const data = await res.json();
    console.log("Token response:", data)

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

    // set states
    setDisplayName(data.display_name);
    setAvatarUrl(data.images?.[0]?.url || "");
    setUserId(data.id);
    setEmail(data.email);
    setSpotifyUri(data.uri);
    setProfileUrl(data.external_urls?.spotify);
    setImgUrl(data.images?.[0]?.url || "");

    return data;
  }

  async function getLikedSongs() {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const result = await fetch("http://localhost:3000/get-liked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token })
      });

      const data = await result.json();
      console.log(`Received ${data.total} liked songs:`, data);
      setLikedSongs(data.songs);
    } catch (error) {
      console.error("Error fetching liked songs:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function lastFmApi(){
    try{
      const result = await fetch(`http://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${lastFmApiKey}&artist=ariana grande&track=in my head&format=json`, {
      })

      const data = await result.json();
      console.log(data);
    }
    catch(error){

    }
  }


  useEffect(() => {
    // Prevent double execution in Strict Mode
    if (hasProcessedAuth.current) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    async function handleAuth() {
      try {
        if (!code) {
          hasProcessedAuth.current = true;
          await redirectToAuthCodeFlow();
        } else {
          console.log("Processing auth code")
          hasProcessedAuth.current = true;

          // Check if we already have a valid token
          if (!accessToken) {
            console.log("Getting access token")
            const token = await getAccessToken(code);
            console.log("Token received:", token)
            await fetchProfile(token);
            // clean URL so code isn't reused
            window.history.replaceState({}, document.title, "/");
          } else {
            console.log("Using existing token")
            await fetchProfile(accessToken);
          }
        }
      } catch (error) {
        console.error("Auth error:", error);
        hasProcessedAuth.current = false; // Allow retry on error
      }
    }

    handleAuth();
  }, []);

  return (
    <div>
      <h1>Display your Spotify profile data</h1>

      <section id="profile">
        <h2>Logged in as <span>{displayName}</span></h2>
        {avatarUrl && <img src={avatarUrl} alt="avatar" width={100} />}
        <ul>
          <li>User ID: <span>{userId}</span></li>
          <li>Email: <span>{email}</span></li>
          <li>Spotify URI: <a href={spotifyUri}>{spotifyUri}</a></li>
          <li>Link: <a href={profileUrl}>{profileUrl}</a></li>
          <li>Profile Image: {imgUrl && <img src={imgUrl} alt="profile" width={100} />}</li>
        </ul>
      </section>
      
      <div>
        <button onClick={getLikedSongs} disabled={isLoading}>
          {isLoading ? 'Fetching All Liked Songs...' : 'Get All Liked Songs'}
        </button>
        
        {likedSongs.length > 0 && (
          <div>
            <h3>Your Liked Songs ({likedSongs.length} total):</h3>
            <ul style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {likedSongs.map((item, index) => (
                <li key={index} style={{ marginBottom: '10px' }}>
                  <strong>{item.track.name}</strong> by {item.track.artists.map(a => a.name).join(', ')}
                  <br />
                  <small>Added: {new Date(item.added_at).toLocaleDateString()}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button onClick={lastFmApi}>LASTFM</button>
    </div>
  );
}

export default App;