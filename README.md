# Collapse (name is WIP)

Simple time-tracking via periodic screenshots as a service, designed to be embedded into Hack Club programs.

There are currently two 2 official clients for this service:

- [Web React SDK](/clients/react/API.md) - for embedding the recorder in your web app.
- [Desktop App](https://github.com/hackclub/collapse/releases) - for download on Mac, Windows, and Linux.

> [!NOTE]
> If you're a YSWS program author hoping to integrate Collapse into your program, please reach out to me via Slack.
>
> If you're a Hack Clubber using Collapse and running into issues with Collapse, please reach out to the program's author (and not me). They'll forward the issue to me if needed. - @samliu

### Why does this exist?

Collapse is a [Lapse](https://lapse.hackclub.com) alternative with differing goals.

Lapse is a standalone, general purpose, time-lapse creation tool with [Hackatime](https://hackatime.hackclub.com) integration, to produce smooth time-lapse videos that is Hackatime compatible and can be shared.

Collapse is a service that processes screenshots for proof of time spent on a project. At it's core, Collapse accepts screenshots from clients (similar to Hackatime's heartbeats). Collapse needs to be integrated into other Hack Club programs to function.

## How it works... in a nutshell

Collapse is designed to be simple, resilient, and easy to integrate. Here's how it works at a high level:

1. A Hack Club program generates a session and shares it with the client.
2. The client begins capturing screenshots once per minute, uploading them as they are taken.
3. The server tracks the number and timing of screenshots received to validate time.
4. When the session finishes, Collapse stitches the screenshots into a time-lapse video.
5. The Hack Club program can retrieve the session results.

Sessions auto-pause after 5 minutes of inactivity and auto-stop after 30 minutes of being paused.

There is no concept of "users" or "accounts" in Collapse. Sessions are created to be shared to users and controlled by the Hack Club program that created them.
