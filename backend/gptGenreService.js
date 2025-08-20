const OpenAI = require('openai');

class GPTGenreService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Cache to avoid repeated API calls for the same songs
        this.genreCache = new Map();
        
        // Rate limiting - OpenAI allows quite generous limits but let's be respectful
        this.lastRequestTime = 0;
        this.minRequestInterval = 100; // 100ms between requests
    }

    async rateLimitDelay() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minRequestInterval) {
            await new Promise(resolve => 
                setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
            );
        }
        
        this.lastRequestTime = Date.now();
    }

    async getGenreFromGPT(artistName, trackName) {
        // Check cache first
        const cacheKey = `${artistName.toLowerCase()}-${trackName.toLowerCase()}`;
        if (this.genreCache.has(cacheKey)) {
            console.log(`Using cached GPT result for: ${artistName} - ${trackName}`);
            return this.genreCache.get(cacheKey);
        }

        try {
            // Rate limiting
            await this.rateLimitDelay();

            console.log(`Fetching GPT genre data for: ${artistName} - ${trackName}`);

            const prompt = `Analyze the song "${trackName}" by "${artistName}" and provide genre information.

Please respond with a JSON object in this exact format:
{
    "primary_genre": "main genre (e.g., rock, pop, jazz)",
    "subgenres": ["subgenre1", "subgenre2", "subgenre3"],
    "confidence": 0.95,
    "era": "decade when this style was most popular (e.g., 1980s, 2000s)",
    "characteristics": "brief description of musical characteristics",
    "related_artists": ["similar artist 1", "similar artist 2"]
}

Be specific with genres (e.g., "indie rock" instead of just "rock", "synthwave" instead of just "electronic"). Include 2-4 relevant subgenres. Confidence should be between 0.1 and 1.0.`;

            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo", // or "gpt-4" if you have access and want higher quality
                messages: [
                    {
                        role: "system",
                        content: "You are a music expert specializing in genre classification. Provide accurate, specific genre information in the requested JSON format only. Do not include any additional text outside the JSON response."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 300,
                temperature: 0.3, // Lower temperature for more consistent results
                response_format: { type: "json_object" }
            });

            const responseText = completion.choices[0]?.message?.content;
            
            if (!responseText) {
                throw new Error('No response from GPT');
            }

            // Parse the JSON response
            const genreData = JSON.parse(responseText);
            
            // Validate the response structure
            const validatedData = {
                primary_genre: genreData.primary_genre || null,
                subgenres: Array.isArray(genreData.subgenres) ? genreData.subgenres : [],
                confidence: typeof genreData.confidence === 'number' ? genreData.confidence : 0.5,
                era: genreData.era || null,
                characteristics: genreData.characteristics || null,
                related_artists: Array.isArray(genreData.related_artists) ? genreData.related_artists : [],
                source: 'gpt',
                tokens_used: completion.usage?.total_tokens || 0
            };

            // Cache the result
            this.genreCache.set(cacheKey, validatedData);
            
            return validatedData;

        } catch (error) {
            console.error(`GPT API error for ${artistName} - ${trackName}:`, error.message);
            
            // Return a structured null response on error
            return {
                primary_genre: null,
                subgenres: [],
                confidence: 0,
                era: null,
                characteristics: null,
                related_artists: [],
                source: 'gpt',
                error: error.message,
                tokens_used: 0
            };
        }
    }

    // Batch processing method for efficiency
    async getGenresFromGPTBatch(songs, batchSize = 5) {
        console.log(`Processing ${songs.length} songs with GPT in batches of ${batchSize}`);
        const results = [];
        
        for (let i = 0; i < songs.length; i += batchSize) {
            const batch = songs.slice(i, i + batchSize);
            console.log(`Processing GPT batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(songs.length/batchSize)}`);
            
            const batchPromises = batch.map(song => 
                this.getGenreFromGPT(song.artist, song.track)
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Small delay between batches
            if (i + batchSize < songs.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        return results;
    }

    // Method to get cache statistics
    getCacheStats() {
        return {
            cached_entries: this.genreCache.size,
            cache_keys: Array.from(this.genreCache.keys())
        };
    }

    // Method to clear cache if needed
    clearCache() {
        this.genreCache.clear();
        console.log('GPT genre cache cleared');
    }
}

module.exports = GPTGenreService;