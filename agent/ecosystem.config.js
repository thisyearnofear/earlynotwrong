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
    {
      // Delphi prediction-market runner (docs/DELPHI_AGENT_ARENA.md).
      // Separate process from the BSC pipeline so a Delphi failure can't take
      // down anchoring/telegram for the crypto signals, and vice versa. The
      // entry checks DELPHI_ENABLED itself, so the process is a harmless
      // no-op until the competition wallet is registered + funded.
      name: "earlynotwrong-delphi",
      cwd: "/home/linuxuser/earlynotwrong/agent",
      script: "dist/lib/delphi/runner.js",
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
