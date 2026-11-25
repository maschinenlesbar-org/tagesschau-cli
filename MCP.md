# tagesschau-mcp

An [MCP](https://modelcontextprotocol.io/) server for the news of [tagesschau.de](https://www.tagesschau.de)
(ARD-aktuell): the homepage's top stories, the Ressort feeds, the regional news of the 16
Bundesländer from the ARD broadcasters, a full-text search, the live and broadcast streams and an
article's text, as tools for AI agents. Read-only, no API key. The content is copyrighted
editorial content for private, non-commercial use only (see Licence).

It is the MCP side of [tagesschau-cli](https://github.com/maschinenlesbar-org/tagesschau-cli),
built on the same typed client, and released with it.

## Install

```bash
npm i -g @maschinenlesbar.org/tagesschau-mcp
```

This installs the **`tagesschau-mcp`** command (Node.js 22.12+). Or run the container
image, for linux/amd64 and linux/arm64, which needs no Node.js:

```bash
docker run -i --rm ghcr.io/maschinenlesbar-org/tagesschau-mcp:latest
```

## Connect a client

The server speaks MCP on stdio by default.

**Claude Code**

```bash
claude mcp add tagesschau -- tagesschau-mcp
# or with the image:
claude mcp add tagesschau -- docker run -i --rm ghcr.io/maschinenlesbar-org/tagesschau-mcp:latest
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{ "mcpServers": { "tagesschau": { "command": "tagesschau-mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "tagesschau": { "type": "stdio", "command": "tagesschau-mcp" } } }
```

**Over HTTP** (Streamable HTTP, one endpoint `POST /mcp`):

```bash
tagesschau-mcp --transport http            # http://127.0.0.1:3000/mcp
claude mcp add --transport http tagesschau http://127.0.0.1:3000/mcp
```

In a container, publish the port on loopback only:
`docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/maschinenlesbar-org/tagesschau-mcp:latest --transport http --host 0.0.0.0 --allowed-hosts localhost,127.0.0.1`.

For scripts and shared configs, pin a release and its digest from the
[release notes](https://github.com/maschinenlesbar-org/tagesschau-cli/releases) instead of
`latest`: `…/tagesschau-mcp:<version>@sha256:<digest>`. Check an image's provenance with
`gh attestation verify oci://ghcr.io/maschinenlesbar-org/tagesschau-mcp:<version> --repo maschinenlesbar-org/tagesschau-cli`.

## Tools

| Tool | What it answers |
|---|---|
| `getBriefing` | What's in the news: breaking news (Eilmeldung) first, the homepage's top stories in its editorial order, and up to three Ressort feeds (inland, ausland, wirtschaft, sport, video, investigativ, wissen) newest first, each item once. |
| `getRegionalNews` | The regional news of one to four Bundesländer by name, code, region id or city, newest first per state, labelled with the state and the broadcaster; optionally only the items that mention a topic. |
| `getTopicCoverage` | How much and how recently a topic is covered: the search's total hit count, one page of hits with articles and videos apart, newest first, and a timeline by age. |
| `getLiveStreams` | The channels with their playable links: the tagesschau24 livestream, the latest editions and the accessible ones (Einfache Sprache, Gebärdensprache). |
| `getNewsFeed` | The news feed as the API orders it, unfiltered, by Ressort or by Bundesland, with the cursor of the next, older page. |
| `getArticle` | One item's text by its article id, block by block (HTML dropped, nothing reworded), a page of blocks at a time. |

The tools carry the API's traps so a model doesn't have to: the Ressort feeds are not in date order
and the sport feed (from sportschau.de, without a ressort) repeats items, so they are sorted and
listed once; states asked together share one page of the API, so each state is a request of its
own; Berlin and Brandenburg come as a pair (rbb); the API drops the region when a Ressort is sent,
so a topic within a state is filtered here; "Frankfurt" alone is ambiguous (am Main or Oder) and
asked back, never guessed; the search page is 1-based (the API's is 0-based) and matches spellings
literally (a note says when to try ä, ö, ü or ß); an article that is gone (taken offline after a
while, Depublizierung) says so.

Every tool only reads. An answer is JSON (`structuredContent` and the same as text), with the
`source` it came from (whole, never cut like the data; an answer a redirect fetched from another
host says so there: "… (answered by https://other.example after a redirect)", and a WARN record
names both) and the data licence. A text over 2000 characters is cut and ends in `…[cut, N
characters in all]`, and the answer says `truncated`. An answer over `--max-result-chars` first
loses entries from the end of its page (`nextOffset` says where to go on), then has its longest
texts cut further (each with that mark) or, when that isn't enough, its other lists shortened; a
list keeps its first entry, `notes` stay whole, and the answer says `truncated`. One that can't be
cut down so far is a tool error that says to ask for less. A failure is a tool error that says what
to change (one over 5000 characters loses its middle, never its end, where the reason is).

## Options

```
--transport <stdio|http>   stdio (default), or Streamable HTTP on POST /mcp
--host <address>           HTTP: the address to listen on (default 127.0.0.1)
--port <n>                 HTTP: the port (default 3000)
--allowed-hosts <list>     HTTP: Host header names to answer (default localhost,127.0.0.1,[::1])
--allowed-origins <list>   HTTP: browser origins allowed to call, exactly (https://app.example.org); none by default
--auth-token-file <path>   HTTP: a file with the bearer token every request must send (mode 600, 32+ characters)
--base-url <url>           API host (default https://www.tagesschau.de; the client adds /api2u)
--timeout <ms>             per upstream request (default 30000)
--call-timeout <ms>        per tool call, retries included (default 45000)
--max-result-chars <n>     cap on one tool result's JSON (default 25000)
--max-pages <n>            pages a tool reads per list and call (default 10)
--user-agent <ua>          User-Agent header value (Latin-1, one line)
--log-format <text|jsonl>  the log records on stderr (default text)
```

## What it does and doesn't do

- **Read-only.** No tool changes anything, here or upstream.
- **No authentication** on HTTP unless you give one. It listens on loopback by default; it checks
  the `Host` header and, from a browser, the `Origin` (only the origins given with
  `--allowed-origins`, matched exactly) against DNS rebinding and other web pages; a page on one of
  those origins gets CORS (its preflight answered, the answers readable). With `--auth-token-file
  <path>` every request must send `Authorization: Bearer <token>` (the file holds one token of at
  least 32 characters, mode 600, owned by the user the server runs as, a regular file (a FIFO is
  refused at once, never waited on); read once at start; `(umask 077; openssl rand -hex 32 >
  mcp-token)` makes one); anything else is answered 401. Exposed beyond localhost (it logs a warning
  then), it belongs behind a proxy that authenticates or at least terminates TLS.
- **Gentle with the upstream.** One server process sends at most 2 requests at a time and 120 a
  minute to the API, pauses on HTTP 429 (as long as its Retry-After asks, at most 30 s), and stops a
  tool call after its deadline (a tool that has read part of its answer by then may answer with that
  part, and says so). A request those limits would hold longer than it or its call may wait is not
  sent: the call fails at once, naming the limit and when to ask again (and the log says so). The
  API's community documentation asks for at most 60 requests an hour, and the server keeps to that:
  a request beyond 60 in the last hour is refused before it is sent, and the tool's answer says when
  the next one is possible. The tools answer a question with one to four requests, and the
  instructions tell a model not to loop pages or states unasked.
- **Results are data.** Text from the API, keys included, is cleaned (control, bidi, zero-width, tag
  and other invisible characters removed, but an emoji keeps its joiners; a key that cleaning makes
  equal to another stays, as `name~2`), but it is still other people's text: a model can be told
  things in it. The server can't act on that (it has no tool that writes), but other tools in the
  same session could.
- **Stops cleanly.** On `docker stop` (SIGTERM) or Ctrl-C the HTTP server takes no new connection
  and lets calls in flight answer for up to 5 s, then exits 143 (130); a second signal ends it at
  once. On stdio a signal ends it at once; when stdin ends, it first answers the requests it has
  read (each within its call deadline), then exits.
- **In a container** it needs at least 12 processes and threads (`--pids-limit`) and about
  256 MB of memory.
- **Logs** go to stderr, one record per line; stdout carries only the protocol. A call that fails
  upstream or reaches its deadline leaves a WARN record naming the tool.
- **Never installs anything.**

## Licence

Code: AGPL-3.0-or-later or commercial
([LICENSING.md](https://github.com/maschinenlesbar-org/tagesschau-cli/blob/main/LICENSING.md)).
Data: the news texts, images, audio and video are journalistic works under copyright of
ARD-aktuell / NDR, the ARD broadcasters (BR, hr, MDR, NDR, Radio Bremen, rbb, SR, SWR, WDR) and
their authors, with no open licence. The API, documented by the community and not an official ARD
product, may be used for private, non-commercial purposes only; publishing or redistributing the
content is not permitted, except content expressly under CC BY-NC-ND 4.0 DE
([tagesschau.de/creativecommons](https://www.tagesschau.de/creativecommons/)); commercial use is
prohibited ([terms](https://www.tagesschau.de/nutzungsbedingungen),
[DATA_LICENSE.md](https://github.com/maschinenlesbar-org/tagesschau-cli/blob/main/DATA_LICENSE.md)).
Every result carries this note in its `licence` field; link the article (`shareURL`) and quote
briefly. We provide the tool, not the data: running the server as a service for others may need
ARD-aktuell's permission.
