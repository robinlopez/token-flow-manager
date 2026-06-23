---
icon: lucide/rocket
---

# Getting started

Token Flow Manager runs on your computer and opens a dashboard in your browser.
You only need **Node.js 20 or newer** installed ([download it here](https://nodejs.org)).

## 1. Download

Go to the [Releases page](https://github.com/robinlopez/token-flow-manager/releases)
and download the file named `token-flow-manager-0.1.0.tgz`.

## 2. Install

Open a terminal in the folder where you downloaded the file, then run:

```bash
npm install -g ./token-flow-manager-0.1.0.tgz
```

That installs the `tokenflow` command on your computer. You only do this once.

## 3. Launch

From now on, just type:

```bash
tokenflow
```

A welcome screen opens in your browser. Pick a recent project or browse for a folder.

!!! tip "Open a project directly"

    You can also point it straight at a project folder:

    ```bash
    tokenflow ./my-design-tokens
    ```

## Other commands

```bash
tokenflow validate    # check your tokens, exits with an error if something is wrong
tokenflow init        # create a tokenflow.config.json in the current folder
```

## Configuration

Token Flow Manager reads two files:

- **`manifest.json`**: your token organization (collections and modes).
- **`tokenflow.config.json`**: tool preferences only. Create one with `tokenflow init`.

## Next steps

- See everything the dashboard can do on the [Features](features.md) page.
- Want to build or contribute? Read the [Development](development.md) page.
