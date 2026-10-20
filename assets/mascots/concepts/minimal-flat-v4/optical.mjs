#!/usr/bin/env node
// optical.mjs — derived optical-size views of the mascot masters.
//
// A small sprite cannot show a full body and its props at once: the 32 px raster
// of a 512-unit illustration drops every detail below ~8 units. So each sprite
// gets a *derived* optical view — a subset of the approved master paths, placed
// for the interaction it has to carry at that size.
//
// The masters stay the single source of truth. Every optical view is composed
// from master paths by compose.mjs, so it can never drift, and render.mjs
// re-derives and byte-compares each file on every run (stale or missing => fail
// closed).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from './compose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- master path subsets (semantic ids only) ----
export const ISKRA_HEAD = [
  'iskra-ear-far', 'iskra-ear-far-inner', 'iskra-ear-near', 'iskra-ear-near-inner',
  'iskra-head', 'iskra-fringe-lock', 'iskra-fringe-tuft', 'iskra-muzzle', 'iskra-nose',
  'iskra-eye-far', 'iskra-eye-near', 'iskra-brow',
  'iskra-scarf', 'iskra-scarf-knot',
];
export const ISKRA_BUST = [...ISKRA_HEAD, 'iskra-body', 'iskra-foreleg'];
export const ISKRA_PAW = ['iskra-paw-raised'];
export const ISKRA_CARD = ['iskra-plan-card', 'iskra-plan-card-edge'];
export const SZLIF_BUST = [
  'szlif-crest-1', 'szlif-crest-2', 'szlif-crest-3', 'szlif-head', 'szlif-beak',
  'szlif-eye', 'szlif-pupil', 'szlif-hackle', 'szlif-body', 'szlif-wing',
];

export const OPTICAL = [
  {
    id: 'iskra-master-optical',
    forSource: 'iskra-master',
    file: 'optical/iskra-optical.svg',
    derivedFrom: ['masters/iskra-master.svg'],
    sizes: [64, 32],
    // head-and-shoulders crop: the fringe lock, tilted scarf and mitten fill the frame
    viewBox: null,
    fit: 10,
    title: 'Iskra — optical view (head and shoulders)',
    desc: 'Derived from masters/iskra-master.svg: the head, ears, ink fringe lock, cowlick, tilted turquoise scarf and the cream mitten, cropped tight so the asymmetric fringe and the scarf survive at 32 px.',
    layers: [
      `masters/iskra-master.svg@only=${ISKRA_HEAD.join(',')}:0,0,1`,
    ],
  },
  {
    id: 'iskra-szlif-vignette-optical',
    forSource: 'iskra-szlif-vignette',
    file: 'optical/iskra-szlif-optical-vignette.svg',
    derivedFrom: ['masters/iskra-master.svg', 'masters/szlif-master.svg'],
    sizes: [64, 32],
    // compact two-head vignette: both faces fill the frame, the enlarged plan card
    // sits in the interaction zone between them
    viewBox: '38 22 398 230',
    fit: 0,
    title: 'Iskra proposes, Szlif evaluates — optical vignette',
    desc: 'Derived from masters/iskra-master.svg and masters/szlif-master.svg: both faces in one compact frame, leaning towards each other, with the enlarged turquoise plan card in the interaction zone between them.',
    layers: [
      `masters/iskra-master.svg@only=${ISKRA_BUST.join(',')}:156,32,0.8`,
      `masters/iskra-master.svg@only=${ISKRA_CARD.join(',')}:101,-79,1.35`,
      `masters/iskra-master.svg@only=${ISKRA_PAW.join(',')}:156,32,0.8`,
      `masters/szlif-master.svg@only=${SZLIF_BUST.join(',')}:-52,110,0.8`,
    ],
  },
];

export function derive(recipe) {
  return compose(recipe.layers, {
    viewBox: recipe.viewBox || '0 0 512 512',
    title: recipe.title,
    desc: recipe.desc,
    fit: recipe.fit || 0,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const r of OPTICAL) {
    const out = path.join(here, r.file);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, derive(r));
    console.log(`derived ${r.file}`);
  }
}
