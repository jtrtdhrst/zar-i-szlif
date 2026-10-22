# Local patches to the vendored Plasmic action

Studio ships this action as a CommonJS bundle. Two changes were needed for it to
run in this repo against the self-hosted Plasmic instance:

1. `lib/index.js` -> `lib/index.cjs` (and `action.yml` `main:`). The repo root
   `package.json` has `"type": "module"`, so Node treated the bundle as ESM and
   every run died with `ReferenceError: require is not defined in ES module
   scope` in the "Initializing Plasmic app..." step.
2. `codegenHost` comparison in the bundle (`this.auth.host === ano.DEFAULT_HOST`)
   now compares against `https://studio.plasmic.app`. With
   `PLASMIC_DEFAULT_HOST` set to the self-hosted URL, the original check was
   true and the CLI called the public `https://codegen.plasmic.app` instead of
   `https://plasmic.kompaszbiorek.pl`.

Re-apply both if Studio ever overwrites this directory.
