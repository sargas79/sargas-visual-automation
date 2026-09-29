# Example macros

SVA ships a compendium, **SVA Example Macros** (`sargas-visual-automation.sva-macros`), with 16 macros written against the [SVA macro API](api.md). They cover the same use cases as the example macros bundled with JB2A for Sequencer, but they are **original code**: they need neither Sequencer nor Tagger, and they add a few things (toggles saved in the scene, SHIFT for a miss, elemental and colour options).

Import them with right-click on the compendium → **Import All Content**, then read the header comment of each macro. Each macro has a short configuration block at the top (colours, variants, scale).

| Macro                      | Select / target                             | What it does                                                                                       |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Spike Trap (10 ft)         | Select trap tiles (or tag them, see header) | First run springs the trap, splashes tokens on it and keeps the spikes out; second run re-arms it. |
| Melee Attack (Advanced)    | Attacker selected, targets                  | Weapon swing with trail, impact and blood; thrown weapon with return beyond reach. SHIFT = miss.   |
| Launched Missile           | Launcher selected, targets                  | Back-blast smoke, missile, explosion and a fading ground crack per target.                         |
| Flask Throw                | Thrower selected, targets                   | Flask, shattering glass and a frost / poison / arcane spray.                                       |
| Bless Toggle               | Targets (or selected tokens)                | Intro, then a persistent glow that follows the token. Run again to end.                            |
| Whirl Toggle               | Selected tokens                             | Intro, persistent loop, outro on toggle off.                                                       |
| Vortex Toggle              | Selected tokens                             | Same with the vortex.                                                                              |
| Magic Circle Toggle        | Selected tokens                             | Spell-school circle (8 schools, 12 colours) under the token.                                       |
| Shield Toggle              | Selected tokens                             | Persistent shield; bursts on toggle off.                                                           |
| Energy Field Toggle        | Selected tokens                             | Two-layer field (behind and in front of the token).                                                |
| Molten Earth Shield Toggle | Selected tokens                             | Two-layer elemental shield: molten earth, fire, ice or eldritch web.                               |
| Bomb Throw                 | Thrower selected, targets                   | Bomb, shrapnel, explosion, fading scorch mark.                                                     |
| Arrows and Bolts           | Archer selected, targets                    | Arrow or bolt per target, distance-matched. SHIFT = miss.                                          |
| Dodecahedron Toggle        | Selected tokens                             | Two-layer rotating dodecahedron (star, rune or skull).                                             |
| Energy Strands Toggle      | Selected tokens                             | Two-layer energy strands in 10 colours.                                                            |
| Weapon Throw and Return    | Thrower selected, targets                   | Dagger or hammer thrown at each target and back. SHIFT = miss.                                     |

Most of these use animations from the **JB2A Patreon** collection. With the free JB2A module, some files don't exist and SVA logs a "path not found" warning instead of playing them.

## Persistent toggles

The toggle macros create **persistent** effects (`.persist(true).name(...)`). They are saved in the scene's flags, so they survive reloads and scene switches, and are visible to everyone. The macro checks `SVA.effects.list({ sceneId, name })` to decide whether to start or end the effect, and uses a name per token (`sva-shield:<tokenId>`), so each token toggles independently. Deleting the token ends its effects.

## Editing the macros (contributors)

The macro sources are JSON documents in `packs-src/sva-macros/` (the macro code is the `command` field). `npm run build:packs` (also run by `npm run build`) compiles them into the LevelDB pack `packs/sva-macros/` with `@foundryvtt/foundryvtt-cli`. `tests/docs/macros.test.js` checks that every macro is a valid document, uses only SVA's documented API, and runs against a mocked SVA.

Use only real JB2A database paths (check them in the animation browser) and never copy code from JB2A's own macros: they are licensed CC BY-NC-SA.

## Credits

The animations are by **JB2A - Jules & Ben's Animated Assets** (<https://jb2a.com>), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). SVA does not include any JB2A files; the macros reference the files of the JB2A module you install. The use cases follow the examples JB2A bundles for Sequencer; the SVA macros are an independent implementation, MIT licensed like the rest of SVA.
