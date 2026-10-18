# Third-Party Notices — opencode-rea

This plugin installs third-party skill packs **on demand** at runtime via
`rea_bootstrap_stack` (`npx skills add … --agent opencode --yes`; see
`src/bootstrap.ts` `REA_SKILL_PACKS`). Nothing below is vendored into this
repo: `skills/` ships only the four first-party `rea-*` skills. The table
records the source, license, and pinned commit each pack was verified at.

## On-demand skill packs (installed by `rea_bootstrap_stack`, never vendored)

| Pack (install label) | Source repo | License | Verified commit |
| --- | --- | --- | --- |
| `p4nda0s/reverse-skills` | https://github.com/p4nda0s/reverse-skills | MIT (declared in `README.md` § `## 许可证` and `README_EN.md` § `## License`; repo ships **no** `LICENSE` file) | `a2baa31c58a3567977188414da68c8c842057152` |
| `ljagiello/ctf-skills` | https://github.com/ljagiello/ctf-skills | MIT (`LICENSE`: `Copyright (c) 2026 Lukasz Jagiello`) | `3bb6bad1a06664840d07b6e1e69bf19e6ca4672d` |
| `cyberkaida/reverse-engineering-assistant` | https://github.com/cyberkaida/reverse-engineering-assistant | Apache-2.0 (`LICENSE` at repo root and identical `ReVa/LICENSE`) | `a05a6b0a18649efd6d74ec8447bdadf8d468c365` |
| `rehan-remade/universal-modder` | https://github.com/rehan-remade/universal-modder | MIT (`LICENSE`: `Copyright (c) 2026 Rehan and universal-modder contributors`) | `b8675c10d7091d7e4e00a2e40a15c601040b69a8` |

### Apache-2.0 NOTICE preservation (ReVa)

Searched `review/reverse-engineering-assistant` (depth ≤ 3, including `ReVa/`)
for `NOTICE*`: **no NOTICE file exists**. The Apache-2.0 `LICENSE` texts at the
repo root and at `ReVa/LICENSE` are byte-identical (`diff -q` → SAME), so there
is nothing further to preserve. If an upstream `NOTICE` appears later, it must
be copied alongside any vendored ReVa material.

## Packs deliberately NOT vendored

- **Big packs (on demand only):** `mukul975/Anthropic-Cybersecurity-Skills`
  (818 skills, Apache-2.0, verified at
  `54a798831d2266a3ca61ce68a7acb80b81160d57`,
  https://github.com/mukul975/Anthropic-Cybersecurity-Skills) and
  `zhaoxuya520/reverse-skill` (89 skills, MIT, verified at
  `cab634bd855fc287f6e420c1f36fd1a6b9245960`,
  https://github.com/zhaoxuya520/reverse-skill) are installed on demand via
  `npx skills add`, never copied into this repo.
- **GPLv3 exclusion:** `zhaoxuya520/reverse-skill/CTF-Sandbox-Orchestrator/`
  is **GPLv3** (`GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007`). It is
  **NEVER** copied, vendored, or installed by this plugin.
- **Licensed disassemblers:** IDA and Hopper are commercial tools and are
  **NOT** baked into any image or bundle. They are mounted or hosted by the
  user via `REA_IDA_MCP_CONFIG` / `HOPPER_LAUNCHER_PATH` (see
  `docs/IMPLEMENTATION_PROMPT.md` §3/§4.4).
