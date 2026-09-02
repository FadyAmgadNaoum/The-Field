/**
 * PM2 process configuration (Doc 23 REL-M0-T01, §13.5; Doc 24 §I.2).
 *
 * TWO INSTANCES FROM DAY ONE, on ports 3000 and 3001.
 *
 * Docs 15 §5 and 22 §14.4 specify a single instance, reasoning that node-cron
 * runs in-process. That reasoning is superseded (Doc 24 §I.2): the booking
 * expiry job is a single atomic UPDATE, and under READ COMMITTED a blocked
 * UPDATE re-evaluates its WHERE clause after acquiring the row lock. The rows
 * are already `expired` by then, so they no longer qualify and are skipped.
 * Each booking is therefore expired exactly once, and only the winning
 * transaction receives it in RETURNING — so audit rows are written once.
 *
 * Conditions that make that safe (Doc 24 §I.2) — do not violate them:
 *   - the expiry job runs at READ COMMITTED, never SERIALIZABLE
 *   - audit entries are derived strictly from the UPDATE ... RETURNING set
 *
 * `fork` mode, not `cluster`: each instance needs its own fixed port so NGINX
 * can address them individually.
 *
 * Not runnable in Milestone 0 beyond configuration — verified on the VPS.
 */
module.exports = {
  apps: [
    {
      name: 'thefield-a',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3000',
      cwd: '/var/www/thefield',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        INSTANCE_ID: 'a',
      },
      max_memory_restart: '1G',
      error_file: '/var/log/thefield/a-error.log',
      out_file: '/var/log/thefield/a-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Must exceed SHUTDOWN_DRAIN_MS (30s) so a draining process is never
      // force-killed mid-transaction (Doc 23 §13.5).
      kill_timeout: 35000,
      listen_timeout: 5000,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
    },
    {
      name: 'thefield-b',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3001',
      cwd: '/var/www/thefield',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        INSTANCE_ID: 'b',
      },
      max_memory_restart: '1G',
      error_file: '/var/log/thefield/b-error.log',
      out_file: '/var/log/thefield/b-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 35000,
      listen_timeout: 5000,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
    },
  ],
}
