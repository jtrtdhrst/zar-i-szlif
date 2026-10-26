# Żar i Szlif — Brand Style Contract v1

Version: `1` · Status: `active` · Updated: `2026-10-26`

This is the single shared style/character/requirements contract for every
graphic workflow. Automation loads it; humans edit it by BUMPING the version
(`v2`, `v3`) — never by silently changing `v1` files.

## Style (all mascots, all scenes)

- Premium simplified flat 2D vector-like character design, Finch-like economy.
- 5–7 cohesive flat solid colors per image. NO gradients, NO textures,
  NO thick outlines, NO text, NO logos, NO watermarks.
- Light cream background (`#FFF6E9`), generous whitespace, balanced composition.
- Equal mascot height. Tiny black-dot eyes with white catchlights.
- Rounded silhouettes, strong readability at small sizes.

## Palette (canonical hex)

| Use | Hex |
|---|---|
| Cream background | `#FFF6E9` |
| Iskra fur (orange) | `#E8832B` |
| Iskra forelock accent (dark) | `#3A2A1A` |
| Neckerchief turquoise | `#2FA3A0` |
| Neckerchief stripes (white) | `#FFFFFF` |
| Szlif feathers (dark raven) | `#2E3138` |
| Szlif lighter leg feathers | `#6B7280` |
| Cap brown (+ underside) | `#7A5230` |
| Beak (clean, no dot) | `#F2B134` |
| Campfire flame | `#F2703F` |

## Hard requirements (QA must check)

1. Iskra: orange fox, asymmetric forelock, tilted striped turquoise neckerchief.
2. Szlif: dark raven, brown cap INCLUDING underside, lighter legs, clean beak.
3. No text anywhere. No extra limbs, no merged bodies, no watermark-like blobs.
4. Flat fills only — any gradient/texture is a FAIL with the region named.

## References

- `input/brand/iskra_szlif_campfire_v1.png` — accepted master look (campfire scene).
- `input/brand/mascot_verify_v1.png` — second accepted sample (Codex verify run).
- Manifest `brand.v1.json` pins filenames + SHA-256.
