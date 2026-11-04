export default async function handler(req, res) {
  // Дозволяємо CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { path } = req.query;
  const targetPath = Array.isArray(path) ? path.join('/') : (path || '');
  const targetUrl = `https://off.energy.mk.ua/api/${targetPath}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://off.energy.mk.ua/',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const data = await response.text();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.status(response.status).send(data);
  } catch (err) {
    return res.status(502).json({ error: 'Proxy error', message: err.message });
  }
}
