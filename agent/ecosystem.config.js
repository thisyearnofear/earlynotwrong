module.exports = {
  apps: [
    {
      name: "earlynotwrong",
      cwd: "/home/linuxuser/earlynotwrong/agent",
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
