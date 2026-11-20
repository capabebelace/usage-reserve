# usage-reserve

Holds back part of your Claude weekly usage limit for a chosen day. `/reserve mon 2h` (or `/reserve mon 15%`) keeps that share of the seven-day window free until Monday starts: the status line shows where you stand, a toast warns 5 points early, and prompts are blocked once you reach the line. Start a prompt with `!!` to send it anyway. `/reserve` shows status, `/reserve off` removes it. Hours are converted to percent with a rate the mod measures from your own active time (4%/hour assumed until 30 minutes are measured).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-reserve --marketplace capabebelace/usage-reserve
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install usage-reserve --marketplace capabebelace/usage-reserve
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `capabebelace/usage-reserve`, then Add plugin.

## Usage

- `/reserve mon 2h` or `/reserve mon 15%` — hold that much of the weekly window until Monday
- `/reserve` — show status, weekly usage, reset date and measured rate
- `/reserve off` — remove the reserve
- Start a prompt with `!!` to send it past the block
