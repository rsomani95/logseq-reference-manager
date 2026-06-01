# Setting up Logseq's HTTP API

Reference Manager imports a PDF's highlights into your graph as real, linkable
highlight blocks. Those blocks are written through **Logseq's own HTTP API**, so
you need to turn that API on and give the plugin an authorization token. This is
only required for **annotation sync** — importing references works without it.

## Quick setup

1. In Logseq, open **Settings → Features** and enable **HTTP APIs Server**.
2. Open the **API** panel (the toolbar button that appears once the feature is
   on) and click **Start Server**.
3. Under **Authorization tokens**, click **Add new token** — any name will do.
4. Copy that token into **Reference Manager → Settings → Connections → Logseq
   HTTP API**, then click **Test connection**.

By default the server listens on `http://127.0.0.1:12315`. If you've changed the
host or port, set it under **Connections → Logseq HTTP API → Advanced**.

> More detail coming soon.
