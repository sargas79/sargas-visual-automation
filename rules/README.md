# Automation rule packs

A rule pack holds the **default automation rules for one game system**. The file is `rules/<systemId>.json` (for example `rules/pf2e.json`) and is validated against [`rulepack.schema.json`](rulepack.schema.json).

When the world loads, the active system adapter's `rulePackUrl` (by default `modules/sargas-visual-automation/rules/<systemId>.json`) is fetched and validated. Its rules become the **system** tier of resolution. If the game system has no adapter, nothing is loaded. If the system has an adapter but no pack, only the generic fallback applies.

## How a recipe is chosen

For each automation event, the item is resolved in this order. The first hit wins.

1. **Item**: `flags["sargas-visual-automation"].recipe` on the item. It is set from the item sheet or with `api.automation.setItemRecipe(item, recipe)`.
2. **World rules**: the world setting `automationRules`, managed with `api.automation.rules.*`.
3. **System rule pack**: this folder.
4. **Generic fallback**: built from the item descriptors (attack kind, weapon group, damage types, healing, area).

`flags["sargas-visual-automation"].disabled === true` turns automation off for an item.

Rule packs are merged with world rules. A world rule with the **same `id`** as a pack rule replaces it. To turn off a default rule, save a copy of it with `"enabled": false`.

Within a tier, rules run in this order:

1. Higher `priority` first.
2. Then the more specific rule. Specificity is ranked `key` > `name` > `baseItem` > `regex` > `weaponGroup`/`traits` > `attackKind`/`type`.
3. Then file order.

To debug resolution, `api.automation.explain(item, { eventType })` lists every candidate rule and why it did or didn't match.

## Format

```json
{
  "$schema": "./rulepack.schema.json",
  "system": "pf2e",
  "version": 1,
  "rules": [
    {
      "id": "fire-bolt",
      "label": "Produce Flame",
      "priority": 0,
      "enabled": true,
      "match": { "key": "produce-flame" },
      "recipe": {
        "version": 1,
        "preset": "ranged",
        "animation": "jb2a.fire_bolt.orange",
        "stages": { "impact": { "animation": "jb2a.impact.fire.01.orange" } },
        "outcomes": { "criticalSuccess": { "animation": "jb2a.fire_bolt.dark_red" } }
      }
    }
  ]
}
```

| Field      | Required | Meaning                                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `system`   | yes      | Adapter / `game.system.id`. A pack for a different system is loaded with a warning.                     |
| `version`  | yes      | Pack format version, currently `1`.                                                                     |
| `rules[]`  | yes      | Invalid rules are skipped with a console warning; the rest of the pack still loads. Ids must be unique. |
| `id`       | yes      | Stable id, used for overrides from world rules.                                                         |
| `label`    | no       | Shown in the rules manager (defaults to `id`).                                                          |
| `enabled`  | no       | Default `true`.                                                                                         |
| `priority` | no       | Default `0`; higher wins.                                                                               |
| `match`    | yes      | At least one criterion; **all** given criteria must match.                                              |
| `recipe`   | yes      | What to play (see below).                                                                               |

### `match` criteria

Matching is case-insensitive and uses the adapter's `ItemDescriptors` (see `src/shared/events.js`).

| Criterion     | Value                                   | Matches when                                                                                         |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `key`         | string or list                          | The item key (PF2e slug, 5e identifier, ...) is any of them.                                         |
| `name`        | string or list                          | The item name equals any of them.                                                                    |
| `regex`       | `"pattern"` or `{ "pattern", "flags" }` | The item name matches (default flags `"i"`).                                                         |
| `type`        | string or list                          | `weapon`, `spell`, `action`, `consumable`, `effect`, `condition`, `feat` or `other`.                 |
| `traits`      | string or list                          | The item has **all** the listed traits.                                                              |
| `attackKind`  | string or list                          | `melee`, `ranged` or `thrown`.                                                                       |
| `weaponGroup` | string or list                          | Normalized group, such as `sword`, `bow` or `axe`.                                                   |
| `baseItem`    | string or list                          | The base weapon/item, such as `longsword`: matches every variant (+1 Striking, named magic weapons). |

### Recipe

| Field       | Meaning                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`   | Recipe format version (`1`). Older recipes are migrated automatically.                                                                                                                                                                                       |
| `preset`    | `melee`, `ranged`, `onToken`, `area`, `aura` or `teleport`.                                                                                                                                                                                                  |
| `animation` | Main animation: a JB2A database path (`jb2a.…`, branches are fine and pick a random leaf) or a file URL.                                                                                                                                                     |
| `options`   | Preset options. See `api.automation.presets[preset].optionsSchema`.                                                                                                                                                                                          |
| `stages`    | `cast`, `projectile`, `impact`, `onSource`, `onTarget`: each `{ "animation", "options" }`, or `null` to turn it off.                                                                                                                                         |
| `outcomes`  | `criticalSuccess`, `success`, `failure`, `criticalFailure` (aliases `crit`, `hit`, `miss`, `fumble`): partial recipe overrides of `animation`, `options`, `stages` and `sound`. A critical result also applies the plain `success`/`failure` override first. |
| `sound`     | `{ "file", "volume" (0..1), "delay" (ms) }`.                                                                                                                                                                                                                 |
| `triggers`  | Event types that play the recipe. Defaults per preset: melee/ranged `attack`; onToken `cast`, `healing`; area `areaPlaced`; aura `effectApplied`; teleport `cast`.                                                                                           |

### Presets

| Preset     | Plays                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `melee`    | Main animation stretched from the attacker to each target. On a miss it uses `missed: true` and skips impact/onTarget.                                                           |
| `ranged`   | One projectile per target (the `projectile` stage or `animation`), staggered by `options.stagger` ms. On a miss it uses `missed: true`. `options.returnTrip` for thrown weapons. |
| `onToken`  | On every target, or on the source when there are no targets or `options.target` is `"source"`.                                                                                   |
| `area`     | Sized from the placed area (`event.area`) or from the item's `area` descriptor. burst/emanation: radius; square: side; cone/line: stretched along the direction.                 |
| `aura`     | A persistent effect attached to the source and named `aura:<actorId>:<itemKey>`. It ends when the system reports `effectRemoved`. Sized by `options.radius` or the item area.    |
| `teleport` | Departure on the source (`onSource` stage or `animation`), then arrival (`onTarget` stage or `animation`) at `event.area.origin`, `options.destination` or the first target.     |

Timeline for every preset: `sound`, then `cast` on the source (the sequence waits for it), then `onSource` and the main animation, then `impact` and `onTarget` on each affected target.

## Import / export

The rules manager, or the API, exports world rules in this same format. This lets you share rules between worlds or propose them for a system pack:

```js
const json = SVA.automation.rules.exportJSON();
await SVA.automation.rules.importJSON(json); // merge by id
await SVA.automation.rules.importJSON(json, { replace: true }); // replace all world rules
```

## Adding a pack for a new system

1. Create the adapter in `src/systems/<systemId>/` from `src/systems/_template/`.
2. Add `rules/<systemId>.json` with `"system": "<systemId>"`.
3. Use real JB2A database paths. `api.db.search("fire bolt")` in the console helps you find them.
