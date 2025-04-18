#!/usr/bin/env node

const http = require('http');
const url = require('url');

const argv = process.argv.slice(2);
const logLevel = argv[0];

if (!logLevel) {
  console.error('Error: Log level not provided');
  console.log('Usage: node set-loglevel.js <log-level>');
  console.log('Available log levels: error, warn, info, http, verbose, debug, silly');
  process.exit(1);
}

const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
if (!validLogLevels.includes(logLevel)) {
  console.error(`Error: Invalid log level '${logLevel}'`);
  console.log(`Log level must be one of: ${validLogLevels.join(', ')}`);
  process.exit(1);
}

const serverPort = process.env.SERVER_PORT || 3001;
const serverHost = process.env.SERVER_HOST || 'localhost';

const options = {
  hostname: serverHost,
  port: serverPort,
  path: `/config/loglevel?level=${logLevel}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log(`Successfully set log level to: ${logLevel}`);
      try {
        const response = JSON.parse(data);
        console.log(`Server response: ${response.message}`);
      } catch (e) {
        console.log('Server response:', data);
      }
    } else {
      console.error(`Error: Server responded with status code ${res.statusCode}`);
      console.error('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error sending request:', error.message);
});

req.end();

console.log(`Sending request to change log level to: ${logLevel}`); 