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
    {
      // Alpaca options agent (hackathon proof point). Runs the same harness
      // with HARNESS_DOMAIN=options on its OWN port + data dir so it coexists
      // with the crypto agent (which owns :31777 and agent/data/state.json).
      // ALPACA_* keys + ALPACA_PAPER are read from agent/.env by env-bootstrap.
      // The crypto agent's CROO CAP client and subscriber polling are skipped
      // for this domain (domain guard in index.ts), so signals-live is only
      // fulfilled by the crypto process.
      name: "earlynotwrong-options",
      cwd: "/home/linuxuser/earlynotwrong/agent",
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        HARNESS_DOMAIN: "options",
        AGENT_PORT: "31778",
        AGENT_DATA_DIR: "/home/linuxuser/earlynotwrong/agent/data-options",
      },
    },
  ],
};
