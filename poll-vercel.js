const https = require('https');

const data = JSON.stringify({ email: 'zaki@daxus.com' });

const options = {
  hostname: 'daxus-platform.vercel.app',
  port: 443,
  path: '/api/auth/validate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
};

let attempts = 0;

function check() {
  attempts++;
  console.log(`Attempt ${attempts}...`);
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (d) => {
      body += d;
    });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('SUCCESS: Deployment is live and working!');
        process.exit(0);
      } else {
        console.log(`Failed (Status ${res.statusCode}). Retrying in 5s...`);
        setTimeout(check, 5000);
      }
    });
  });

  req.on('error', (error) => {
    console.error('Error:', error);
    setTimeout(check, 5000);
  });

  req.write(data);
  req.end();
}

check();
