const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = 9090;
const SECRET = crypto.randomBytes(32).toString('hex');

// Save secret for GitHub webhook config
fs.writeFileSync('/opt/neekoras/webhook-secret.txt', SECRET);

function verifySignature(body, signature) {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    return res.end('not found');
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const sig = req.headers['x-hub-signature-256'];
    if (!verifySignature(body, sig)) {
      res.writeHead(403);
      return res.end('invalid signature');
    }

    try {
      const payload = JSON.parse(body);
      if (payload.ref === 'refs/heads/main') {
        console.log(`Deploy triggered by push from ${payload.pusher?.name || 'unknown'}`);
        const output = execSync('/opt/neekoras/deploy.sh 2>&1').toString();
        console.log(output);
        res.writeHead(200);
        res.end('deployed');
      } else {
        res.writeHead(200);
        res.end('ignored (not main branch)');
      }
    } catch (e) {
      console.error('Deploy error:', e.message);
      res.writeHead(500);
      res.end('deploy failed');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Webhook listening on port ${PORT}`);
  console.log(`Secret saved to /opt/neekoras/webhook-secret.txt`);
});
