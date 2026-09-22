// api/news.js
const { getCached, setCached, HOUR } = require("../lib/cache");

module.exports = async (req, res) => {
  try {
    const cached = getCached("news");
    if (cached) return res.status(200).json({ response: cached });

    const key = process.env.NEWS_API_KEY;
    if (!key) {
      throw new Error(
        "NEWS_API_KEY is not set. Add it in Vercel: Project Settings > Environment Variables."
      );
    }

    const params = new URLSearchParams({
      q: '(football OR soccer) AND (Premier League OR "Champions League" OR "La Liga" OR Bundesliga OR "Serie A")',
      language: "en",
      sortBy: "publishedAt",
      pageSize: "12",
      apiKey: key,
    });

    const r = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`);
    if (!r.ok) throw new Error(`NewsAPI failed: ${r.status}`);
    const json = await r.json();
    const articles = json.articles || [];
    setCached("news", articles, HOUR);
    res.status(200).json({ response: articles });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
