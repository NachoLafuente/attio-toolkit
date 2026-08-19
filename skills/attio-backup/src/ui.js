/** Terminal progress output. Degrades to plain lines when not a TTY. */

const isTty = process.stdout.isTTY && !process.env.NO_COLOR;

const c = (code) => (s) => (isTty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const dim = c(2);
export const bold = c(1);
export const green = c(32);
export const red = c(31);
export const yellow = c(33);
export const cyan = c(36);

export class Progress {
  /**
   * `live` controls in-place redraw (TTY only). `quiet` suppresses all output.
   * They are separate: cron and CI are not TTYs but still want the summary
   * lines, and writing to stdout when quiet corrupts callers that parse it.
   */
  constructor({ live = isTty, quiet = false } = {}) {
    this.live = live && !quiet;
    this.quiet = quiet;
    this.label = "";
    this.count = 0;
  }

  start(label) {
    this.label = label;
    this.count = 0;
    this.#render();
  }

  update(count) {
    this.count = count;
    this.#render();
  }

  /**
   * `label` is passed in rather than read from instance state: collectors run
   * in parallel and would otherwise clobber each other's labels, printing a
   * count under the wrong collection name.
   */
  finish(label, count, { skipped = false, error = null } = {}) {
    this.#clear();
    if (!this.quiet) {
      const n = String(count ?? 0).padStart(6);
      if (error) {
        console.log(`${red("  \u2717")} ${n}  ${label} ${dim(`(${error})`)}`);
      } else if (skipped) {
        console.log(`${yellow("  -")} ${n}  ${label} ${dim("(skipped)")}`);
      } else {
        console.log(`${green("  \u2713")} ${n}  ${label}`);
      }
    }
    this.label = "";
  }

  #render() {
    if (!this.live || !this.label) return;
    this.#clear();
    process.stdout.write(
      `${cyan("  \u00b7")} ${String(this.count).padStart(6)}  ${this.label}`,
    );
  }

  #clear() {
    if (!this.live) return;
    process.stdout.write("\r\x1b[2K");
  }
}

export function humanBytes(n) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function humanDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
