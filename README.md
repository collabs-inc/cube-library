# Cube Library

Save anything and find it again. Links, pictures, articles, videos, posts, notes and quotes all go into one calm grid, with no folders to file them in. A Librarian tags everything you save, and you find things by searching for whatever you remember about them: a word, a tag, a kind of thing, or a colour.

- **Saving:** paste anywhere, drop a picture, or type in the first card.
  - **Links** get their title, picture, site and description, and articles keep their text.
  - **YouTube** videos play in the card. **X** posts keep their text and picture.
  - **Products** show their price.
  - Text in quotation marks, or ending in "— Name", becomes a quote.
- **Finding:** one search field for words, `#tags`, `type:image` and `color:orange`, combined as you like. There are chips for each kind of card and swatches for the colours picked from each picture.
- **A card, opened:** a large view of the thing itself, with its summary, tags, colours, your notes and similar cards.
- **The Librarian** floats in the corner (⌘J), running on the machine's Claude Code or Codex.
  - It tags and summarises what you save, quietly and in batches, so a burst of saves costs one turn.
  - It finds things from a description ("that chair I saved in summer").
  - It gathers things under a shared tag when you ask.

## Plain files, for people and agents

| What | Where |
|---|---|
| A card | `~/Mind/<title>-<id>.md`: YAML front matter (`type`, `title`, `url`, `site`, `image`, `tags`, `colors`, `summary`, `created`, …) and the text as its body |
| Pictures | `~/Mind/assets/`, kept locally so a card never depends on someone else's server |
| Deleted cards | `~/Mind/.trash/` |

Any agent can read the folder, or write a card file, and the page updates. Obsidian opens it as a vault, too: point Mind at a folder inside your Notes vault (`MIND_HOME`, or `"home"` in `~/.local/state/cube-library/settings.json`) and the two apps share it. Set `"autoTag": false` there to stop the Librarian from tagging new saves.

## Install it on a Cube

Cube Library is a [Cube app](https://github.com/collabs-inc/cube-computer/blob/apps/docs/apps.md). Add `https://github.com/collabs-inc/cube-library` in the Apps surface, or install it from the Market. It needs only Node 20, and the install creates `~/Mind` with a couple of cards.

To save from your browser, make a bookmark of `javascript:location.href='https://<your Cube Library address>/save?url='+encodeURIComponent(location.href)`.

## How a Cube app is put together

Same template as [Cube Studio](https://github.com/collabs-inc/cube-studio), [Cube Scout](https://github.com/collabs-inc/cube-scout) and [Cube Write](https://github.com/collabs-inc/cube-write):
- `cube.json` names the app and says how to install and start it.
- The server listens on `$PORT` on `127.0.0.1`.
- `kit/` is shared unchanged. Cube Library uses its floating persona (`kit/persona-float.js`) for the Librarian.

## Layout

```
cube.json            the Cube app contract
server/              server.mjs (API, saving, the Librarian), cards.mjs (files, search, colours), fetch.mjs (link previews), setup-home.mjs
web/                 the page
kit/                 the persona and the look, shared with the other apps
librarian/           LIBRARIAN.md, the Librarian's brief
starter/             what ~/Mind starts with
```

## Run it outside Cube

```bash
node server/setup-home.mjs && node server/server.mjs    # http://127.0.0.1:4323 ; MIND_HOME, MIND_STATE, PORT override
npm test
```

The server binds to `127.0.0.1` only. Outside Cube nothing signs a visitor in, so don't expose it.
