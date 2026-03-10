const https = require('http');

const options = {
  hostname: '81.68.249.18',
  port: 8100,
  path: '/rest/v1/',
  headers: {
    'apikey': 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc3MDQ0OTk0MywgImV4cCI6IDIwODU4MDk5NDN9.c93Eb3linNGsiZj7dEb7PSR4ko7pDNuwbs62Ps5xyB0',
    'Authorization': 'Bearer eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc3MDQ0OTk0MywgImV4cCI6IDIwODU4MDk5NDN9.c93Eb3linNGsiZj7dEb7PSR4ko7pDNuwbs62Ps5xyB0'
  }
};

https.get(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const data = JSON.parse(body);
    if (data.paths) {
      const tables = Object.keys(data.paths)
        .filter(p => p.indexOf('/rpc') === -1)
        .map(p => p.replace(/^\//, ''))
        .sort();
      console.log('=== Prod 数据库表列表 (' + tables.length + ' 张表) ===\n');
      tables.forEach(t => console.log('  ' + t));
    } else {
      console.log(JSON.stringify(data, null, 2).substring(0, 3000));
    }
  });
}).on('error', e => console.error(e));
