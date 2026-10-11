// A tiny stand-in for LibreTranslate, so the browser tests never call a real translation service.
import { createServer } from 'node:http';

const IT = { milch: 'Latte', brot: 'Pane', eier: 'Uova' };

createServer((req, res) => {
  // GET /languages: the status check in the help
  if (req.method === 'GET') return res.end(JSON.stringify([{ code: 'it', name: 'Italian' }]));
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { q, target } = JSON.parse(body || '{}');
    const list = Array.isArray(q) ? q : [q];
    const out = list.map((s) => (target === 'it' && IT[s.toLowerCase()]) || `${s} [${target}]`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ translatedText: Array.isArray(q) ? out : out[0] }));
  });
}).listen(Number(process.env.PORT || 8099), '127.0.0.1');
