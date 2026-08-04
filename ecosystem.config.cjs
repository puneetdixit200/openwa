module.exports = {
  apps: [
    {
      name: 'placement-collector',
      script: 'dist/src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      time: true,
    },
  ],
};
